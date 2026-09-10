require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY in .env');
}

// Full-privilege client — bypasses Row Level Security. Only for operations
// that must cross user boundaries (none needed yet, kept for future admin use).
const adminClient = createClient(supabaseUrl, serviceRoleKey);

// Per-request client scoped to the calling user's own JWT, so every query
// still goes through Postgres RLS as that user — not the service role.
function clientForUser(accessToken) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

module.exports = { adminClient, clientForUser };
