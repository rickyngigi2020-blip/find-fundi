const { adminClient } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');
const jobService = require('./jobService');
const { RELEASE_REASONS } = require('../utils/releaseReasons');

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

// Every sign-in account Supabase holds, whether or not it has a profile.
async function allAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw apiError(502, "Couldn't load accounts. Try again.", 'upstream_error');
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function emailsById() {
  return Object.fromEntries((await allAuthUsers()).map((u) => [u.id, u.email]));
}

const USER_LIMIT = 100;

// Newest accounts first. `query` matches name, phone or email.
//
// Starts from the sign-in accounts, not from profiles: someone who signed up
// but never finished setting up (or never confirmed their email) has no
// profile, and was invisible here while Supabase still listed them.
async function listUsers({ query }) {
  const [{ data, error }, authUsers] = await Promise.all([
    adminClient
      .from('profiles')
      .select('id, full_name, phone, role, area, is_admin, suspended_at, created_at, fundi_profiles!fundi_profiles_id_fkey(verification_status, category)'),
    allAuthUsers(),
  ]);
  if (error) throw toApiError(error);
  const profiles = Object.fromEntries(data.map((p) => [p.id, p]));

  const needle = (query || '').trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  return authUsers
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((u) => {
      const p = profiles[u.id] || {};
      const fundi = Array.isArray(p.fundi_profiles) ? p.fundi_profiles[0] : p.fundi_profiles;
      const meta = u.user_metadata || {};
      return {
        id: u.id,
        full_name: p.full_name || meta.full_name || meta.name || null,
        phone: p.phone || null,
        role: p.role || null,
        area: p.area || null,
        is_admin: Boolean(p.is_admin),
        suspended_at: p.suspended_at || null,
        created_at: u.created_at,
        email: u.email || null,
        fundi: fundi || null,
        providers: (u.app_metadata && u.app_metadata.providers) || [],
        email_confirmed: Boolean(u.email_confirmed_at),
        last_sign_in_at: u.last_sign_in_at || null,
        setup_finished: Boolean(profiles[u.id]),
      };
    })
    .filter((u) => !needle
      || (u.full_name || '').toLowerCase().includes(needle)
      || (u.email || '').toLowerCase().includes(needle)
      || (digits.length >= 3 && (u.phone || '').replace(/\D/g, '').includes(digits)))
    .slice(0, USER_LIMIT);
}

