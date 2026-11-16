const { adminClient } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');

// A fundi's rating starts at the figure an admin gave them and is moved by
// customer reviews. The starting rating counts as this many reviews, so one
// review nudges a new fundi's rating and the admin's figure fades as real
// reviews pile up. Without a starting rating the rating is the plain average.
const STARTING_WEIGHT = 3;

// Selfie links are signed and short-lived; a page asks again when it reloads.
const SELFIE_LINK_SECONDS = 60 * 60;

function blend(startingRating, ratings) {
  const count = ratings.length;
  const sum = ratings.reduce((a, b) => a + b, 0);
  let average = null;
  if (startingRating != null) average = (startingRating * STARTING_WEIGHT + sum) / (STARTING_WEIGHT + count);
  else if (count) average = sum / count;
  return {
    average: average === null ? null : Math.round(average * 10) / 10,
    count,
    // True while the number is still only the admin's starting rating.
    starting_only: startingRating != null && count === 0,
  };
}

// Selfie link and rating for each fundi, keyed by id. The selfie bucket has no
// read policy, so a link only exists because the API made one here.
async function cardsFor(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return {};
  const [fundis, reviews] = await Promise.all([
    adminClient.from('fundi_profiles').select('id, starting_rating, selfie_path').in('id', unique),
    adminClient.from('reviews').select('rating, jobs!inner(fundi_id)').in('jobs.fundi_id', unique),
  ]);
  if (fundis.error) throw toApiError(fundis.error);
  if (reviews.error) throw toApiError(reviews.error);

  const ratingsBy = {};
  reviews.data.forEach((r) => { (ratingsBy[r.jobs.fundi_id] ||= []).push(r.rating); });

  const cards = {};
  await Promise.all(fundis.data.map(async (f) => {
    let selfieUrl = null;
    if (f.selfie_path) {
      const { data } = await adminClient.storage.from('fundi-identity').createSignedUrl(f.selfie_path, SELFIE_LINK_SECONDS);
      selfieUrl = data ? data.signedUrl : null;
    }
    cards[f.id] = { selfie_url: selfieUrl, rating: blend(f.starting_rating == null ? null : Number(f.starting_rating), ratingsBy[f.id] || []) };
  }));
  return cards;
}

module.exports = { blend, cardsFor, STARTING_WEIGHT };
