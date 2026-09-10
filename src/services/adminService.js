const { adminClient } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');

async function listFundiApplications() {
  const { data, error } = await adminClient
    .from('fundi_profiles')
    .select('*, profiles!inner(full_name, phone, area)')
    .order('created_at', { ascending: true });
  if (error) throw toApiError(error);
  return data;
}

async function setVerificationStatus(fundiId, status) {
  const { data, error } = await adminClient
    .from('fundi_profiles')
    .update({ verification_status: status, updated_at: new Date().toISOString() })
    .eq('id', fundiId)
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

module.exports = { listFundiApplications, setVerificationStatus };
