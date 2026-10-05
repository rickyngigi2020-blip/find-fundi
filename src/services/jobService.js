const { adminClient, clientForUser } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');
const notify = require('./notificationService');
const matching = require('./matchingService');
const { RELEASE_REASON_KEYS } = require('../utils/releaseReasons');

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
  // The customer does not pick a fundi: the job goes straight to the best
  // candidate as an offer. A failure here must not lose the job the customer
  // just described, so it is logged and the next poll retries the search.
  await matching.advance(data).catch((e) => console.error('first offer failed', e.message));
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

  // The customer polls this screen while waiting to be matched, and the free
  // tier has no background worker, so each poll is what moves a stalled search
  // on to the next fundi.
  if (role !== 'fundi') {
    await Promise.all(data
      .filter((j) => j.status === 'requested' && !j.fundi_id)
      .map((j) => matching.advance(j).catch((e) => console.error('advance failed', e.message))));
  }

  // A completed job carries the review it already has, so the page can show
  // the rating that was given instead of offering the form a second time.
  const completed = data.filter((j) => j.status === 'completed').map((j) => j.id);
  if (completed.length) {
    const { data: reviews, error: reviewError } = await supabase
      .from('reviews')
      .select('job_id, rating, comment, created_at')
      .in('job_id', completed);
    if (reviewError) throw toApiError(reviewError);
    const byJob = Object.fromEntries(reviews.map((r) => [r.job_id, r]));
    data.forEach((j) => { j.review = byJob[j.id] || null; });
  }

  // A price waiting to be answered belongs on both sides' screens.
  const live = data.filter((j) => j.status === 'in_progress').map((j) => j.id);
  if (live.length) {
    const { data: changes, error: changeError } = await adminClient
      .from('job_price_changes')
      .select('*')
      .in('job_id', live)
      .is('accepted_at', null)
      .is('declined_at', null);
    if (changeError) throw toApiError(changeError);
    const byJob = Object.fromEntries(changes.map((c) => [c.job_id, c]));
    data.forEach((j) => { j.pending_price_change = byJob[j.id] || null; });
  }

  // The reason someone gave for cancelling is for the fundi who lost the work
  // and for admins, not for the person who wrote it or for the other side to
  // re-read afterwards. It never leaves the API on this route.
  data.forEach((j) => { delete j.cancel_reason; });

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

async function sendQuote(jobId, fundiId, { amount, note }) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the booked fundi can send a price.', 'forbidden');
  if (job.status !== 'matched') {
    throw apiError(409, 'The price can only be changed before the customer accepts it.', 'conflict');
  }
  const updated = await updateJob(jobId, { quote_amount: amount, quote_note: note, quoted_at: new Date().toISOString() }, { status: 'matched' });
  await notify.priceSent(updated);
  return updated;
}

