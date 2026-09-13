const SUPABASE_URL = 'https://imyvlogspyragdaagyar.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlteXZsb2dzcHlyYWdkYWFneWFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNTIwNzMsImV4cCI6MjEwNDYyODA3M30.yMU-nPDMhA9O7qrk1jfOIzq5DnRYLkFxbK15niJYrWo';
const API_BASE = 'http://localhost:3001/api/v1';

// Named "sb", not "supabase" — the CDN script already declares a global
// `supabase`, and redeclaring it crashes the whole page script.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

// Redirects to login if there's no session; returns the session otherwise.
async function requireSession(redirectTo) {
  const session = await getSession();
  if (!session) {
    window.location.href = redirectTo || 'login.html';
    return null;
  }
  return session;
}

async function apiFetch(path, options = {}) {
  const session = await getSession();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body && body.error && body.error.message) || 'Something went wrong.');
  return body.data;
}

// Uploads into the user's own folder and returns the storage path (not a URL).
// Filenames are sanitised because Storage rejects many characters in keys.
async function uploadPrivateFile(bucket, userId, file) {
  const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type || undefined });
  if (error) throw error;
  return path;
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
