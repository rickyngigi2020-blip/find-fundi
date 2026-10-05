const { adminClient } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');
const jobService = require('./jobService');

// Signed links to verification documents last this long. Documents are
// private: only the uploader's own session or the service role can read them.
const DOC_LINK_SECONDS = 10 * 60;
// Supabase Auth has no permanent ban; ~100 years stands in for one.
const SUSPEND_BAN = '876000h';

async function signedDocUrl(path) {
  if (!path) return null;
  const { data, error } = await adminClient.storage.from('verification-docs').createSignedUrl(path, DOC_LINK_SECONDS);
  return error ? null : data.signedUrl;
}

async function listFundiApplications() {
  const { data, error } = await adminClient
    .from('fundi_profiles')
    .select('*, profiles!fundi_profiles_id_fkey!inner(full_name, phone, area, suspended_at)')
    .order('created_at', { ascending: true });
  if (error) throw toApiError(error);
  return Promise.all(data.map(async (app) => ({
    ...app,
    id_document_link: await signedDocUrl(app.id_document_url),
    certificate_links: await Promise.all((app.certificate_paths || []).map(signedDocUrl)),
  })));
}

async function setVerificationStatus(fundiId, status) {
  const changes = { verification_status: status, updated_at: new Date().toISOString() };
  // A fundi who loses approval stops showing as available straight away.
  if (status !== 'verified') changes.is_online = false;
  const { data, error } = await adminClient
    .from('fundi_profiles')
    .update(changes)
    .eq('id', fundiId)
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

async function emailsById() {
  const emails = {};
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw apiError(502, "Couldn't load account emails. Try again.", 'upstream_error');
    data.users.forEach((u) => { emails[u.id] = u.email; });
    if (data.users.length < 1000) return emails;
  }
}

const USER_LIMIT = 100;

// Newest accounts first. `query` matches name, phone or email.
async function listUsers({ query }) {
  const [{ data, error }, emails] = await Promise.all([
    adminClient
      .from('profiles')
      .select('id, full_name, phone, role, area, is_admin, suspended_at, created_at, fundi_profiles(verification_status, category)')
      .order('created_at', { ascending: false }),
    emailsById(),
  ]);
  if (error) throw toApiError(error);

  const needle = (query || '').trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  return data
    .map((p) => {
      const fundi = Array.isArray(p.fundi_profiles) ? p.fundi_profiles[0] : p.fundi_profiles;
      return { ...p, fundi_profiles: undefined, fundi: fundi || null, email: emails[p.id] || null };
    })
    .filter((u) => !needle
      || (u.full_name || '').toLowerCase().includes(needle)
      || (u.email || '').toLowerCase().includes(needle)
      || (digits.length >= 3 && (u.phone || '').replace(/\D/g, '').includes(digits)))
    .slice(0, USER_LIMIT);
}

