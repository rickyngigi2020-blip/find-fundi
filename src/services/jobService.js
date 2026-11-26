const { adminClient, clientForUser } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');
const notify = require('./notificationService');
const matching = require('./matchingService');
const fundiCards = require('./fundiCardService');
const serviceRates = require('./serviceRateService');
const commissions = require('./commissionService');
const { RELEASE_REASON_KEYS } = require('../utils/releaseReasons');
const { withService, totalOf } = require('../utils/quoteItems');

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
// already sees through RLS reach this, and only name, phone and photo are shared, plus the fundi's selfie and rating with their customer.
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
  // A customer also sees the fundi's selfie and rating once the fundi has the job.
  const cards = role === 'fundi' ? {} : await fundiCards.cardsFor(otherIds);

  return jobs.map((j) => {
    if (!j.fundi_id) return j;
    const otherId = role === 'fundi' ? j.customer_id : j.fundi_id;
    const other = byId[otherId];
    if (!other) return j;
    const card = cards[otherId];
    return {
      ...j,
      counterpart: {
        full_name: other.full_name,
        phone: other.phone,
        avatar_url: other.avatar_url,
        ...(card ? { selfie_url: card.selfie_url, rating: card.rating } : {}),
      },
    };
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

  // The latest quotation, and an update waiting to be answered, belong on both
  // sides' cards so each knows whether it is their move.
  const live = data.filter((j) => ['matched', 'in_progress'].includes(j.status) && j.fundi_id);
  if (live.length) {
    const { data: versions, error: quoteError } = await adminClient
      .from('job_quotations')
      .select('*')
      .in('job_id', live.map((j) => j.id))
      .order('version', { ascending: true });
    if (quoteError) throw toApiError(quoteError);
    live.forEach((j) => {
      const mine = versions.filter((q) => q.job_id === j.id && q.fundi_id === j.fundi_id);
      const latest = mine[mine.length - 1] || null;
      j.latest_quotation = latest ? withStatus(latest) : null;
      const pending = j.status === 'in_progress' && latest && latest.stage === 'update' && isUnanswered(latest) ? latest : null;
      j.pending_price_change = pending ? asPriceChange(pending) : null;
    });
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

// ---------- quotations ----------
// Every price is a quotation: a list of lines (src/utils/quoteItems.js), kept
// as numbered versions in job_quotations. The jobs row keeps the summary
// (quote_amount, final_cost) that matching, commission and admin read.

const isUnanswered = (q) => !q.accepted_at && !q.declined_at && !q.replaced_at;

function quoteStatus(q) {
  if (q.accepted_at) return 'accepted';
  if (q.declined_at) return 'declined';
  if (q.replaced_at) return 'replaced';
  return 'waiting';
}

const withStatus = (q) => ({ ...q, status: quoteStatus(q) });

// The shape the pages read for an update waiting on the customer, kept from
// when revisions had their own table.
const asPriceChange = (q) => ({
  ...withStatus(q), amount: q.total, previous_amount: q.previous_total, reason: q.note,
});

async function quotationsFor(jobId) {
  const { data, error } = await adminClient
    .from('job_quotations')
    .select('*')
    .eq('job_id', jobId)
    .order('version', { ascending: true });
  if (error) throw toApiError(error);
  return data;
}

// Adds the next version. Two sends at the same moment would both pick the same
// number; the unique (job_id, version) key refuses the second.
async function addQuotation(jobId, row) {
  const existing = await quotationsFor(jobId);
  const version = existing.length ? existing[existing.length - 1].version + 1 : 1;
  const { data, error } = await adminClient
    .from('job_quotations')
    .insert({ ...row, job_id: jobId, version })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw apiError(409, 'This job changed while you were working on it. Refresh and try again.', 'conflict');
    throw toApiError(error);
  }
  return data;
}

async function answerQuotation(id, changes) {
  const { error } = await adminClient
    .from('job_quotations')
    .update(changes)
    .eq('id', id)
    .is('accepted_at', null)
    .is('declined_at', null)
    .is('replaced_at', null);
  if (error) throw toApiError(error);
}

// The quotation the customer is being asked about before work starts: the
// newest one from the booked fundi that nobody has answered.
async function waitingQuote(job) {
  const versions = await quotationsFor(job.id);
  return versions.filter((q) => q.stage === 'quote' && q.fundi_id === job.fundi_id && isUnanswered(q)).pop() || null;
}

// `items` are the fundi's own lines, already cleaned. `serviceRateId` puts the
// listed service first at its menu price: the amount comes from the rate,
// never from the caller, so a listed service always costs its listed price.
async function sendQuote(jobId, fundiId, { items, note, serviceRateId }) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the booked fundi can send a quotation.', 'forbidden');
  if (job.status !== 'matched') {
    throw apiError(409, 'The quotation can only be changed before the customer accepts it.', 'conflict');
  }
  let lines = items;
  let rate = null;
  if (serviceRateId) {
    rate = await serviceRates.usableForJob(serviceRateId, job);
    lines = withService(items, rate);
  }
  if (!lines.length) throw apiError(400, 'Add at least one line to your quotation.', 'invalid_request');
  const total = totalOf(lines);

  const earlier = await waitingQuote(job);
  const quotation = await addQuotation(jobId, {
    fundi_id: fundiId, stage: 'quote', items: lines, total, note, service_rate_id: rate ? rate.id : null,
  });
  if (earlier) await answerQuotation(earlier.id, { replaced_at: quotation.created_at });

  const updated = await updateJob(jobId, {
    quote_amount: total,
    quote_note: note,
    quoted_at: quotation.created_at,
    service_rate_id: rate ? rate.id : null,
    service_name: rate ? rate.name : null,
  }, { status: 'matched', fundi_id: fundiId });
  await notify.priceSent(updated);
  return updated;
}

const QUOTE_CHANGED = 'Your fundi has changed the quotation. Check the new one before answering.';

// The fundi may have changed the quotation while the customer had it open.
function checkNotStale(job, quotedAt) {
  if (quotedAt && new Date(quotedAt).getTime() !== new Date(job.quoted_at).getTime()) {
    throw apiError(409, QUOTE_CHANGED, 'quote_changed');
  }
}

async function acceptQuote(jobId, customerId, { payment_method, quoted_at }) {
  const job = await loadJob(jobId);
  if (job.customer_id !== customerId) throw apiError(403, 'Only the customer can accept this quotation.', 'forbidden');
  if (job.status !== 'matched' || !job.quote_amount) throw apiError(409, 'There is no quotation waiting for you on this job.', 'conflict');
  checkNotStale(job, quoted_at);
  let updated;
  try {
    updated = await updateJob(jobId, {
      status: 'in_progress',
      payment_method,
      final_cost: job.quote_amount,
      quote_accepted_at: new Date().toISOString(),
    }, { status: 'matched', quoted_at: job.quoted_at });
  } catch (err) {
    if (err.code === 'conflict') throw apiError(409, QUOTE_CHANGED, 'quote_changed');
    throw err;
  }
  const quotation = await waitingQuote(job);
  if (quotation) await answerQuotation(quotation.id, { accepted_at: updated.quote_accepted_at });
  await notify.priceAccepted(updated);
  return updated;
}

// The customer would rather not go ahead at this price. The job goes back into
// the search for the next fundi, and this fundi is barred from it for good,
// exactly as if they had turned it down themselves (matching reads released_at).
async function declineQuote(jobId, customerId, { note, quoted_at }) {
  const job = await loadJob(jobId);
  if (job.customer_id !== customerId) throw apiError(403, 'Only the customer can turn down this quotation.', 'forbidden');
  if (job.status !== 'matched' || !job.quote_amount) throw apiError(409, 'There is no quotation waiting for you on this job.', 'conflict');
  checkNotStale(job, quoted_at);

  const fundiId = job.fundi_id;
  const quotation = await waitingQuote(job);
  let updated;
  try {
    updated = await updateJob(jobId, { ...UNBOOKED, status: 'requested' }, { status: 'matched', fundi_id: fundiId, quoted_at: job.quoted_at });
  } catch (err) {
    if (err.code === 'conflict') throw apiError(409, QUOTE_CHANGED, 'quote_changed');
    throw err;
  }
  const now = new Date().toISOString();
  if (quotation) await answerQuotation(quotation.id, { declined_at: now });

  const { error } = await adminClient
    .from('job_offers')
    .update({ release_reason: 'customer_declined_price', release_note: note || null, released_at: now })
    .eq('job_id', jobId)
    .eq('fundi_id', fundiId);
  if (error) throw toApiError(error);

  await notify.quoteDeclined(updated, fundiId, job.quote_amount).catch((e) => console.error('quoteDeclined failed', e.message));
  await matching.advance(updated).catch((e) => console.error('re-offer after declined quote failed', e.message));
  return updated;
}

async function completeJob(jobId, fundiId) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the booked fundi can complete this job.', 'forbidden');
  if (job.status !== 'in_progress') {
    throw apiError(409, 'Agree on a price with the customer before marking the job complete.', 'conflict');
  }
  const updated = await updateJob(jobId, { status: 'completed', completed_at: new Date().toISOString() }, { status: 'in_progress' });
  // Record the commission now. If this fails the wallet and the lock repair it
  // the next time they are read, so the job is never left owing nothing.
  await commissions.reconcile(fundiId).catch((e) => console.error('commission not recorded', jobId, e.message));
  await notify.jobCompleted(updated);
  return updated;
}

