const webpush = require('web-push');
const { adminClient } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');

// Browser notifications (Web Push). Without VAPID keys in the environment the
// feature is off: subscribing is refused and sending does nothing.
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
const configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
if (configured) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Sends are awaited before the API responds (a Vercel function may be frozen
// once the response is sent), but never hold a request up longer than this.
const SEND_BUDGET_MS = 4000;

function publicKey() {
  return configured ? VAPID_PUBLIC_KEY : null;
}

// The same browser may be signed in to a different account later, so the
// endpoint moves to whoever subscribed last.
async function saveSubscription(userId, { endpoint, p256dh, auth }) {
  const { error } = await adminClient
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint, p256dh, auth, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' });
  if (error) throw toApiError(error);
}

async function removeSubscription(userId, endpoint) {
  const { error } = await adminClient.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);
  if (error) throw toApiError(error);
}

// payload: { title, body, url, tag }. Failures never reach the caller: a job
// change has already happened and must not be reported as failed.
async function notifyUsers(userIds, payload) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!configured || !ids.length) return;
  try {
    const { data: subs, error } = await adminClient
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', ids);
    if (error) throw error;

    const body = JSON.stringify(payload);
    const sends = subs.map((s) => webpush
      .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60 * 12, urgency: 'high' })
      .catch(async (err) => {
        // 404/410: the browser unsubscribed or the subscription expired.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await adminClient.from('push_subscriptions').delete().eq('id', s.id);
        } else {
          console.error('Push send failed', err.statusCode || err.message);
        }
      }));
    await Promise.race([Promise.allSettled(sends), new Promise((r) => setTimeout(r, SEND_BUDGET_MS))]);
  } catch (err) {
    console.error('Push notify failed', err.message);
  }
}

module.exports = { publicKey, saveSubscription, removeSubscription, notifyUsers };
