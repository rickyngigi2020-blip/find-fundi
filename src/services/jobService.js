const { adminClient, clientForUser } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');

// Job writes go through the service-role client, because jobs have no
// client-side write policies: every change is authorised here instead, so a
// customer can't rewrite a quote and a fundi can't mark their own job paid.
// Reads still use the caller's RLS-scoped client.

async function loadJob(jobId) {
  const { data, error } = await adminClient.from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw toApiError(error);
  if (!data) throw apiError(404, 'Job not found.', 'not_found');
  return data;
}

// `expect` holds column values the row must still have at write time, so a
// check made a moment earlier can't be overtaken by a concurrent change.
async function updateJob(jobId, changes, expect = {}) {
  let query = adminClient
    .from('jobs')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  Object.entries(expect).forEach(([column, value]) => { query = query.eq(column, value); });
  const { data, error } = await query.select().maybeSingle();
  if (error) throw toApiError(error);
  if (!data) throw apiError(409, 'This job changed while you were working on it. Refresh and try again.', 'conflict');
  return data;
}

async function createJob(customerId, payload) {
  const { data, error } = await adminClient
    .from('jobs')
    .insert({ ...payload, customer_id: customerId })
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

// Adds the other party's name, phone and photo to every job that has a fundi
// assigned, so customer and fundi can call each other. Only jobs the caller
// already sees through RLS reach this, and only those three fields are shared.
async function withCounterparts(jobs, role) {
  const otherIds = [...new Set(jobs
    .filter((j) => j.fundi_id)
    .map((j) => (role === 'fundi' ? j.customer_id : j.fundi_id)))];
  if (!otherIds.length) return jobs;

  const { data, error } = await adminClient
    .from('profiles')
    .select('id, full_name, phone, avatar_url')
    .in('id', otherIds);
  if (error) throw toApiError(error);
  const byId = Object.fromEntries(data.map((p) => [p.id, p]));

  return jobs.map((j) => {
    if (!j.fundi_id) return j;
    const other = byId[role === 'fundi' ? j.customer_id : j.fundi_id];
    return other
      ? { ...j, counterpart: { full_name: other.full_name, phone: other.phone, avatar_url: other.avatar_url } }
      : j;
  });
}

async function listMine(accessToken, userId, role) {
  const supabase = clientForUser(accessToken);
  const column = role === 'fundi' ? 'fundi_id' : 'customer_id';
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq(column, userId)
    .order('created_at', { ascending: false });
  if (error) throw toApiError(error);
  return withCounterparts(data, role);
}

async function listFeed(accessToken) {
  const supabase = clientForUser(accessToken);
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'requested')
    .order('created_at', { ascending: false });
  if (error) throw toApiError(error);
  return data;
}

async function matchFundi(jobId, customerId, fundiId) {
  const job = await loadJob(jobId);
  if (job.customer_id !== customerId) throw apiError(403, 'You can only book fundis for your own jobs.', 'forbidden');
  if (job.status !== 'requested') throw apiError(409, 'This job has already been booked.', 'conflict');
  if (fundiId === customerId) throw apiError(400, "You can't book yourself for your own job.", 'invalid_request');

  const { data: fundi, error } = await adminClient
    .from('fundi_profiles')
    .select('id, category, verification_status')
    .eq('id', fundiId)
    .maybeSingle();
  if (error) throw toApiError(error);
  if (!fundi || fundi.verification_status !== 'verified' || fundi.category !== job.category) {
    throw apiError(400, "That fundi isn't available for this kind of job.", 'invalid_request');
  }

  const updated = await updateJob(jobId, { fundi_id: fundiId, status: 'matched' }, { status: 'requested' });
  const [withContact] = await withCounterparts([updated], 'customer');
  return withContact;
}

async function sendQuote(jobId, fundiId, { amount, note }) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the booked fundi can send a price.', 'forbidden');
  if (job.status !== 'matched') {
    throw apiError(409, 'The price can only be changed before the customer accepts it.', 'conflict');
  }
  return updateJob(jobId, { quote_amount: amount, quote_note: note, quoted_at: new Date().toISOString() }, { status: 'matched' });
}

async function acceptQuote(jobId, customerId, { payment_method, quoted_at }) {
  const job = await loadJob(jobId);
  if (job.customer_id !== customerId) throw apiError(403, 'Only the customer can accept this price.', 'forbidden');
  if (job.status !== 'matched' || !job.quote_amount) throw apiError(409, 'There is no price waiting for you on this job.', 'conflict');
  // The fundi may have changed the price while the customer had the page open.
  if (quoted_at && new Date(quoted_at).getTime() !== new Date(job.quoted_at).getTime()) {
    throw apiError(409, 'Your fundi has changed the price. Check the new price before accepting.', 'quote_changed');
  }
  try {
    return await updateJob(jobId, {
      status: 'in_progress',
      payment_method,
      final_cost: job.quote_amount,
      quote_accepted_at: new Date().toISOString(),
    }, { status: 'matched', quoted_at: job.quoted_at });
  } catch (err) {
    if (err.code === 'conflict') {
      throw apiError(409, 'Your fundi has changed the price. Check the new price before accepting.', 'quote_changed');
    }
    throw err;
  }
}

async function completeJob(jobId, fundiId) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the booked fundi can complete this job.', 'forbidden');
  if (job.status !== 'in_progress') {
    throw apiError(409, 'Agree on a price with the customer before marking the job complete.', 'conflict');
  }
  return updateJob(jobId, { status: 'completed', completed_at: new Date().toISOString() }, { status: 'in_progress' });
}

async function addReview(accessToken, jobId, { rating, comment }) {
  const supabase = clientForUser(accessToken);
  const { data, error } = await supabase
    .from('reviews')
    .insert({ job_id: jobId, rating, comment })
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

module.exports = { createJob, listMine, listFeed, matchFundi, sendQuote, acceptQuote, completeJob, addReview };
