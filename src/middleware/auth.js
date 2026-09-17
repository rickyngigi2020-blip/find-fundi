const { adminClient } = require('../db/supabase');

const SUSPENDED = { message: 'This account has been suspended. Contact Find Fundi if you think this is a mistake.', code: 'suspended' };

// Supabase Auth rejects a banned user's token outright, which would otherwise
// read as an expired session. The token's subject is used only to pick the
// right message for a request that is refused either way.
async function isSuspendedToken(token) {
  try {
    const { sub } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (!sub) return false;
    const { data } = await adminClient.from('profiles').select('suspended_at').eq('id', sub).maybeSingle();
    return Boolean(data && data.suspended_at);
  } catch (err) {
    return false;
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: { message: 'Missing authorization token', code: 'unauthorized' } });
  }

  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) {
    if (await isSuspendedToken(token)) return res.status(403).json({ error: SUSPENDED });
    return res.status(401).json({ error: { message: 'Invalid or expired session', code: 'unauthorized' } });
  }

  if (data.user.banned_until && new Date(data.user.banned_until).getTime() > Date.now()) {
    return res.status(403).json({ error: SUSPENDED });
  }

  req.user = data.user;
  req.accessToken = token;
  next();
}

module.exports = { requireAuth };
