// Browser notifications on the page side: register the service worker, ask
// permission, send the subscription to the API, and let pages refresh when a
// notification arrives. Needs supabase-client.js loaded first.

const PUSH_SW_URL = '/sw.js';

// Registering with the browser's push service can hang rather than fail (seen
// on a fresh Chrome profile, and when Android cannot reach Google Play
// services). The first registration is slow, so the limit is generous.
const PUSH_SUBSCRIBE_MS = 60000;
const PUSH_HELPER_MS = 20000;

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iPhones and iPads only offer web push to sites added to the Home Screen.
function isIosBrowserTab() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !window.navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches;
}

function base64UrlToBytes(value) {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function pushRegistration() {
  await navigator.serviceWorker.register(PUSH_SW_URL);
  return navigator.serviceWorker.ready;
}

// 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'
async function pushState() {
  if (isIosBrowserTab()) return 'ios-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await pushRegistration();
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

async function sendSubscription(sub) {
  await apiFetch('/push/subscriptions', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
}

// A subscription is tied to the key it was created with. If the server's key
// has changed since, reusing the old subscription silently breaks delivery and
// re-subscribing over it throws, so the stale one is dropped first.
function subscriptionMatchesKey(sub, keyBytes) {
  const existing = sub.options && sub.options.applicationServerKey;
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  return bytes.length === keyBytes.length && bytes.every((b, i) => b === keyBytes[i]);
}

// The browser's own wording for these is not something anyone can act on
// ("Registration failed - push service error"), so it is translated here.
// Chrome, Edge and Brave all surface the same unhelpful string for this
// ("Registration failed - push service error"). It means the browser could not
// register with its push service, which is almost never something about Find
// Fundi, so the message names the causes that are actually worth checking and
// keeps the browser's own words for when none of them is it.
function pushFailureMessage(err) {
  const name = (err && err.name) || '';
  const message = (err && err.message) || '';
  const raw = `${name} ${message}`.toLowerCase();
  const detail = message ? ` (${name ? name + ': ' : ''}${message})` : '';

  if (name === 'Timeout') {
    return "Your browser's notification service never answered. On Android this usually means Google Play services "
      + 'is out of date or restricted: update it in the Play Store, make sure Chrome is allowed to run in the background, '
      + 'restart the phone, then try again.' + detail;
  }
  if (raw.includes('push service error') || raw.includes('aborterror')) {
    const isBrave = Boolean(navigator.brave);
    const inPrivate = !window.indexedDB;
    if (isBrave) {
      return 'Brave blocks notifications until you turn on Settings > Privacy and security > '
        + '"Use Google services for push messaging", then restart Brave.' + detail;
    }
    if (inPrivate) {
      return 'Notifications do not work in a private or incognito window. Open Find Fundi in a normal window and try again.' + detail;
    }
    return 'Your browser could not reach its notification service. This is usually one of: '
      + 'an incognito or guest window, a network that blocks Google services, or a browser that needs restarting. '
      + 'Close and reopen the browser, make sure you are in a normal window, then try again.' + detail;
  }
  if (raw.includes('notallowederror') || raw.includes('permission')) {
    return 'Notifications are blocked for this site. Tap the padlock in the address bar, '
      + 'set Notifications to Allow, then try again.' + detail;
  }
  if (raw.includes('notsupportederror')) {
    return 'This browser cannot do notifications. On iPhone, add Find Fundi to your home screen first.' + detail;
  }
  return (message || 'Notifications could not be turned on.') + (message ? '' : detail);
}


// Notifications failing on someone's phone has been impossible to see from
// here, so a failure is reported with the step it happened at.
async function reportPushFailure(step, err) {
  const session = await getSession().catch(() => null);
  const headers = { 'Content-Type': 'application/json' };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;
  fetch(`${API_BASE}/diagnostics/reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      kind: 'push-failure',
      step,
      error: describeError(err),
      permission: 'Notification' in window ? Notification.permission : 'none',
      device: deviceFacts(),
    }),
  }).catch(() => {});
}

async function enablePush() {
  let step = 'permission';
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      const err = new Error(permission === 'denied'
        ? 'Notifications are blocked. Allow them for this site in your browser settings.'
        : 'Notifications were not turned on.');
      err.name = 'Permission';
      throw err;
    }

    step = 'key';
    const { publicKey } = await apiFetch('/push/public-key');
    const keyBytes = base64UrlToBytes(publicKey);
    step = 'helper';
    const reg = await withDeadline(pushRegistration(), PUSH_HELPER_MS);

    step = 'subscribe';
    let sub = await reg.pushManager.getSubscription();
    if (sub && !subscriptionMatchesKey(sub, keyBytes)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    if (!sub) {
      sub = await withDeadline(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes }), PUSH_SUBSCRIBE_MS);
    }
    step = 'save';
    await sendSubscription(sub);
  } catch (err) {
    console.error('Find Fundi: turning on notifications failed at', step, err);
    reportPushFailure(step, err);
    if (err.name === 'Permission' || err.code === 'network' || step === 'key' || step === 'save') throw err;
    if (step === 'helper') {
      throw new Error(`The notification helper could not start in this browser. Close the browser completely, reopen Find Fundi and try again. (${describeError(err)})`);
    }
    throw new Error(pushFailureMessage(err));
  }
}

// Re-sends an existing subscription, so this browser's notifications follow
// whichever account is signed in now.
async function syncPush() {
  try {
    if ((await pushState()) !== 'on') return;
    const reg = await pushRegistration();
    await sendSubscription(await reg.pushManager.getSubscription());
  } catch (err) {
    // Not worth interrupting the page for; the prompt offers to try again.
  }
}

function onPushUpdate(callback) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'find-fundi-update') callback(event.data);
  });
}

const BELL_ICON = '<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';

// Fills `container` with the right prompt for this browser, or hides it when
// notifications are already on (or impossible). `message` says what the
// person will be told about.
async function mountPushPrompt(container, message) {
  const state = await pushState().catch(() => 'unsupported');
  container.replaceChildren();
  if (state === 'on') { syncPush(); container.hidden = true; return; }
  if (state === 'unsupported') { container.hidden = true; return; }
  container.hidden = false;

  const box = document.createElement('div');
  box.className = 'flex items-start gap-3 rounded-xl border border-orange/30 bg-orange-50 px-4 py-3';
  box.innerHTML = `
    <span class="mt-0.5 shrink-0 text-orange-600">${BELL_ICON}</span>
    <div class="min-w-0 flex-1">
      <p class="p-title text-[14px] font-semibold text-navy"></p>
      <p class="p-body mt-0.5 text-[13px] leading-[1.55] text-navy/65"></p>
      <p class="p-error hidden mt-1.5 text-[13px] text-red-600" role="alert"></p>
    </div>
  `;
  const title = box.querySelector('.p-title');
  const body = box.querySelector('.p-body');

  if (state === 'ios-install') {
    title.textContent = 'Get notified on your iPhone';
    body.textContent = `${message} On iPhone, first tap Share, then Add to Home Screen, and open Find Fundi from your Home Screen.`;
  } else if (state === 'denied') {
    title.textContent = 'Notifications are blocked';
    body.textContent = `${message} Allow notifications for this site in your browser settings, then reload the page.`;
  } else {
    title.textContent = 'Turn on notifications';
    body.textContent = message;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'push-enable btn-primary shrink-0 self-center text-white font-semibold text-[13.5px] px-3.5 py-2 rounded-lg';
    btn.textContent = 'Turn on';
    btn.addEventListener('click', async () => {
      const errorEl = box.querySelector('.p-error');
      errorEl.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Turning on…';
      try {
        await enablePush();
        box.innerHTML = `<span class="shrink-0 text-orange-600">${BELL_ICON}</span><p class="text-[14px] font-semibold text-navy">Notifications are on for this device.</p>`;
        box.classList.add('items-center');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Turn on';
      }
    });
    box.appendChild(btn);
  }
  container.appendChild(box);
}
