const { adminClient } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');
const notify = require('./notificationService');

// Customers do not choose a fundi. A job is offered to one fundi at a time,
// best candidate first, and passes on when that fundi declines or runs out of
// time. Candidates are ranked by who is online right now, then by who is
// closest to the job.

// How long a fundi has to answer before the job moves on. Long enough to pick
// the phone up, short enough that a customer is not left waiting on a fundi
// who has put their phone down.
const OFFER_WINDOW_MS = 90 * 1000;

// Matches fundiService: a fundi counts as online only if they are toggled on
// and the app has checked in recently.
const AVAILABLE_WINDOW_MS = 10 * 60 * 1000;

function isAvailableNow(fundi, now) {
  return Boolean(fundi.is_online && fundi.last_seen_at
    && now - new Date(fundi.last_seen_at).getTime() < AVAILABLE_WINDOW_MS);
}

// Straight-line distance in km. Good enough for ranking who is nearest, and
// it needs no Google Maps key or paid Directions API.
function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Everyone who could do this job, best first. Excludes the customer (one
// account can be both customer and fundi) and anyone already offered it.
async function rankCandidates(job, round = job.search_round || 1) {
  // Only this round's offers exclude a fundi. Passing in an earlier round does
  // not bar them from the next pass.
  const { data: offers, error: offersError } = await adminClient
    .from('job_offers')
    .select('fundi_id')
    .eq('job_id', job.id)
    .eq('round', round);
  if (offersError) throw toApiError(offersError);
  const alreadyOffered = new Set(offers.map((o) => o.fundi_id));

  const { data: fundis, error } = await adminClient
    .from('fundi_profiles')
    .select('id, is_online, last_seen_at, profiles!fundi_profiles_id_fkey!inner(area, suspended_at)')
    .eq('verification_status', 'verified')
    .eq('category', job.category)
    .is('profiles.suspended_at', null);
  if (error) throw toApiError(error);

  const eligible = fundis.filter((f) => f.id !== job.customer_id && !alreadyOffered.has(f.id));
  if (!eligible.length) return [];

  // Live locations are only set while a fundi has sharing toggled on, so many
  // rows will be missing. Those fall back to matching the job's area.
  const { data: locations, error: locError } = await adminClient
    .from('fundi_locations')
    .select('fundi_id, lat, lng')
    .in('fundi_id', eligible.map((f) => f.id));
  if (locError) throw toApiError(locError);
  const locationById = Object.fromEntries(locations.map((l) => [l.fundi_id, l]));

  const now = Date.now();
  const hasJobCoords = Number.isFinite(job.customer_lat) && Number.isFinite(job.customer_lng);

  return eligible
    .map((f) => {
      const loc = locationById[f.id];
      const km = hasJobCoords && loc
        ? distanceKm(job.customer_lat, job.customer_lng, loc.lat, loc.lng)
        : null;
      return {
        id: f.id,
        online: isAvailableNow(f, now),
        km,
        sameArea: f.profiles.area === job.area,
      };
    })
    .sort((a, b) => {
      // Online first, as asked.
      if (a.online !== b.online) return Number(b.online) - Number(a.online);
      // Then nearest. A known distance always beats an unknown one.
      if (a.km !== null && b.km !== null) return a.km - b.km;
      if (a.km !== null) return -1;
      if (b.km !== null) return 1;
      // Neither is sharing location: prefer the fundi registered in the area.
      return Number(b.sameArea) - Number(a.sameArea);
    })
    .map((f) => f.id);
}

// Turns any pending offer that ran out of time into an 'expired' one. Called
// before reading or advancing a job, which is how offers time out without a
// background worker (the free tier has none).
async function expireStaleOffers(jobId) {
  const query = adminClient
    .from('job_offers')
    .update({ status: 'expired', responded_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString());
  const { error } = jobId ? await query.eq('job_id', jobId) : await query;
  if (error) throw toApiError(error);
}

async function pendingOffer(jobId) {
  const { data, error } = await adminClient
    .from('job_offers')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw toApiError(error);
  return data;
}

// Moves a job to its next candidate. Safe to call repeatedly: it does nothing
// if the job is already taken or an offer is still live.
async function advance(job) {
  if (job.status !== 'requested' || job.fundi_id) return null;

  await expireStaleOffers(job.id);
  const live = await pendingOffer(job.id);
  if (live) return live;

  let round = job.search_round || 1;
  let candidates = await rankCandidates(job, round);

  // Everyone in this round has had their turn. Go round again rather than
  // stopping: the customer is still waiting and fundis come online all day.
  if (!candidates.length) {
    const anyone = await eligibleFundiCount(job);
    if (!anyone) {
      await markExhausted(job);
      return null;
    }
    round += 1;
    const { error } = await adminClient.from('jobs').update({ search_round: round }).eq('id', job.id);
    if (error) throw toApiError(error);
    candidates = await rankCandidates(job, round);
    if (!candidates.length) return null;
  }

  const fundiId = candidates[0];
  const { data, error } = await adminClient
    .from('job_offers')
    .insert({
      job_id: job.id,
      fundi_id: fundiId,
      round,
      expires_at: new Date(Date.now() + OFFER_WINDOW_MS).toISOString(),
    })
    .select()
    .single();
  if (error) throw toApiError(error);

  if (job.search_exhausted_at) {
    await adminClient.from('jobs').update({ search_exhausted_at: null }).eq('id', job.id);
  }

  await notify.jobOffered(job, fundiId).catch((e) => console.error('jobOffered failed', e.message));
  return data;
}

// Could anyone at all do this job? Distinguishes "nobody is free right now"
// from "this category has no verified fundis", which are different problems
// and only the second is worth telling the customer about.
async function eligibleFundiCount(job) {
  const { data, error } = await adminClient
    .from('fundi_profiles')
    .select('id, profiles!fundi_profiles_id_fkey!inner(suspended_at)')
    .eq('verification_status', 'verified')
    .eq('category', job.category)
    .is('profiles.suspended_at', null);
  if (error) throw toApiError(error);
  return data.filter((f) => f.id !== job.customer_id).length;
}

async function markExhausted(job) {
  if (job.search_exhausted_at) return;
  const { error } = await adminClient
    .from('jobs')
    .update({ search_exhausted_at: new Date().toISOString() })
    .eq('id', job.id);
  if (error) throw toApiError(error);
  await notify.searchExhausted(job).catch((e) => console.error('searchExhausted failed', e.message));
}

// Every job still waiting for a fundi, moved on one step. This is what the
// scheduled ping calls, so a search keeps running with nobody's page open.
async function advanceAllWaiting() {
  const { data, error } = await adminClient
    .from('jobs')
    .select('*')
    .eq('status', 'requested')
    .is('fundi_id', null);
  if (error) throw toApiError(error);

  let offered = 0;
  for (const job of data) {
    try {
      if (await advance(job)) offered += 1;
    } catch (err) {
      console.error('advanceAllWaiting failed for job', job.id, err.message);
    }
  }
  return { waiting: data.length, offered };
}


// The one job currently sitting in front of this fundi, if any.
async function offerForFundi(fundiId) {
  await expireStaleOffers();
  const { data, error } = await adminClient
    .from('job_offers')
    .select('*, jobs!inner(*)')
    .eq('fundi_id', fundiId)
    .eq('status', 'pending')
    .order('offered_at', { ascending: true })
    .limit(1);
  if (error) throw toApiError(error);
  if (!data.length) return null;

  const offer = data[0];
  // The job may have been cancelled or taken since the offer went out.
  if (offer.jobs.status !== 'requested' || offer.jobs.fundi_id) return null;
  return offer;
}

async function acceptOffer(jobId, fundiId) {
  await expireStaleOffers(jobId);

  // Claim the offer first. If this matches nothing the offer expired or was
  // already answered, and we must not book the job.
  const { data: claimed, error: claimError } = await adminClient
    .from('job_offers')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('job_id', jobId)
    .eq('fundi_id', fundiId)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (claimError) throw toApiError(claimError);
  if (!claimed) throw apiError(409, 'That job is no longer waiting for you.', 'conflict');

  // Then take the job, but only while it is still unbooked.
  const { data: job, error } = await adminClient
    .from('jobs')
    .update({ fundi_id: fundiId, status: 'matched' })
    .eq('id', jobId)
    .eq('status', 'requested')
    .is('fundi_id', null)
    .select()
    .maybeSingle();
  if (error) throw toApiError(error);
  if (!job) {
    await adminClient.from('job_offers')
      .update({ status: 'expired' }).eq('job_id', jobId).eq('fundi_id', fundiId);
    throw apiError(409, 'That job was taken already.', 'conflict');
  }

  await notify.fundiBooked(job).catch((e) => console.error('fundiBooked failed', e.message));
  return job;
}

async function declineOffer(jobId, fundiId) {
  const { data: declined, error } = await adminClient
    .from('job_offers')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('job_id', jobId)
    .eq('fundi_id', fundiId)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (error) throw toApiError(error);
  if (!declined) throw apiError(409, 'That job is no longer waiting for you.', 'conflict');

  const { data: job, error: jobError } = await adminClient
    .from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (jobError) throw toApiError(jobError);
  if (job) await advance(job);
  return { declined: true };
}

module.exports = {
  advance,
  advanceAllWaiting,
  offerForFundi,
  acceptOffer,
  declineOffer,
  expireStaleOffers,
  rankCandidates,
  OFFER_WINDOW_MS,
};
