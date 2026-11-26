const { adminClient } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');

const DUPLICATE = 'That service is already on the menu for this trade.';

// The menu a fundi sees: active services in their own trade.
async function listForFundi(userId) {
  const { data: fundi, error } = await adminClient
    .from('fundi_profiles').select('category').eq('id', userId).maybeSingle();
  if (error) throw toApiError(error);
  if (!fundi) return [];
  const { data, error: listError } = await adminClient
    .from('service_rates')
    .select('id, name, price_kes')
    .eq('category', fundi.category)
    .eq('active', true)
    .order('name', { ascending: true });
  if (listError) throw toApiError(listError);
  return data;
}

// The menu a customer sees while booking: active services in the trade they
// picked. Only the name and price, which are what the booking page shows.
async function listForCategory(category) {
  const { data, error } = await adminClient
    .from('service_rates')
    .select('id, name, price_kes')
    .eq('category', category)
    .eq('active', true)
    .order('price_kes', { ascending: true });
  if (error) throw toApiError(error);
  return data;
}

// The service a customer picked while booking. The price comes from here, never
// from the booking request, so what they were shown is what is stored.
async function usableForBooking(rateId, category) {
  const { data, error } = await adminClient
    .from('service_rates').select('id, name, price_kes, category, active').eq('id', rateId).maybeSingle();
  if (error) throw toApiError(error);
  if (!data || !data.active || data.category !== category) {
    throw apiError(409, 'That service is not on the menu any more. Pick another or describe the job.', 'rate_unavailable');
  }
  return data;
}

async function listAll() {
  const { data, error } = await adminClient
    .from('service_rates')
    .select('*')
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw toApiError(error);
  return data;
}

async function create({ category, name, price_kes }) {
  const { data, error } = await adminClient
    .from('service_rates')
    .insert({ category, name, price_kes })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw apiError(409, DUPLICATE, 'conflict');
    throw toApiError(error);
  }
  return data;
}

async function update(id, changes) {
  const { data, error } = await adminClient
    .from('service_rates')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === '23505') throw apiError(409, DUPLICATE, 'conflict');
    throw toApiError(error);
  }
  if (!data) throw apiError(404, 'Service not found.', 'not_found');
  return data;
}

// The rate a quote is allowed to use for this job: it must exist, be switched
// on, and belong to the job's trade.
async function usableForJob(rateId, job) {
  const { data, error } = await adminClient
    .from('service_rates').select('*').eq('id', rateId).maybeSingle();
  if (error) throw toApiError(error);
  if (!data || !data.active || data.category !== job.category) {
    throw apiError(409, 'That service is not on the menu any more. Pick another or send your own price.', 'rate_unavailable');
  }
  return data;
}

module.exports = { listForFundi, listForCategory, listAll, create, update, usableForJob, usableForBooking };