const OPEN_STATUSES = ['requested', 'matched', 'in_progress'];

// Clears everything tied to the booked fundi, so the job can be booked again.
const UNBOOKED = {
  fundi_id: null, quote_amount: null, quote_note: null, quoted_at: null,
  service_rate_id: null, service_name: null,
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

  // A quotation they had sent is no longer on the table.
  const unanswered = await waitingQuote(job);
  if (unanswered) await answerQuotation(unanswered.id, { replaced_at: new Date().toISOString() });

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


// ---------- updated quotations ----------
// Only the fundi doing agreed work can update its quotation, with a reason the
// customer gets to read. The listed service line can't be touched; the other
// lines are replaced by what the fundi sends, so the customer sees what was
// added or changed since they agreed. Work carries on at the agreed price until
// they accept, so nobody is committed to a number they have not seen.

async function pendingPriceChange(jobId) {
  const versions = await quotationsFor(jobId);
  const latest = versions[versions.length - 1];
  return latest && latest.stage === 'update' && isUnanswered(latest) ? asPriceChange(latest) : null;
}

// The last version the customer said yes to.
function agreedQuotation(versions, job) {
  const agreed = versions.filter((q) => q.fundi_id === job.fundi_id && q.accepted_at).pop();
  if (agreed) return agreed;
  // A job priced before quotations existed and not copied across.
  return { items: [{ id: 'line1', kind: 'other', description: 'Agreed price', qty: null, unit: null, amount: job.final_cost || job.quote_amount }] };
}

// `items` are the fundi's own lines, already cleaned. `legacyTotal` is a new
// total from an app version that only sends one number.
async function revisePrice(jobId, fundiId, { items, reason, legacyTotal }) {
  const job = await loadJob(jobId);
  if (job.fundi_id !== fundiId) throw apiError(403, 'Only the fundi on this job can update its quotation.', 'forbidden');
  if (job.status !== 'in_progress') {
    throw apiError(409, 'A quotation can only be updated after the customer has accepted it and before the job is finished.', 'conflict');
  }
  if (await pendingPriceChange(jobId)) {
    throw apiError(409, 'You already sent an updated quotation. Wait for the customer to answer it.', 'conflict');
  }

  const versions = await quotationsFor(jobId);
  const service = agreedQuotation(versions, job).items.find((line) => line.kind === 'service');
  let lines;
  if (legacyTotal) {
    lines = service && legacyTotal > service.amount
      ? [service, { id: 'revised', kind: 'other', description: 'Revised price', qty: null, unit: null, amount: legacyTotal - service.amount }]
      : [{ id: 'revised', kind: 'other', description: 'Revised price', qty: null, unit: null, amount: legacyTotal }];
  } else {
    lines = service ? [service, ...items] : items;
  }
  if (!lines.length) throw apiError(400, 'Add at least one line to your quotation.', 'invalid_request');
  const total = totalOf(lines);

  const previous = job.final_cost || job.quote_amount;
  if (total === previous) throw apiError(400, 'That comes to the same total the customer already agreed.', 'invalid_request');

  const quotation = await addQuotation(jobId, {
    fundi_id: fundiId, stage: 'update', items: lines, total, previous_total: previous, note: reason, service_rate_id: job.service_rate_id,
  });
  // Touching the job sends the customer's page a Realtime signal to reload.
  await updateJob(jobId, {}, { status: 'in_progress' });

  const change = asPriceChange(quotation);
  await notify.priceRevised(job, change).catch((e) => console.error('priceRevised failed', e.message));
  return change;
}

async function answerPriceChange(jobId, customerId, accept) {
  const job = await loadJob(jobId);
  if (job.customer_id !== customerId) throw apiError(403, 'Only the customer can answer an updated quotation.', 'forbidden');

  const change = await pendingPriceChange(jobId);
  if (!change) throw apiError(409, 'There is no updated quotation waiting on this job.', 'conflict');

  const now = new Date().toISOString();
  await answerQuotation(change.id, accept ? { accepted_at: now } : { declined_at: now });

  // Declining leaves the agreed price standing. The customer can cancel if
  // they would rather not go on, which is a separate, deliberate step.
  if (!accept) {
    const touched = await updateJob(jobId, {}, { status: 'in_progress' });
    await notify.priceRevisionDeclined(job, change).catch((e) => console.error('notify failed', e.message));
    return { ...touched, pending_price_change: null };
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

// ---------- the job thread ----------
// Everything that happened to a job's price, in order, for the customer and
// the fundi booked on it now: the page draws it like a chat. Talking happens
// on the phone, so there are no typed messages, only quotations and answers.
async function thread(userId, jobId) {
  const job = await loadJob(jobId);
  let role = null;
  if (job.customer_id === userId) role = 'customer';
  else if (job.fundi_id && job.fundi_id === userId) role = 'fundi';
  if (!role) throw apiError(404, 'Job not found.', 'not_found');

  const [versions, { data: offers, error: offerError }] = await Promise.all([
    quotationsFor(jobId),
    adminClient.from('job_offers').select('fundi_id, status, responded_at, released_at, release_reason').eq('job_id', jobId),
  ]);
  if (offerError) throw toApiError(offerError);

  const events = [];
  if (role === 'customer') events.push({ type: 'booked', at: job.created_at });

  // Fundis who had the job before: the customer sees that it happened and the
  // price, never who they were.
  if (role === 'customer') {
    offers.filter((o) => o.released_at && o.fundi_id !== job.fundi_id).forEach((o) => {
      const theirs = versions.filter((q) => q.fundi_id === o.fundi_id).pop();
      events.push({
        type: 'earlier_fundi',
        at: o.released_at,
        declined_by_customer: o.release_reason === 'customer_declined_price',
        total: theirs ? theirs.total : null,
      });
    });
  }

  const current = offers.find((o) => o.fundi_id === job.fundi_id && o.status === 'accepted');
  if (job.fundi_id && current && current.responded_at) events.push({ type: 'matched', at: current.responded_at });

  versions.filter((q) => q.fundi_id === job.fundi_id).forEach((q) => {
    events.push({ type: 'quotation', at: q.created_at, quotation: withStatus(q) });
    if (q.accepted_at && q.stage === 'quote') {
      events.push({ type: 'accepted', at: q.accepted_at, total: q.total, payment_method: job.payment_method });
    } else if (q.stage === 'update' && (q.accepted_at || q.declined_at)) {
      events.push({
        type: 'update_answer', at: q.accepted_at || q.declined_at, accepted: !!q.accepted_at, total: q.total, previous_total: q.previous_total,
      });
    }
  });

  if (job.materials_since) {
    events.push({ type: 'materials', at: job.materials_since, note: job.materials_note, expected_back: job.materials_expected_back });
  }
  if (job.completed_at) events.push({ type: 'completed', at: job.completed_at });
  if (job.cancelled_at) events.push({ type: 'cancelled', at: job.cancelled_at, by: job.cancelled_by });

  events.sort((a, b) => new Date(a.at) - new Date(b.at));

  delete job.cancel_reason;
  const [withPeople] = await withCounterparts([job], role);
  const latest = versions.filter((q) => q.fundi_id === job.fundi_id).pop();
  withPeople.latest_quotation = latest ? withStatus(latest) : null;
  withPeople.pending_price_change = job.status === 'in_progress' && latest && latest.stage === 'update' && isUnanswered(latest)
    ? asPriceChange(latest) : null;
  return { role, job: withPeople, events };
}

module.exports = {
  thread, declineQuote,
  createJob, listMine, listFeed, sendQuote, revisePrice, answerPriceChange, pendingPriceChange, setMaterialsPause, clearMaterialsPause, acceptQuote, completeJob, cancelJob, releaseJob, addReview,
};
