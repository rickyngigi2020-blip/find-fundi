const { clientForUser } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');

async function upsertProfile(accessToken, userId, { full_name, phone, role, area, street }) {
  const supabase = clientForUser(accessToken);
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: userId, full_name, phone, role, area, street, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

async function getOwnProfile(accessToken, userId) {
  const supabase = clientForUser(accessToken);
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw toApiError(error);

  let fundiProfile = null;
  if (profile.role === 'fundi') {
    const { data: fp } = await supabase.from('fundi_profiles').select('*').eq('id', userId).maybeSingle();
    fundiProfile = fp;
  }
  return { ...profile, fundi_profile: fundiProfile };
}

module.exports = { upsertProfile, getOwnProfile };
