const { clientForUser } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');

async function createJob(accessToken, customerId, payload) {
  const supabase = clientForUser(accessToken);
  const { data, error } = await supabase
    .from('jobs')
    .insert({ customer_id: customerId, ...payload })
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
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
  return data;
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

async function matchFundi(accessToken, jobId, customerId, fundiId) {
  const supabase = clientForUser(accessToken);
  const { data, error } = await supabase
    .from('jobs')
    .update({ fundi_id: fundiId, status: 'matched', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('customer_id', customerId)
    .eq('status', 'requested')
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

async function confirmBooking(accessToken, jobId, customerId, { payment_method, estimated_cost_min, estimated_cost_max }) {
  const supabase = clientForUser(accessToken);
  const { data, error } = await supabase
    .from('jobs')
    .update({ payment_method, estimated_cost_min, estimated_cost_max, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('customer_id', customerId)
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

async function completeJob(accessToken, jobId, fundiId, { final_cost }) {
  const supabase = clientForUser(accessToken);
  const { data, error } = await supabase
    .from('jobs')
    .update({ status: 'completed', final_cost, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('fundi_id', fundiId)
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
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

module.exports = { createJob, listMine, listFeed, matchFundi, confirmBooking, completeJob, addReview };
