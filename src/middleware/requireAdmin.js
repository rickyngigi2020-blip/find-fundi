const { adminClient } = require('../db/supabase');

// Runs after requireAuth. Checks the admin flag with the service-role
// client, since a normal user's own RLS-scoped client can't see it reliably
// (profiles RLS only guarantees reading your own row, which is fine here,
// but the admin flag check should not depend on user-editable client state).
async function requireAdmin(req, res, next) {
  const { data, error } = await adminClient
    .from('profiles')
    .select('is_admin')
    .eq('id', req.user.id)
    .single();

  if (error || !data || !data.is_admin) {
    return res.status(403).json({ error: { message: 'Admin access required', code: 'forbidden' } });
  }
  next();
}

module.exports = { requireAdmin };
