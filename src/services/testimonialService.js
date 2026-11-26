const { adminClient } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');

// Testimonials on the home page. Admins type them in from what real fundis and
// customers told them, and only after the person agreed to be quoted. None are
// seeded and none are made up: with nothing published the section stays hidden.

const PUBLIC_FIELDS = 'person_name, role, area, quote';
const bad = (message) => apiError(400, message, 'invalid_request');

function clean(body, { partial = false } = {}) {
  const out = {};
  const text = (v) => (typeof v === 'string' ? v.trim() : v);
  if (!partial || body.person_name !== undefined) {
    const name = text(body.person_name);
    if (typeof name !== 'string' || name.length < 2 || name.length > 60) throw bad('Give the person\'s name, 2 to 60 letters.');
    out.person_name = name;
  }
  if (!partial || body.role !== undefined) {
    if (!['customer', 'fundi'].includes(body.role)) throw bad('Say whether they are a customer or a fundi.');
    out.role = body.role;
  }
  if (!partial || body.area !== undefined) {
    const area = text(body.area);
    if (area && (typeof area !== 'string' || area.length > 60)) throw bad('The area is too long.');
    out.area = area || null;
  }
  if (!partial || body.quote !== undefined) {
    const quote = text(body.quote);
    if (typeof quote !== 'string' || quote.length < 10 || quote.length > 400) throw bad('The testimonial must be 10 to 400 characters.');
    out.quote = quote;
  }
  if (body.published !== undefined) out.published = Boolean(body.published);
  if (body.sort !== undefined) {
    const sort = Number(body.sort);
    if (!Number.isInteger(sort)) throw bad('Order must be a whole number.');
    out.sort = sort;
  }
  return out;
}

// What the home page shows: published ones, and only the four public fields.
async function listPublished() {
  const { data, error } = await adminClient
    .from('testimonials')
    .select(PUBLIC_FIELDS)
    .eq('published', true)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(12);
  if (error) throw toApiError(error);
  return data;
}

async function listAll() {
  const { data, error } = await adminClient
    .from('testimonials')
    .select('*')
    .order('published', { ascending: false })
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw toApiError(error);
  return data;
}

async function create(adminId, body) {
  // Saying the person agreed is what makes it a testimonial rather than copy.
  if (body.consent_confirmed !== true) {
    throw bad('Tick that this person agreed to be quoted on findfundi.com, in their own words.');
  }
  const { data, error } = await adminClient
    .from('testimonials')
    .insert({ ...clean(body), consent_confirmed: true, created_by: adminId })
    .select()
    .single();
  if (error) throw toApiError(error);
  return data;
}

async function update(id, body) {
  const { data, error } = await adminClient
    .from('testimonials')
    .update({ ...clean(body, { partial: true }), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw toApiError(error);
  if (!data) throw apiError(404, 'Testimonial not found.', 'not_found');
  return data;
}

async function remove(id) {
  const { error } = await adminClient.from('testimonials').delete().eq('id', id);
  if (error) throw toApiError(error);
  return { deleted: true };
}

module.exports = { listPublished, listAll, create, update, remove, PUBLIC_FIELDS };
