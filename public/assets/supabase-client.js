const SUPABASE_URL = 'https://imyvlogspyragdaagyar.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlteXZsb2dzcHlyYWdkYWFneWFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNTIwNzMsImV4cCI6MjEwNDYyODA3M30.yMU-nPDMhA9O7qrk1jfOIzq5DnRYLkFxbK15niJYrWo';
// Pages from serve.mjs (localhost:3000) call the API on port 3001. Pages served
// by the API itself, such as through the phone tunnel, use their own origin.
const API_BASE = window.location.port === '3000'
  ? `${window.location.protocol}//${window.location.hostname}:3001/api/v1`
  : '/api/v1';

// When a Google sign-in fails, Supabase sends the user back with the reason in
// the URL (query or #hash). Read it before the client can tidy the URL up.
const AUTH_REDIRECT_ERROR = (() => {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const message = params.get('error_description') || hash.get('error_description');
  return message ? message.replace(/\+/g, ' ') : null;
})();

// Named "sb", not "supabase" — the CDN script already declares a global
// `supabase`, and redeclaring it crashes the whole page script.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

// fetch() rejects without any answer from the server when the connection
// drops: mobile data fading, the phone locking mid-request, Wi-Fi handing over
// to data. The browser's own wording ("Failed to fetch" in Chrome, "Load
// failed" in Safari) means nothing to a customer, so it is replaced with this.
// It says only what is known: the request got no answer. On Ricky's phone the
// connection itself tested fine, so telling people to check theirs misleads.
const NETWORK_ERROR_MESSAGE = "Your request didn't get through to Find Fundi. Try again in a moment.";

function isNetworkError(err) {
  return err instanceof TypeError
    || /failed to fetch|load failed|networkerror|network request failed/i.test((err && err.message) || '');
}

function networkError() {
  const err = new Error(NETWORK_ERROR_MESSAGE);
  err.code = 'network';
  return err;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rejects when `promise` has not settled in time. Some browser calls, push
// registration above all, can wait forever instead of failing.
function withDeadline(promise, ms = 15000) {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`No answer after ${Math.round(ms / 1000)} seconds`);
      err.name = 'Timeout';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// What the browser and connection look like, for connection reports. No
// names, no location, no IP address (the server does not keep it either).
function deviceFacts() {
  const c = navigator.connection || {};
  return {
    url: window.location.href,
    user_agent: navigator.userAgent,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    online: navigator.onLine,
    connection: { type: c.type, effective_type: c.effectiveType, downlink_mbps: c.downlink, rtt_ms: c.rtt, save_data: c.saveData },
    brave: Boolean(navigator.brave),
    language: navigator.language,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    clock: new Date().toISOString(),
  };
}

// Requests that never got an answer are noted here and sent as a report once
// one does, so a failure on someone's phone can be looked at afterwards
// instead of guessed at. Storage can be unavailable (private windows), in
// which case nothing is kept.
const NET_LOG_KEY = 'ff-network-failures';

function logNetworkFailure(entry) {
  try {
    const list = JSON.parse(localStorage.getItem(NET_LOG_KEY) || '[]');
    list.push({ at: new Date().toISOString(), page: window.location.pathname, online: navigator.onLine, ...entry });
    localStorage.setItem(NET_LOG_KEY, JSON.stringify(list.slice(-20)));
  } catch (err) { /* nothing to keep it in */ }
}

function flushNetworkFailures(session) {
  let list;
  try { list = JSON.parse(localStorage.getItem(NET_LOG_KEY) || '[]'); } catch (err) { return; }
  if (!list.length) return;
  const headers = { 'Content-Type': 'application/json' };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;
  fetch(`${API_BASE}/diagnostics/reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'network-failures', device: deviceFacts(), failures: list }),
  }).then((res) => {
    if (res.ok) try { localStorage.removeItem(NET_LOG_KEY); } catch (err) { /* kept for next time */ }
  }).catch(() => {});
}

const describeError = (err) => `${(err && err.name) || 'Error'}: ${(err && err.message) || ''}`;

// A page that fails and is then left (as a failed booking usually is) never
// makes the successful request that would send its notes, so every page also
// tries once when it opens.
getSession().then(flushNetworkFailures).catch(() => {});

async function apiFetch(path, options = {}) {
  const session = await getSession();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;

  const method = (options.method || 'GET').toUpperCase();
  const send = async (attempt) => {
    const started = Date.now();
    try {
      return await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch (err) {
      if (isNetworkError(err)) {
        logNetworkFailure({ method, path: path.split('?')[0], attempt, ms: Date.now() - started, bytes: (options.body || '').length, error: describeError(err) });
      }
      throw err;
    }
  };
  let res;
  try {
    res = await send(1);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // A read is safe to repeat after a blip. A write is not: it may have
    // reached the server before the line dropped, so the caller decides.
    if (method !== 'GET') throw networkError();
    await wait(1500);
    try {
      res = await send(2);
    } catch (retryErr) {
      throw isNetworkError(retryErr) ? networkError() : retryErr;
    }
  }
  flushNetworkFailures(session);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body && body.error && body.error.message) || 'Something went wrong.');
  return body.data;
}

// On Android a picked file is only a reference into the gallery or Drive, read
// when it is sent. If its source changes in between (Google Photos finishing a
// download, a synced copy replacing it) the browser refuses to send it and
// says nothing but "Failed to fetch". Copying the bytes the moment the file is
// picked takes the gallery out of it, and a file that cannot be read is found
// out then, by name, rather than at the final button.
async function snapshotFile(file) {
  try {
    return new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified });
  } catch (err) {
    throw new Error(`${file.name} could not be read from this device. Pick it again, or save a copy to the phone first.`);
  }
}

// Uploads into the user's own folder and returns the storage path (not a URL).
// Filenames are sanitised because Storage rejects many characters in keys.
// A dropped connection gets one more try under a fresh name, since the first
// attempt may have landed and Storage refuses to overwrite.
async function uploadPrivateFile(bucket, userId, file) {
  const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  for (let attempt = 1; ; attempt += 1) {
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type || undefined });
    if (!error) return path;
    if (!isNetworkError(error)) throw error;
    logNetworkFailure({ method: 'UPLOAD', path: bucket, attempt, bytes: file.size, type: file.type, error: describeError(error) });
    if (attempt === 2) throw networkError();
    await wait(1500);
  }
}

// For any user-supplied text placed into innerHTML (descriptions, names, areas).
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
