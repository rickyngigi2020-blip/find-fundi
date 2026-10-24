const { adminClient } = require('../db/supabase');
const diagnostics = require('../services/diagnosticsService');

// Answers any method with how many bytes arrived, so the connection check can
// tell "this phone cannot send to us" apart from "this phone cannot send this
// much to us".
function echo(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: {
    method: req.method,
    bytes: Buffer.isBuffer(req.body) ? req.body.length : 0,
    header_bytes: (req.headers['x-pad'] || '').length,
    server_time: new Date().toISOString(),
  } });
}

// Signing in is not required to send a report (the problem being reported may
// be that signing in fails), but a valid token links it to the account.
async function reporterId(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const { data, error } = await adminClient.auth.getUser(header.slice(7)).catch(() => ({}));
  return !error && data && data.user ? data.user.id : null;
}

async function store(report, req, res, next) {
  try {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      return res.status(400).json({ error: { message: 'A report must be a JSON object', code: 'invalid_request' } });
    }
    const ref = await diagnostics.saveReport(report, await reporterId(req));
    res.json({ data: { ref } });
  } catch (err) {
    next(err);
  }
}

function create(req, res, next) {
  let report;
  try {
    report = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: { message: 'A report must be JSON', code: 'invalid_request' } });
  }
  return store(report, req, res, next);
}

// Fallback for a phone whose POSTs never arrive: the same report, base64url
// encoded into the query string of a GET.
function createFromQuery(req, res, next) {
  let report;
  try {
    report = JSON.parse(Buffer.from(String(req.query.d || ''), 'base64url').toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: { message: 'A report must be JSON', code: 'invalid_request' } });
  }
  return store(report, req, res, next);
}

module.exports = { echo, create, createFromQuery };
