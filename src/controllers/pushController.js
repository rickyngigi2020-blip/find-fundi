const pushService = require('../services/pushService');

function publicKey(req, res) {
  const key = pushService.publicKey();
  if (!key) return res.status(503).json({ error: { message: 'Notifications are not set up on this server.', code: 'not_configured' } });
  res.json({ data: { publicKey: key } });
}

// Body is a browser PushSubscription as JSON: { endpoint, keys: { p256dh, auth } }.
function readSubscription(body) {
  const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint : '';
  const keys = (body && body.keys) || {};
  if (!endpoint.startsWith('https://') || endpoint.length > 1000) return null;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

async function subscribe(req, res, next) {
  try {
    if (!pushService.publicKey()) return publicKey(req, res);
    const sub = readSubscription(req.body);
    if (!sub) return res.status(400).json({ error: { message: 'That notification subscription is not valid.', code: 'invalid_request' } });
    await pushService.saveSubscription(req.user.id, sub);
    res.json({ data: { subscribed: true } });
  } catch (err) {
    next(err);
  }
}

// Sends one notification to every device on the caller's account, so they can
// see for themselves that notifications arrive.
async function test(req, res, next) {
  try {
    if (!pushService.publicKey()) return publicKey(req, res);
    const devices = await pushService.subscriptionCount(req.user.id);
    await pushService.notifyUsers([req.user.id], {
      title: 'Find Fundi notifications work',
      body: 'This device will get a notification when a job comes in or changes.',
      url: '/check.html',
      tag: 'test',
    });
    res.json({ data: { devices } });
  } catch (err) {
    next(err);
  }
}

module.exports = { publicKey, subscribe, test };