async function acceptQuote(jobId, customerId, { payment_method, quoted_at }) {
  const job = await loadJob(jobId);
  if (job.customer_id !== customerId) throw apiError(403, 'Only the customer can accept this price.', 'forbidden');
  if (job.status !== 'matched' || !job.quote_amount) throw apiError(409, 'There is no price waiting for you on this job.', 'conflict');
  // The fundi may have changed the price while the customer had the page open.
  if (quoted_at && new Date(quoted_at).getTime() !== new Date(job.quoted_at).getTime()) {
    throw apiError(409, 'Your fundi has changed the price. Check the new price before accepting.', 'quote_changed');
  }
  let updated;
  try {
    updated = await updateJob(jobId, {
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
  await notify.priceAccepted(updated);
  return updated;
}

async function completeJob(jobId, fundiId) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the booked fundi can complete this job.', 'forbidden');
  if (job.status !== 'in_progress') {
    throw apiError(409, 'Agree on a price with the customer before marking the job complete.', 'conflict');
  }
  const updated = await updateJob(jobId, { status: 'completed', completed_at: new Date().toISOString() }, { status: 'in_progress' });
  await notify.jobCompleted(updated);
  return updated;
}

const OPEN_STATUSES = ['requested', 'matched', 'in_progress'];

// Clears everything tied to the booked fundi, so the job can be booked again.
const UNBOOKED = {
  fundi_id: null, quote_amount: null, quote_note: null, quoted_at: null,
  quote_accepted_at: null, final_cost: null, payment_method: null,
};

// `by` is 'customer' (their own job) or 'admin' (any job not yet finished).
async function cancelJob(jobId, { by, customerId, reason }) {
  const job = await loadJob(jobId);
  if (by === 'customer' && job.customer_id !== customerId) throw apiError(403, 'You can only cancel your own jobs.', 'forbidden');
  if (!OPEN_STATUSES.includes(job.status)) {
    throw apiError(409, job.status === 'completed' ? 'This job is already complete.' : 'This job is already cancelled.', 'conflict');
  }
  const updated = await updateJob(jobId, {
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancelled_by: by,
    cancel_reason: reason,
  }, { status: job.status });
  await notify.jobCancelled(updated, job.fundi_id);
  return updated;
}

// The booked fundi can't do the job after all: it goes back into the search
// and is offered to the next candidate. The fundi who dropped it is already
// excluded, because they hold an accepted offer for this job.
//
// Only possible before the customer accepts a price. Once a price is agreed
// the work is agreed, and walking away then is a broken promise to someone who
// has arranged their day around it, not a pass on an offer.
async function releaseJob(jobId, fundiId, { reason, note }) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the booked fundi can turn this job down.', 'forbidden');
  if (job.status === 'in_progress' || job.quote_accepted_at) {
    throw apiError(409, 'You agreed a price for this job, so it can no longer be turned down. Call the customer to sort it out.', 'conflict');
  }
  if (job.status !== 'matched') {
    throw apiError(409, "This job can't be turned down any more.", 'conflict');
  }
  if (!RELEASE_REASON_KEYS.includes(reason)) {
    throw apiError(400, 'Choose a reason for turning this job down.', 'invalid_request');
  }

  const updated = await updateJob(jobId, { ...UNBOOKED, status: 'requested' }, { status: 'matched', fundi_id: fundiId });

  // Kept on the offer this fundi accepted, so the job carries the history of
  // everyone who passed on it and why.
  await adminClient
    .from('job_offers')
    .update({ release_reason: reason, release_note: note || null, released_at: new Date().toISOString() })
    .eq('job_id', jobId)
    .eq('fundi_id', fundiId);

  await notify.fundiReleased(updated, fundiId);
  await matching.advance(updated).catch((e) => console.error('re-offer after release failed', e.message));
  return updated;
}


// ---------- price revisions ----------
// Only the fundi doing agreed work can revise its price, and only upward or
// downward with a reason the customer gets to read. Work carries on at the old
// price until they accept, so nobody is committed to a number they have not seen.

async function pendingPriceChange(jobId) {
  const { data, error } = await adminClient
    .from('job_price_changes')
    .select('*')
    .eq('job_id', jobId)
    .is('accepted_at', null)
    .is('declined_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw toApiError(error);
  return data[0] || null;
}

async function revisePrice(jobId, fundiId, { amount, reason }) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the fundi on this job can change its price.', 'forbidden');
  if (job.status !== 'in_progress') {
    throw apiError(409, 'A price can only be revised after the customer has accepted the first one and before the job is finished.', 'conflict');
  }
  if (await pendingPriceChange(jobId)) {
    throw apiError(409, 'You already sent a new price. Wait for the customer to answer it.', 'conflict');
  }

  const previous = job.final_cost || job.quote_amount;
  if (amount === previous) throw apiError(400, 'That is the same price the customer already agreed.', 'invalid_request');

  const { data, error } = await adminClient
    .from('job_price_changes')
    .insert({ job_id: jobId, fundi_id: fundiId, previous_amount: previous, amount, reason })
    .select()
    .single();
  if (error) throw toApiError(error);

  await notify.priceRevised(job, data).catch((e) => console.error('priceRevised failed', e.message));
  return data;
}

async function answerPriceChange(jobId, customerId, accept) {
  const job = await loadJob(jobId);
  if (job.customer_id !== customerId) throw apiError(403, 'Only the customer can answer a new price.', 'forbidden');

  const change = await pendingPriceChange(jobId);
  if (!change) throw apiError(409, 'There is no new price waiting on this job.', 'conflict');

  const now = new Date().toISOString();
  const { error } = await adminClient
    .from('job_price_changes')
    .update(accept ? { accepted_at: now } : { declined_at: now })
    .eq('id', change.id);
  if (error) throw toApiError(error);

  // Declining leaves the agreed price standing. The customer can cancel if
  // they would rather not go on, which is a separate, deliberate step.
  if (!accept) {
    await notify.priceRevisionDeclined(job, change).catch((e) => console.error('notify failed', e.message));
    return { ...job, pending_price_change: null };
  }

  const updated = await updateJob(jobId, { final_cost: change.amount }, { status: 'in_progress' });
  await notify.priceRevisionAccepted(updated, change).catch((e) => console.error('notify failed', e.message));
  return updated;
}

// The fundi has left to buy parts. Says so on the customer's screen instead of
// leaving a job that looks abandoned.
async function setMaterialsPause(jobId, fundiId, { note, expectedBack }) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the fundi on this job can update it.', 'forbidden');
  if (job.status !== 'in_progress') throw apiError(409, 'This job is not in progress.', 'conflict');

  const updated = await updateJob(jobId, {
    materials_since: new Date().toISOString(),
    materials_note: note || null,
    materials_expected_back: expectedBack || null,
  }, { status: 'in_progress' });
  await notify.gettingMaterials(updated).catch((e) => console.error('gettingMaterials failed', e.message));
  return updated;
}

async function clearMaterialsPause(jobId, fundiId) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the fundi on this job can update it.', 'forbidden');
  const updated = await updateJob(jobId, {
    materials_since: null, materials_note: null, materials_expected_back: null,
  }, { status: 'in_progress' });
  await notify.backOnSite(updated).catch((e) => console.error('backOnSite failed', e.message));
  return updated;
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

module.exports = {
  createJob, listMine, listFeed, sendQuote, revisePrice, answerPriceChange, pendingPriceChange, setMaterialsPause, clearMaterialsPause, acceptQuote, completeJob, cancelJob, releaseJob, addReview,
};
