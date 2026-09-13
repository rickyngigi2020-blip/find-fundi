require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY in .env');
}

// Full-privilege client that bypasses Row Level Security. Used only after the
// service layer has checked who the caller is and what they may change (job
// writes, admin actions, sharing a counterpart's contact details).
const adminClient = createClient(supabaseUrl, serviceRoleKey);

// Per-request client scoped to the calling user's own JWT, so every query
// still goes through Postgres RLS as that user — not the service role.
function clientForUser(accessToken) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

module.exports = { adminClient, clientForUser };
