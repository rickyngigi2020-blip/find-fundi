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
    .select('*, profiles!inner(full_name, phone, area, suspended_at)')
    .order('created_at', { ascending: true });
  if (error) throw toApiError(error);
  return Promise.all(data.map(async (app) => ({
    ...app,
    id_document_link: await signedDocUrl(app.id_document_url),
    certificate_link: await signedDocUrl(app.certificate_url),
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

module.exports = {
  listFundiApplications, setVerificationStatus, listUsers, setSuspended, listJobs, cancelJob, JOB_FILTERS,
};
