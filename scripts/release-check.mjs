// Release check: replays the bugs fixed in 1.2 against the live site (or a
// local one) and fails loudly if any of them is back. Run before tagging a
// release:  npm run check            (live, https://www.findfundi.com)
//           npm run check -- http://localhost:3000   (local, servers running)
//
// It books real jobs, so it does so carefully: as its own test account (so no
// person is notified), only in a category with no verified fundi (so no fundi
// is offered the job), and it deletes everything it made, pass or fail.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');

const SITE = 'https://www.findfundi.com';
const OLD_HOSTS = ['findfundi.com', 'find-fundi.vercel.app', 'find-fundi-rico17.vercel.app'];
const BASE = (process.argv[2] || SITE).replace(/\/$/, '');
const LIVE = BASE === SITE;
const TEST_EMAIL = 'release-check@findfundi.com';
const CATEGORIES = ['installation', 'general_maintenance', 'mechanical', 'computer_laptop', 'appliance', 'phone_electronics', 'tailoring'];

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? ` (${detail})` : ''}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
const expect = (cond, message) => { if (!cond) throw new Error(message); };

// ---------- the test account ----------
async function testUser() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  let user = data.users.find((u) => u.email === TEST_EMAIL);
  if (!user) {
    const created = await admin.auth.admin.createUser({ email: TEST_EMAIL, email_confirm: true });
    if (created.error) throw created.error;
    user = created.data.user;
  }
  const { error } = await admin.from('profiles').upsert({
    id: user.id, full_name: 'Release check (automated)', phone: '0700000000', role: 'customer', area: 'Kasarani',
  });
  if (error) throw error;
  return user;
}

async function sessionFor(email, redirectTo) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email, options: redirectTo ? { redirectTo } : {} });
  if (error) throw error;
  return data;
}

// A category nobody can be offered, so a test job pages no one.
async function emptyCategory() {
  const { data, error } = await admin.from('fundi_profiles').select('category').eq('verification_status', 'verified');
  if (error) throw error;
  const taken = new Set(data.map((f) => f.category));
  return CATEGORIES.find((c) => !taken.has(c)) || null;
}

async function cleanUp(userId) {
  const { data: jobs } = await admin.from('jobs').select('id, photo_paths, voice_note_path').eq('customer_id', userId);
  for (const j of jobs || []) {
    const media = [...(j.photo_paths || []), j.voice_note_path].filter(Boolean);
    if (media.length) await admin.storage.from('job-media').remove(media);
    await admin.from('job_offers').delete().eq('job_id', j.id);
    await admin.from('jobs').delete().eq('id', j.id);
  }
  const { data: files } = await admin.storage.from('job-media').list(userId, { limit: 1000 });
  if (files && files.length) await admin.storage.from('job-media').remove(files.map((f) => `${userId}/${f.name}`));
  await admin.from('push_subscriptions').delete().eq('user_id', userId);
  return (jobs || []).length;
}