async function setSuspended(adminId, userId, suspended) {
  if (userId === adminId) throw apiError(400, "You can't suspend your own account.", 'invalid_request');
  const { data: profile, error } = await adminClient.from('profiles').select('id, is_admin').eq('id', userId).maybeSingle();
  if (error) throw toApiError(error);
  if (!profile) throw apiError(404, 'Account not found.', 'not_found');
  if (profile.is_admin) throw apiError(400, "Admin accounts can't be suspended here.", 'invalid_request');

  // Ban first: if it fails, nothing else has changed.
  const { error: banError } = await adminClient.auth.admin.updateUserById(userId, { ban_duration: suspended ? SUSPEND_BAN : 'none' });
  if (banError) throw apiError(502, "Couldn't update this account's sign-in. Try again.", 'upstream_error');

  const { data, error: updateError } = await adminClient
    .from('profiles')
    .update({ suspended_at: suspended ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id, suspended_at')
    .single();
  if (updateError) throw toApiError(updateError);
  if (suspended) await adminClient.from('fundi_profiles').update({ is_online: false }).eq('id', userId);
  return data;
}

const JOB_LIMIT = 100;
const JOB_FILTERS = {
  active: ['requested', 'matched', 'in_progress'],
  requested: ['requested'],
  matched: ['matched'],
  in_progress: ['in_progress'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

// Newest first, with both parties' names and phones for follow-up.
async function listJobs({ filter }) {
  let query = adminClient.from('jobs').select('*').order('created_at', { ascending: false }).limit(JOB_LIMIT);
  if (JOB_FILTERS[filter]) query = query.in('status', JOB_FILTERS[filter]);
  const { data: jobs, error } = await query;
  if (error) throw toApiError(error);

  const ids = [...new Set(jobs.flatMap((j) => [j.customer_id, j.fundi_id]).filter(Boolean))];
  const people = {};
  if (ids.length) {
    const { data, error: peopleError } = await adminClient.from('profiles').select('id, full_name, phone').in('id', ids);
    if (peopleError) throw toApiError(peopleError);
    data.forEach((p) => { people[p.id] = { full_name: p.full_name, phone: p.phone }; });
  }
  return jobs.map((j) => ({ ...j, customer: people[j.customer_id] || null, fundi: people[j.fundi_id] || null }));
}

function cancelJob(jobId, reason) {
  return jobService.cancelJob(jobId, { by: 'admin', reason });
}

// Records that an admin interviewed a fundi with no papers and found them
// competent. This is Find Fundi's own certification, and it stands in for an
// uploaded certificate.
async function certifyFundi(adminId, fundiId, note) {
  const { data: fundi, error: readError } = await adminClient
    .from('fundi_profiles')
    .select('id, certificate_paths, certified_by_find_fundi_at')
    .eq('id', fundiId)
    .maybeSingle();
  if (readError) throw toApiError(readError);
  if (!fundi) throw apiError(404, 'That application no longer exists.', 'not_found');
  if ((fundi.certificate_paths || []).length) {
    throw apiError(400, 'This fundi already uploaded certificates, so they do not need Find Fundi certification.', 'invalid_request');
  }

  const { data, error } = await adminClient
    .from('fundi_profiles')
    .update({
      certified_by_find_fundi_at: new Date().toISOString(),
      certified_by: adminId,
      certification_note: note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fundiId)
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

// Undoes a certification that was given in error. It does not change the
// fundi's approval, which is a separate decision.
async function uncertifyFundi(fundiId) {
  const { data, error } = await adminClient
    .from('fundi_profiles')
    .update({
      certified_by_find_fundi_at: null,
      certified_by: null,
      certification_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fundiId)
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

// ---------- admins ----------
// Admin rights are a flag on the profile. Granting is by email, because that
// is what one admin knows about another; the account must already exist.

async function listAdmins() {
  const [{ data, error }, emails] = await Promise.all([
    adminClient
      .from('profiles')
      .select('id, full_name, phone, created_at')
      .eq('is_admin', true)
      .order('created_at', { ascending: true }),
    emailsById(),
  ]);
  if (error) throw toApiError(error);
  return data.map((p) => ({ ...p, email: emails[p.id] || null }));
}

async function grantAdmin(email) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) throw apiError(400, 'Enter the email address of the account to make an admin.', 'invalid_request');

  const emails = await emailsById();
  const userId = Object.keys(emails).find((id) => (emails[id] || '').toLowerCase() === needle);
  if (!userId) {
    throw apiError(404, 'No account uses that email. They need to sign up first, then you can make them an admin.', 'not_found');
  }

  const { data, error } = await adminClient
    .from('profiles')
    .update({ is_admin: true })
    .eq('id', userId)
    .select('id, full_name')
    .maybeSingle();
  if (error) throw toApiError(error);
  if (!data) {
    throw apiError(409, 'That account has not finished setting up its profile yet, so it cannot be made an admin.', 'conflict');
  }
  return { ...data, email: emails[userId] };
}

// Removing your own rights would lock you out of this page with no way back,
// so it is refused outright rather than confirmed.
async function revokeAdmin(adminId, userId) {
  if (adminId === userId) throw apiError(400, "You can't remove your own admin access.", 'invalid_request');

  const { data, error } = await adminClient
    .from('profiles')
    .update({ is_admin: false })
    .eq('id', userId)
    .select('id, full_name')
    .maybeSingle();
  if (error) throw toApiError(error);
  if (!data) throw apiError(404, 'That account no longer exists.', 'not_found');
  return data;
}

module.exports = {
  listFundiApplications, setVerificationStatus, listUsers, setSuspended, listJobs, cancelJob, JOB_FILTERS,
  listAdmins, grantAdmin, revokeAdmin, certifyFundi, uncertifyFundi,
};