// Admins see how a price moved and why, which is the only check on a fundi
// quoting low to win a job and raising it once they are on site.
async function priceHistory(jobIds) {
  if (!jobIds.length) return {};
  const { data, error } = await adminClient
    .from('job_price_changes')
    .select('*')
    .in('job_id', jobIds)
    .order('created_at', { ascending: true });
  if (error) throw toApiError(error);
  return data.reduce((acc, c) => {
    (acc[c.job_id] = acc[c.job_id] || []).push(c);
    return acc;
  }, {});
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
  const changes = await priceHistory(jobs.map((j) => j.id));
  return jobs.map((j) => ({
    ...j,
    customer: people[j.customer_id] || null,
    fundi: people[j.fundi_id] || null,
    price_changes: changes[j.id] || [],
  }));
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

// ---------- insights ----------
// Numbers for working out what to fix and where Find Fundi wins or loses
// against the competition. Everything is counted from the tables as they are,
// at most INSIGHT_ROWS rows each, which is far more than exists today.

const INSIGHT_ROWS = 5000;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_BANDS = ['00-03', '03-06', '06-09', '09-12', '12-15', '15-18', '18-21', '21-24'];

const nairobi = (iso) => new Date(new Date(iso).getTime() + NAIROBI_OFFSET_MS);
const average = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const round = (n, places = 0) => (n === null ? null : Number(n.toFixed(places)));

// Most first, for lists with no natural order.
function countBy(items, keyOf) {
  const counts = {};
  items.forEach((item) => {
    const key = keyOf(item);
    if (key !== null && key !== undefined) counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
}
// In a fixed order, for days and hours, where a missing slot still matters.
function countInto(labels, items, labelOf) {
  const counts = Object.fromEntries(labels.map((l) => [l, 0]));
  items.forEach((item) => { counts[labelOf(item)] += 1; });
  return labels.map((label) => ({ label, value: counts[label] }));
}

async function readAll(table, columns) {
  const { data, error } = await adminClient.from(table).select(columns).limit(INSIGHT_ROWS);
  if (error) throw toApiError(error);
  return data;
}

async function insights() {
  const [authUsers, profiles, fundis, jobs, offers, reviews, changes, pushes] = await Promise.all([
    allAuthUsers(),
    readAll('profiles', 'id'),
    readAll('fundi_profiles', 'id, verification_status, no_certificate'),
    readAll('jobs', 'id, customer_id, category, area, urgency, status, created_at, quote_amount, final_cost, cancelled_by, cancel_reason, cancelled_at, search_exhausted_at'),
    readAll('job_offers', 'job_id, status, offered_at, responded_at, release_reason'),
    readAll('reviews', 'job_id, rating'),
    readAll('job_price_changes', 'job_id, previous_amount, amount'),
    readAll('push_subscriptions', 'user_id'),
  ]);
  const jobById = Object.fromEntries(jobs.map((j) => [j.id, j]));

  // ----- funnel -----
  const jobsPerCustomer = countBy(jobs, (j) => j.customer_id);
  const completedCustomers = new Set(jobs.filter((j) => j.status === 'completed').map((j) => j.customer_id));
  const withAlerts = new Set(pushes.map((p) => p.user_id));
  const funnel = [
    { label: 'Accounts', value: authUsers.length },
    { label: 'Finished setup', value: profiles.length },
    { label: 'Booked a job', value: jobsPerCustomer.length },
    { label: 'Had a job done', value: completedCustomers.size },
    { label: 'Booked again', value: jobsPerCustomer.filter((c) => c.value > 1).length },
  ];

  // ----- matching -----
  const accepted = offers.filter((o) => o.status === 'accepted' && o.responded_at);
  const firstTaken = {};
  accepted.forEach((o) => {
    const at = new Date(o.responded_at).getTime();
    if (!firstTaken[o.job_id] || at < firstTaken[o.job_id]) firstTaken[o.job_id] = at;
  });
  const minutesToFundi = Object.entries(firstTaken)
    .filter(([jobId]) => jobById[jobId])
    .map(([jobId, at]) => (at - new Date(jobById[jobId].created_at).getTime()) / 60000);
  const answerSeconds = offers
    .filter((o) => ['accepted', 'declined'].includes(o.status) && o.responded_at)
    .map((o) => (new Date(o.responded_at) - new Date(o.offered_at)) / 1000);
  const reasonLabel = Object.fromEntries(RELEASE_REASONS.map((r) => [r.key, r.label]));

  // ----- money and quality, by trade -----
  const categories = [...new Set(jobs.map((j) => j.category))];
  const revisionsByJob = {};
  changes.forEach((c) => { revisionsByJob[c.job_id] = (revisionsByJob[c.job_id] || 0) + 1; });
  const ratingByJob = Object.fromEntries(reviews.map((r) => [r.job_id, r.rating]));
  const byTrade = categories.map((category) => {
    const these = jobs.filter((j) => j.category === category);
    const priced = these.filter((j) => j.quote_amount);
    const done = these.filter((j) => j.status === 'completed' && j.final_cost);
    const ratings = these.map((j) => ratingByJob[j.id]).filter(Boolean);
    const revisions = these.reduce((n, j) => n + (revisionsByJob[j.id] || 0), 0);
    return {
      category,
      jobs: these.length,
      completed: these.filter((j) => j.status === 'completed').length,
      priced: priced.length,
      average_first_price: round(average(priced.map((j) => j.quote_amount))),
      average_final_price: round(average(done.map((j) => j.final_cost))),
      price_changes: revisions,
      reviews: ratings.length,
      average_rating: round(average(ratings), 1),
    };
  }).sort((a, b) => b.jobs - a.jobs);

  return {
    generated_at: new Date().toISOString(),
    funnel,
    headline: [
      { label: 'Accounts with notifications on', value: withAlerts.size, of: authUsers.length },
      { label: 'Verified fundis', value: fundis.filter((f) => f.verification_status === 'verified').length, of: fundis.length },
      { label: 'Jobs taken through auto-matching', value: Object.keys(firstTaken).filter((id) => jobById[id]).length, of: jobs.length },
      { label: 'Median minutes to find a fundi', value: round(median(minutesToFundi), 1) },
      { label: 'Median seconds for a fundi to answer', value: round(median(answerSeconds)) },
      { label: 'Jobs marked urgent', value: jobs.filter((j) => j.urgency === 'urgent').length, of: jobs.length },
    ],
    sections: [
      {
        title: 'How people sign in',
        rows: [
          { label: 'Google', value: authUsers.filter((u) => ((u.app_metadata || {}).providers || []).includes('google')).length },
          { label: 'Email and password', value: authUsers.filter((u) => !((u.app_metadata || {}).providers || []).includes('google')).length },
          { label: 'Email never confirmed', value: authUsers.filter((u) => !u.email_confirmed_at).length },
          { label: 'Never finished setup', value: authUsers.length - profiles.length },
        ],
      },
      { title: 'Jobs by trade', labels: 'category', rows: countBy(jobs, (j) => j.category) },
      { title: 'Jobs by area', rows: countBy(jobs, (j) => j.area) },
      { title: 'Jobs by day (Nairobi time)', rows: countInto(WEEKDAYS, jobs, (j) => WEEKDAYS[(nairobi(j.created_at).getUTCDay() + 6) % 7]) },
      { title: 'Jobs by time of day (Nairobi time)', rows: countInto(HOUR_BANDS, jobs, (j) => HOUR_BANDS[Math.floor(nairobi(j.created_at).getUTCHours() / 3)]) },
      {
        title: 'What happened to job offers',
        rows: countInto(['Taken', 'Passed', 'No answer in time', 'Waiting'], offers,
          (o) => ({ accepted: 'Taken', declined: 'Passed', expired: 'No answer in time' }[o.status] || 'Waiting')),
      },
      { title: 'Why fundis turned jobs down after taking them', rows: countBy(offers.filter((o) => o.release_reason), (o) => reasonLabel[o.release_reason] || o.release_reason) },
      { title: 'Where jobs ended up', labels: 'status', rows: countBy(jobs, (j) => j.status) },
      { title: 'Who cancelled', rows: countBy(jobs.filter((j) => j.cancelled_by), (j) => ({ customer: 'The customer', admin: 'Find Fundi' }[j.cancelled_by] || j.cancelled_by)) },
    ],
    by_trade: byTrade,
    cancel_reasons: jobs
      .filter((j) => j.cancel_reason)
      .sort((a, b) => new Date(b.cancelled_at || b.created_at) - new Date(a.cancelled_at || a.created_at))
      .slice(0, 20)
      .map((j) => ({ at: j.cancelled_at || j.created_at, by: j.cancelled_by, category: j.category, reason: j.cancel_reason })),
  };
}

module.exports = {
  insights,
  listFundiApplications, setVerificationStatus, listUsers, setSuspended, listJobs, cancelJob, JOB_FILTERS,
  listAdmins, grantAdmin, revokeAdmin, certifyFundi, uncertifyFundi,
};