// ---------- checks that need no browser ----------
async function addressChecks() {
  await check('Sign-ins return to www.findfundi.com (Supabase Site URL and allowed addresses)', async () => {
    for (const asked of [undefined, `${SITE}/profile.html`]) {
      const link = await sessionFor(TEST_EMAIL, asked);
      const back = new URL(new URL(link.properties.action_link).searchParams.get('redirect_to'));
      expect(back.origin === SITE, `Asked for ${asked || 'the Site URL'}, Supabase sends people to ${back.href}. Set Site URL to ${SITE} and add ${SITE}/** under Authentication > URL Configuration.`);
    }
  });

  await check('Every old address redirects to www.findfundi.com, and none asks for a Vercel login', async () => {
    for (const host of OLD_HOSTS) {
      for (const p of ['/', '/book.html', '/api/v1/health']) {
        const res = await fetch(`https://${host}${p}`, { redirect: 'manual' });
        const to = res.headers.get('location') || '';
        expect([301, 308].includes(res.status) && to.startsWith(SITE), `https://${host}${p} answered ${res.status} ${to}`);
      }
    }
    const res = await fetch(`${SITE}/book.html`, { redirect: 'manual' });
    expect(res.status === 200, `${SITE}/book.html answered ${res.status} ${res.headers.get('location') || ''}`);
  });

  await check('The scheduled jobs reach the site', async () => {
    const res = await fetch(`${SITE}/api/v1/health`, { redirect: 'manual' });
    expect(res.status === 200, `health answered ${res.status}`);
    const workflow = fs.readFileSync(new URL('../.github/workflows/keep-supabase-awake.yml', import.meta.url), 'utf8');
    const urls = workflow.match(/https:\/\/[^\s"')]+/g) || [];
    expect(urls.length && urls.every((u) => u.startsWith(SITE)), `keep-supabase-awake.yml calls ${urls.join(', ')}; a redirected address makes curl stop at the 308`);
  });

  // Auto-matching took away choosing a fundi, but the home page and Privacy
  // Policy kept promising it for weeks. The Terms are the legal record, so
  // the pages must not say otherwise.
  await check('No page says customers choose a fundi or fundis browse jobs', async () => {
    const stale = [/pick a fundi/i, /choos(e|ing) a (verified )?fundi/i, /browse open jobs/i, /customers see you're available/i];
    for (const page of ['/', '/terms.html', '/privacy.html', '/book.html', '/apply.html']) {
      const html = await (await fetch(`${BASE}${page}`)).text();
      const hit = stale.find((re) => re.test(html));
      expect(!hit, `${page} still says ${hit}`);
    }
  });
}

// ---------- browser checks ----------
async function makePhotos(page, dir, count) {
  const files = [];
  for (let i = 0; i < count; i++) {
    const b64 = await page.evaluate(async (i) => {
      const c = document.createElement('canvas');
      c.width = 4000; c.height = 3000;
      const g = c.getContext('2d');
      for (let k = 0; k < 3000; k++) { g.fillStyle = `hsl(${(k * 7 + i * 40) % 360},70%,${30 + (k % 40)}%)`; g.fillRect(Math.random() * 4000, Math.random() * 3000, 120, 90); }
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let j = 0; j < bytes.length; j += 0x8000) s += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
      return btoa(s);
    }, i);
    const file = path.join(dir, `IMG_check_${i}.jpg`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    files.push(file);
  }
  return files;
}

async function book(page, { category, marker, photos, beforeSubmit }) {
  await page.goto(`${BASE}/book.html`, { waitUntil: 'networkidle0' });
  await page.click(`.cat-card[data-value="${category}"]`);
  if (photos) {
    await (await page.$('#photoInput')).uploadFile(...photos);
    await page.waitForFunction((n) => document.querySelectorAll('#photoGrid .thumb').length === n, { timeout: 30000 }, photos.length);
  }
  if (beforeSubmit) await beforeSubmit();
  await page.type('#description', marker);
  await page.select('#area', 'Kasarani');
  await page.click('#toStep2');
  await page.waitForFunction(() => document.getElementById('stepSearching').classList.contains('active')
    || !document.getElementById('step1Error').classList.contains('hidden'), { timeout: 60000 });
  return page.evaluate(() => (document.getElementById('stepSearching').classList.contains('active')
    ? null : document.getElementById('step1Error').textContent));
}

const savedJobs = async (marker) => (await admin.from('jobs').select('id, photo_paths').eq('description', marker)).data;

async function browserChecks(user, category) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-check-'));
  // Puppeteer's own download isn't always on this PC, so fall back to an installed Chrome or Edge.
  const installed = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => fs.existsSync(p));
  let bundled = false;
  try { bundled = fs.existsSync(puppeteer.executablePath() || ''); } catch { /* none downloaded */ }
  const browser = await puppeteer.launch(!process.env.PUPPETEER_EXECUTABLE_PATH && !bundled && installed ? { executablePath: installed } : {});
  const offSite = [];
  try {
    const page = await browser.newPage();
    await page.emulate(puppeteer.KnownDevices['Pixel 5']);
    const allowed = [new URL(BASE).hostname, 'localhost', new URL(process.env.SUPABASE_URL).hostname, 'cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'images.unsplash.com'];
    page.on('request', (r) => {
      const host = new URL(r.url()).hostname;
      if (r.url().startsWith('http') && !allowed.includes(host)) offSite.push(r.url());
    });

    await check('Signing in lands on the site, signed in', async () => {
      if (LIVE) {
        const link = await sessionFor(TEST_EMAIL, `${SITE}/profile.html`);
        await page.goto(link.properties.action_link, { waitUntil: 'networkidle0' });
        expect(new URL(page.url()).origin === SITE, `sign-in ended on ${page.url().split('#')[0]}`);
      } else {
        const link = await sessionFor(TEST_EMAIL);
        const { data, error } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
        if (error) throw error;
        await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((s) => localStorage.setItem(`sb-${new URL(s.url).hostname.split('.')[0]}-auth-token`, JSON.stringify(s.session)), { url: process.env.SUPABASE_URL, session: data.session });
      }
      await page.goto(`${BASE}/book.html`, { waitUntil: 'networkidle0' });
      expect(await page.$eval('#flow', (e) => !e.hidden), 'the booking page shows "Sign in to book a fundi"');
    });

    const photos = await makePhotos(page, dir, 3);

    await check('Photos that change after being picked still upload, shrunk', async () => {
      const marker = `Release check: changed photos ${Date.now()}`;
      const error = await book(page, {
        category, marker, photos,
        // What a gallery app does behind the browser's back.
        beforeSubmit: async () => { for (const f of photos) fs.appendFileSync(f, Buffer.alloc(1024)); },
      });
      expect(!error, `booking showed: ${error}`);
      const jobs = await savedJobs(marker);
      expect(jobs.length === 1 && jobs[0].photo_paths.length === 3, `saved ${jobs.length} job(s) with ${jobs[0] ? jobs[0].photo_paths.length : 0} photos`);
      const { data: objs } = await admin.storage.from('job-media').list(user.id, { limit: 100 });
      const sizes = objs.filter((o) => jobs[0].photo_paths.some((p) => p.endsWith(o.name))).map((o) => o.metadata.size);
      expect(sizes.every((s) => s < 1024 * 1024), `uploaded sizes ${sizes.join(', ')} bytes; photos should be shrunk under 1 MB`);
      return `${sizes.map((s) => Math.round(s / 1024)).join(', ')} KB`;
    });

    await page.setRequestInterception(true);
    let mode = null;
    page.on('request', async (r) => {
      if (r.isInterceptResolutionHandled()) return;
      const isPost = r.method() === 'POST' && /\/api\/v1\/jobs$/.test(r.url());
      if (isPost && mode === 'drop') { mode = null; return r.abort('internetdisconnected'); }
      if (isPost && mode === 'lose-reply') {
        mode = null;
        await fetch(r.url(), { method: 'POST', headers: r.headers(), body: r.postData() });
        return r.abort('connectionreset');
      }
      return r.continue();
    });

    await check('A booking whose request drops goes through on its own', async () => {
      const marker = `Release check: dropped request ${Date.now()}`;
      mode = 'drop';
      const error = await book(page, { category, marker });
      expect(!error, `booking showed: ${error}`);
      expect((await savedJobs(marker)).length === 1, 'the job was not saved exactly once');
    });

    await check('A booking whose reply is lost is not booked twice', async () => {
      const marker = `Release check: lost reply ${Date.now()}`;
      mode = 'lose-reply';
      const error = await book(page, { category, marker });
      expect(!error, `booking showed: ${error}`);
      const n = (await savedJobs(marker)).length;
      expect(n === 1, `the job was saved ${n} times`);
    });

    await check('Nothing sends people off the site', async () => {
      expect(!offSite.length, `requests left the site: ${[...new Set(offSite)].slice(0, 5).join(', ')}`);
    });
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- run ----------
console.log(`Release check against ${BASE}\n`);
const user = await testUser();
try {
  await addressChecks();
  const category = await emptyCategory();
  if (!category) {
    console.log('SKIP  Booking checks: every category has a verified fundi, so a test job would page a real person.');
  } else {
    await browserChecks(user, category);
  }
} finally {
  const removed = await cleanUp(user.id);
  console.log(`\nCleaned up ${removed} test job(s).`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) FAILED. Do not release.` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
