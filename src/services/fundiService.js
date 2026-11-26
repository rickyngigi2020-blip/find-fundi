const { adminClient, clientForUser } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');
const fundiCards = require('./fundiCardService');

// The fundi app checks in every few minutes while it is open and online. A
// fundi who hasn't checked in within this window is not shown as available.
const AVAILABLE_WINDOW_MS = 15 * 60 * 1000;

// Earnings days and weeks follow Nairobi time (EAT, UTC+3, no daylight saving).
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function isAvailableNow(fundi, now = Date.now()) {
  return Boolean(fundi.is_online && fundi.last_seen_at
    && now - new Date(fundi.last_seen_at).getTime() < AVAILABLE_WINDOW_MS);
}

// Written with the service role: fundis can no longer edit their own row
// directly (migration 0008), so a resubmission can't set itself verified.
async function applyAsFundi(userId, payload) {
  const { data, error } = await adminClient
    .from('fundi_profiles')
    .upsert({
      id: userId,
      ...payload,
      verification_status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

async function getStatus(accessToken, userId) {
  const supabase = clientForUser(accessToken);
  const { data, error } = await supabase
    .from('fundi_profiles')
    .select('verification_status, category')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw toApiError(error);
  return data;
}

// Going online also serves as the app's periodic check-in.
async function setAvailability(userId, online) {
  const { data: fundi, error } = await adminClient
    .from('fundi_profiles')
    .select('verification_status')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw toApiError(error);
  if (!fundi) throw apiError(404, "You haven't applied as a fundi yet.", 'not_found');
  if (online && fundi.verification_status !== 'verified') {
    throw apiError(403, 'You can go online once your application is approved.', 'forbidden');
  }

  const { data, error: updateError } = await adminClient
    .from('fundi_profiles')
    .update({ is_online: online, last_seen_at: new Date().toISOString() })
    .eq('id', userId)
    .select('is_online, last_seen_at')
    .single();
  if (updateError) throw toApiError(updateError);
  return { is_online: data.is_online, available_now: isAvailableNow(data) };
}

function nairobiDayStart(now) {
  const local = new Date(now + NAIROBI_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - NAIROBI_OFFSET_MS;
}

// Weeks start on Monday.
function nairobiWeekStart(now) {
  const dayStart = nairobiDayStart(now);
  const daysSinceMonday = (new Date(dayStart + NAIROBI_OFFSET_MS).getUTCDay() + 6) % 7;
  return dayStart - daysSinceMonday * DAY_MS;
}

function totalSince(jobs, since) {
  const inRange = jobs.filter((j) => new Date(j.completed_at).getTime() >= since);
  return { amount: inRange.reduce((sum, j) => sum + (j.final_cost || 0), 0), jobs: inRange.length };
}

// Figures for the top of the fundi app: online state, earnings from completed
// jobs, and rating. Amounts are the agreed prices of completed jobs.
// Quotations a customer turned down in the last 3 days. The job has already
// gone to another fundi, so without this it would just vanish from Home.
// Best effort: Home still loads if this can't be read.
const DECLINED_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
async function recentlyDeclined(userId) {
  const { data, error } = await adminClient
    .from('job_quotations')
    .select('id, total, declined_at, jobs!inner(subcategory, category, area)')
    .eq('fundi_id', userId)
    .eq('stage', 'quote')
    .gte('declined_at', new Date(Date.now() - DECLINED_WINDOW_MS).toISOString())
    .order('declined_at', { ascending: false })
    .limit(5);
  if (error) { console.error('declined quotations not read', error.message); return []; }
  return data.map((q) => ({
    id: q.id, total: q.total, declined_at: q.declined_at,
    subcategory: q.jobs.subcategory, category: q.jobs.category, area: q.jobs.area,
  }));
}

async function getDashboard(userId) {
  const [fundiResult, jobsResult, cards, declined] = await Promise.all([
    adminClient.from('fundi_profiles').select('is_online, last_seen_at').eq('id', userId).maybeSingle(),
    adminClient
      .from('jobs')
      .select('category, final_cost, completed_at')
      .eq('fundi_id', userId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false }),
    fundiCards.cardsFor([userId]),
    recentlyDeclined(userId),
  ]);
  for (const result of [fundiResult, jobsResult]) {
    if (result.error) throw toApiError(result.error);
  }
  const fundi = fundiResult.data;
  if (!fundi) throw apiError(404, "You haven't applied as a fundi yet.", 'not_found');

  const jobs = jobsResult.data;
  const card = cards[userId] || { selfie_url: null, rating: { average: null, count: 0, starting_only: false } };
  const now = Date.now();
  const lastJob = jobs[0];

  return {
    is_online: fundi.is_online,
    available_now: isAvailableNow(fundi, now),
    today: totalSince(jobs, nairobiDayStart(now)),
    week: totalSince(jobs, nairobiWeekStart(now)),
    last_job: lastJob
      ? { amount: lastJob.final_cost, category: lastJob.category, completed_at: lastJob.completed_at }
      : null,
    jobs_completed: jobs.length,
    rating: card.rating,
    selfie_url: card.selfie_url,
    declined_quotes: declined,
  };
}

module.exports = { applyAsFundi, getStatus, setAvailability, getDashboard };
