const { clientForUser } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');

async function applyAsFundi(accessToken, userId, payload) {
  const supabase = clientForUser(accessToken);
  const { data, error } = await supabase
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

async function searchVerifiedFundis(accessToken, { category, area }) {
  const supabase = clientForUser(accessToken);
  let query = supabase
    .from('fundi_profiles')
    .select('id, category, years_experience, bio, profiles!inner(full_name, area)')
    .eq('verification_status', 'verified');

  if (category) query = query.eq('category', category);
  if (area) query = query.eq('profiles.area', area);

  const { data, error } = await query;
  if (error) throw toApiError(error);
  return data;
}

module.exports = { applyAsFundi, getStatus, searchVerifiedFundis };
