const { adminClient } = require('../db/supabase');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: { message: 'Missing authorization token', code: 'unauthorized' } });
  }

  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: { message: 'Invalid or expired session', code: 'unauthorized' } });
  }

  req.user = data.user;
  req.accessToken = token;
  next();
}

module.exports = { requireAuth };
