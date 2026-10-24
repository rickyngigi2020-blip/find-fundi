const crypto = require('crypto');
const { adminClient } = require('../db/supabase');

// Connection reports from browsers: what the connection check found, and
// requests that never got an answer. Kept as JSON files in a private bucket,
// one folder per day, and deleted after 30 days (the privacy policy says so).
const BUCKET = 'diagnostics';
const KEEP_DAYS = 30;

const day = (date) => date.toISOString().slice(0, 10);

async function pruneOldDays() {
  const { data, error } = await adminClient.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) return;
  const cutoff = day(new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000));
  const old = data.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.name) && f.name < cutoff);
  for (const folder of old) {
    const { data: files } = await adminClient.storage.from(BUCKET).list(folder.name, { limit: 1000 });
    if (files && files.length) {
      await adminClient.storage.from(BUCKET).remove(files.map((f) => `${folder.name}/${f.name}`));
    }
  }
}

// The report itself comes from the browser and is stored as given. The user
// is whoever the token belongs to, never what the report claims.
async function saveReport(report, userId) {
  const now = new Date();
  const ref = crypto.randomBytes(3).toString('hex');
  const path = `${day(now)}/${now.toISOString().replace(/[:.]/g, '-')}-${userId || 'signed-out'}-${ref}.json`;
  const body = JSON.stringify({ received_at: now.toISOString(), user_id: userId || null, report }, null, 2);
  const { error } = await adminClient.storage.from(BUCKET).upload(path, body, { contentType: 'application/json' });
  if (error) throw error;
  pruneOldDays().catch(() => {});
  return ref;
}

module.exports = { saveReport };
