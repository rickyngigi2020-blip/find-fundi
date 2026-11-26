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

    // Supabase's scheduler (migration 0019) calls the tick every minute, and
    // pg_net does not follow redirects either.
    const migrations = new URL('../supabase/migrations/', import.meta.url);
    for (const name of fs.readdirSync(migrations)) {
      const sql = fs.readFileSync(new URL(name, migrations), 'utf8');
      const bad = (sql.match(/https?:\/\/[^\s"')]+/g) || []).filter((u) => !u.startsWith(SITE));
      expect(!bad.length, `${name} calls ${bad.join(', ')}; only ${SITE} is allowed`);
    }
    expect(fs.readFileSync(new URL('0019_tick_cron.sql', migrations), 'utf8').includes(`'${SITE}/api/v1/tick'`), 'the every-minute tick in migration 0019 is missing');
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

// ---------- the stress test of October 2026 ----------
// Each of these came out of watching a real fundi use the app. They read the
// code and the database directly, so they need no browser.
const source = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

async function stressTestChecks() {
  await check('Admin lists every account, including ones that never finished setup', async () => {
    const adminService = require('../src/services/adminService');
    const { data: auth } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const listed = await adminService.listUsers({ query: '' });
    const expected = Math.min(auth.users.length, 100);
    expect(listed.length === expected, `admin shows ${listed.length} accounts, Supabase has ${auth.users.length}`);
  });

  await check('The customer is told when a fundi takes their job', async () => {
    const accept = source('src/services/matchingService.js').split('async function acceptOffer')[1] || '';
    expect(/notify\.fundiFound\(/.test(accept.split('async function declineOffer')[0]), 'acceptOffer no longer notifies the customer');
  });

  await check('The home-screen app opens on start.html, which sends people to their work', async () => {
    const manifest = JSON.parse(source('public/manifest.webmanifest'));
    expect(manifest.start_url === '/start.html', `manifest start_url is ${manifest.start_url}`);
    const start = source('public/start.html');
    for (const page of ['fundi.html', 'apply.html', 'my-jobs.html', 'book.html', 'login.html?next=start.html']) {
      expect(start.includes(`'${page}'`), `start.html no longer sends anyone to ${page}`);
    }
  });

  await check('A fundi can apply with phone photos of their papers, not only PDFs', async () => {
    const page = source('public/apply.html');
    const inputs = page.match(/<input id="(idDoc|certDoc)"[^>]*>/g) || [];
    expect(inputs.length === 2 && inputs.every((i) => i.includes('image/*')), 'the ID or certificate picker no longer accepts photos');
    expect(!/id="qualification"/.test(page), 'the highest qualification question is back');
    const controller = source('src/controllers/fundiController.js');
    expect(/DOCUMENT_TYPES = .*jpe\?g/.test(controller), 'the API no longer accepts photo documents');
  });

  await check('Pages update without a refresh', async () => {
    for (const page of ['public/my-jobs.html', 'public/fundi.html', 'public/book.html']) {
      expect(source(page).includes('watchMyJobs('), `${page} no longer watches for job changes`);
    }
    expect(fs.existsSync(new URL('../supabase/migrations/0018_jobs_realtime.sql', import.meta.url)), 'migration 0018 (jobs in Realtime) is missing');
    // 1.7 tester feedback: screens kept saying "booked" after the job moved on.
    const client = source('public/assets/supabase-client.js');
    expect(/CHANNEL_ERROR/.test(client) && /addEventListener\('online'/.test(client), 'a dropped live connection is no longer opened again');
    for (const page of ['public/my-jobs.html', 'public/fundi.html']) {
      expect(source(page).includes('jobsSnapshot('), `${page} compares signed links, so it redraws on every check`);
    }
    const book = source('public/book.html');
    expect(/followBooked/.test(book), 'the booking confirmation stops following the job once a fundi takes it');
    expect(!/job\.fundi\b/.test(book), 'the booking page reads job.fundi, which the API does not send (it is job.counterpart)');
  });

  // 1.7 tester feedback: descriptions were too vague for the fundi, so a job
  // needs something to go on, but any one thing is enough.
  await check('A booking says something about the job, and any one detail is enough', async () => {
    const page = source('public/book.html');
    expect(/QUICK_QUESTIONS\[/.test(page) && /QUICK_QUESTIONS = \{/.test(source('public/assets/categories.js')), 'the booking page no longer asks the quick questions');
    const controller = source('src/controllers/jobsController.js');
    expect(/MIN_DESCRIPTION/.test(controller) && /requestedRateId/.test(controller) && /voice_note_path/.test(controller), 'the API no longer checks that a job says something');
    const jobsController = require('../src/controllers/jobsController');
    const refused = await new Promise((resolve) => {
      const res = { status: (code) => ({ json: (body) => resolve({ code, body }) }), json: (body) => resolve({ code: 200, body }) };
      jobsController.create({ body: { category: 'mechanical', area: 'Kasarani', description: 'Fix it' }, user: { id: '00000000-0000-0000-0000-000000000000' } }, res, (err) => resolve({ code: 500, body: err }));
    });
    expect(refused.code === 400, `a job with only "Fix it" was not refused (got ${refused.code})`);
    expect(/class="send-bar/.test(page) && /\.send-bar \{[^}]*position: sticky/.test(page), 'the Find a fundi button no longer stays on screen');
  });
}

// ---------- fundi identity (1.4.0) ----------
// Fundis now give a selfie and a KRA PIN as well as an ID. The selfie must sit
// where only an admin's signed link can read it.
async function identityChecks() {
  await check('A fundi application without a selfie, or with a malformed KRA PIN, is refused', async () => {
    const controller = require('../src/controllers/fundiController');
    const ownFolder = '00000000-0000-0000-0000-000000000000';
    const base = {
      category: 'installation', national_id: '12345678', years_experience: '2-5',
      id_document_url: `${ownFolder}/id.jpg`, certificate_paths: [], no_certificate: true,
    };
    const tryApply = async (body) => {
      let status = 200;
      const res = { status(code) { status = code; return this; }, json() { return this; } };
      await controller.apply({ user: { id: ownFolder }, body }, res, () => {});
      return status;
    };
    expect(await tryApply({ ...base, kra_pin: 'A123456789B' }) === 400, 'an application with no selfie was accepted');
    expect(await tryApply({ ...base, kra_pin: '12345', selfie_path: `${ownFolder}/me.jpg` }) === 400, 'a malformed KRA PIN was accepted');
    expect(await tryApply({ ...base, kra_pin: 'A123456789B', selfie_path: `${ownFolder}/me.pdf` }) === 400, 'a PDF was accepted as a selfie');
  });

  await check('Selfies are stored where only an admin can read them', async () => {
    const { data, error } = await admin.storage.getBucket('fundi-identity');
    expect(!error && data, 'the fundi-identity bucket does not exist (run migration 0022)');
    expect(data.public === false, 'the fundi-identity bucket is public');
    const migration = source('supabase/migrations/0022_fundi_identity.sql');
    expect(!/for select/i.test(migration), 'migration 0022 gives fundis a way to read selfies back');
    const adminSource = source('src/services/adminService.js');
    expect(/selfie_link/.test(adminSource) && /'fundi-identity'/.test(adminSource), 'the admin screen is no longer given a signed selfie link');
    expect(/selfie_link/.test(source('public/admin.html')) && /kra_pin/.test(source('public/admin.html')), 'the admin screen no longer shows the selfie or KRA PIN');
  });

  await check('The apply page asks for a selfie and a KRA PIN, and Privacy says what happens to them', async () => {
    const page = source('public/apply.html');
    expect(/id="selfieDoc"[^>]*capture="user"/.test(page), 'the apply page no longer asks for a selfie');
    expect(/id="kraPin"/.test(page), 'the apply page no longer asks for a KRA PIN');
    expect(/shrinkPhoto/.test(page) && /keepCopies\(selfieInput\)/.test(page), 'the selfie is no longer copied and shrunk when picked');
    const privacy = source('public/privacy.html');
    expect(/selfie/i.test(privacy) && /KRA PIN/.test(privacy), 'Privacy does not mention the selfie and KRA PIN');
  });
  await check('A new fundi starts on the rating an admin gave, and customer reviews move it', async () => {
    const { blend } = require('../src/services/fundiCardService');
    expect(blend(4, []).average === 4 && blend(4, []).starting_only, 'a fundi with no reviews does not show the starting rating');
    expect(blend(3, [5]).average === 3.5, 'one 5-star review does not lift a starting 3 to 3.5');
    expect(blend(4, [1]).average === 3.3, 'a 1-star review does not pull a starting 4 down to 3.3');
    expect(blend(null, [4, 5]).average === 4.5 && !blend(null, [4, 5]).starting_only, 'a fundi with no starting rating is not the plain average');
    expect(blend(null, []).average === null, 'a fundi with nothing shows a rating');
    const adminSource = source('src/services/adminService.js');
    expect(/rating_needed/.test(adminSource), 'a fundi can be approved without a starting rating');
    expect(fs.existsSync(new URL('../supabase/migrations/0023_starting_rating.sql', import.meta.url)), 'migration 0023 (starting rating) is missing');
    const { error } = await admin.from('fundi_profiles').select('starting_rating').limit(1);
    expect(!error, 'fundi_profiles has no starting_rating column (run migration 0023)');
    const jobs = source('src/services/jobService.js');
    expect(/fundiCards\.cardsFor/.test(jobs), 'the customer is no longer given the selfie and rating of their fundi');
  });
}

// ---------- fixed-rate services (1.5.0) ----------
// A listed service always costs its listed price, whatever amount the caller
// sends, and the menu can only name trades that exist.
async function rateChecks(user, category) {
  await check('Every trade list agrees, including the service menu', async () => {
    const front = [...source('public/assets/categories.js').matchAll(/key: '([a-z_]+)',\s*label: '[^']*',\s*group:/g)].map((m) => m[1]).sort();
    const back = [...require('../src/utils/categories').CATEGORIES].sort();
    expect(JSON.stringify(front) === JSON.stringify(back), `categories.js has ${front.join(',')} but the API has ${back.join(',')}`);
    const migration = source('supabase/migrations/0024_service_rates.sql');
    back.forEach((c) => expect(migration.includes(`'${c}'`), `service_rates does not allow the ${c} trade`));
    expect(/utils\/categories/.test(source('src/controllers/fundiController.js')), 'fundiController has its own copy of the trade list again');
  });

  await check('Every area list is the same, with the urban areas first', async () => {
    const lists = ['book', 'apply', 'profile'].map((p) => {
      const select = source(`public/${p}.html`).split('<select id="area"')[1].split('</select>')[0];
      return [p, [...select.matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1])];
    });
    lists.forEach(([p, areas]) => expect(JSON.stringify(areas) === JSON.stringify(lists[0][1]), `${p}.html lists different areas from book.html`));
    expect(lists[0][1].slice(0, 3).join() === 'Westlands,Kilimani,Kileleshwa', 'Westlands, Kilimani and Kileleshwa are no longer at the top of the area list');
  });

  await check('New accounts are made with Google only, while email accounts can still sign in', async () => {
    const signup = source('public/signup.html');
    expect(!/auth\.signUp\(|type="password"|type="email"/.test(signup), 'signup.html offers email sign-up again');
    expect(/signInWithOAuth\(\{\s*provider: 'google'/.test(signup), 'signup.html has lost Continue with Google');
    expect(/signInWithPassword\(/.test(source('public/login.html')), 'login.html no longer lets email accounts sign in');
  });

  await check('A listed service sets the price, and an unavailable one is refused', async () => {
    expect(fs.existsSync(new URL('../supabase/migrations/0024_service_rates.sql', import.meta.url)), 'migration 0024 (service rates) is missing');
    expect(/service_rate_id/.test(source('public/assets/quote-thread.js')), 'the fundi quotation form no longer offers the menu');
    if (!category) return;
    const jobService = require('../src/services/jobService');
    const made = [];
    try {
      const rate = async (fields) => {
        const { data, error } = await admin.from('service_rates').insert({ price_kes: 2500, ...fields }).select().single();
        if (error) throw error;
        made.push(data.id);
        return data;
      };
      const listed = await rate({ category, name: `Release check ${Date.now()}` });
      const off = await rate({ category, name: `Release check off ${Date.now()}`, active: false });
      const otherCategory = CATEGORIES.find((c) => c !== category);
      const elsewhere = await rate({ category: otherCategory, name: `Release check elsewhere ${Date.now()}` });

      const { data: job, error } = await admin.from('jobs').insert({
        customer_id: user.id, fundi_id: user.id, status: 'matched', category, area: 'Kasarani',
        description: `Release check: listed price ${Date.now()}`,
      }).select().single();
      if (error) throw error;

      const sent = await jobService.sendQuote(job.id, user.id, { items: [], note: null, serviceRateId: listed.id });
      expect(sent.quote_amount === 2500, `a listed service was priced at ${sent.quote_amount}, not its listed 2500`);
      expect(sent.service_rate_id === listed.id && sent.service_name === listed.name, 'the job does not record which service it was priced from');

      for (const [label, bad] of [['switched off', off], ['for another trade', elsewhere]]) {
        let code = null;
        try { await jobService.sendQuote(job.id, user.id, { items: [], note: null, serviceRateId: bad.id }); } catch (e) { code = e.code; }
        expect(code === 'rate_unavailable', `a service ${label} was accepted`);
      }

      const own = await jobService.sendQuote(job.id, user.id, { items: [{ id: 'own', kind: 'other', description: 'Price for the job', qty: null, unit: null, amount: 1800 }], note: null });
      expect(own.quote_amount === 1800 && own.service_rate_id === null && own.service_name === null, 'a job priced by hand still carries a service');

      // 1.7: the customer can pick the service while booking. The stored price
      // is the menu's, whatever the booking request says.
      const { error: colError } = await admin.from('jobs').select('requested_rate_id').limit(1);
      expect(!colError, 'jobs.requested_rate_id is missing: run migration 0027_feedback_1_7.sql in the Supabase SQL editor');
      const jobsController = require('../src/controllers/jobsController');
      const createAs = (body) => new Promise((resolve) => {
        const res = { status: (code) => ({ json: (b) => resolve({ code, body: b }) }), json: (b) => resolve({ code: 200, body: b }) };
        jobsController.create({ body, user: { id: user.id } }, res, (err) => resolve({ code: err.status || 500, body: err }));
      });
      const booked = await createAs({ category, area: 'Kasarani', requested_rate_id: listed.id, requested_price_kes: 1 });
      expect(booked.code === 200, `booking with a listed service failed: ${booked.body && (booked.body.message || JSON.stringify(booked.body))}`);
      const saved = booked.body.data;
      expect(saved.requested_rate_id === listed.id && saved.requested_price_kes === 2500 && saved.requested_service_name === listed.name,
        `the booking stored ${saved.requested_price_kes} for the service, not the menu's 2500`);
      const wrongTrade = await createAs({ category, area: 'Kasarani', requested_rate_id: elsewhere.id });
      expect(wrongTrade.code === 409, 'a booking with a service from another trade was accepted');
      const listedForCustomers = await require('../src/services/serviceRateService').listForCategory(category);
      expect(listedForCustomers.some((r) => r.id === listed.id) && !listedForCustomers.some((r) => r.id === off.id), 'customers see switched-off services, or not the listed ones');
    } finally {
      if (made.length) await admin.from('service_rates').delete().in('id', made);
    }
  });
}

// ---------- quotations (no more haggling) ----------
// A price is a list of charges. A listed service keeps its fixed price, extras
// show apart, a customer can turn a quotation down for another fundi, and a
// change after acceptance only counts once the customer says yes.
async function quotationChecks(user, category) {
  const jobService = require('../src/services/jobService');
  const jobsController = require('../src/controllers/jobsController');
  const matching = require('../src/services/matchingService');
  const { cleanItems } = require('../src/utils/quoteItems');

  const tableMissing = async () => {
    const { error } = await admin.from('job_quotations').select('id').limit(1);
    return error ? 'job_quotations is missing: run migration 0026_quotations.sql in the Supabase SQL editor' : null;
  };
  const bookedJob = async (fields = {}) => {
    const { data, error } = await admin.from('jobs').insert({
      customer_id: user.id, fundi_id: user.id, status: 'matched', category, area: 'Kasarani',
      description: `Release check: quotation ${Date.now()}`, ...fields,
    }).select().single();
    if (error) throw error;
    return data;
  };
  const versions = async (jobId) => {
    const { data, error } = await admin.from('job_quotations').select('*').eq('job_id', jobId).order('version');
    if (error) throw error;
    return data;
  };
  const withRate = async (work) => {
    const { data: rate, error } = await admin.from('service_rates')
      .insert({ category, name: `Release check quotation ${Date.now()}`, price_kes: 2500 }).select().single();
    if (error) throw error;
    try { return await work(rate); } finally { await admin.from('service_rates').delete().eq('id', rate.id); }
  };
  const extras = () => cleanItems([
    { kind: 'labour', description: 'Fitting and testing', amount: 1500 },
    { kind: 'parts', description: 'Roll bolts 10 mm', qty: 10, unit: 'pcs', amount: 3000 },
  ]);

  await check('A quotation lists each charge, and a listed service keeps its fixed price', async () => {
    const missing = await tableMissing();
    expect(!missing, missing);
    let refused = null;
    try { cleanItems([{ kind: 'service', description: 'Made-up service', amount: 1 }]); } catch (e) { refused = e.code; }
    expect(refused === 'invalid_request', 'a quotation line claiming to be the listed service was accepted from the app');

    await withRate(async (rate) => {
      const job = await bookedJob();
      const sent = await jobService.sendQuote(job.id, user.id, { items: extras(), note: null, serviceRateId: rate.id });
      expect(sent.quote_amount === 7000, `service 2500 + labour 1500 + parts 3000 came to ${sent.quote_amount}, not 7000`);
      const [first] = await versions(job.id);
      expect(first.items.length === 3 && first.items[0].kind === 'service' && first.items[0].amount === 2500,
        'the listed service is not the first line at its fixed price');
      expect(first.items[2].qty === 10 && first.items[2].unit === 'pcs', 'the quantity on a parts line was lost');

      await jobService.sendQuote(job.id, user.id, { items: extras().slice(0, 1), note: null, serviceRateId: rate.id });
      const [old, latest] = await versions(job.id);
      expect(old.replaced_at && !latest.replaced_at && latest.total === 4000, 'changing a quotation does not replace the one before it');
    });
  });

  await check('A customer who turns down a quotation gets another fundi, and that fundi is never offered the job again', async () => {
    const missing = await tableMissing();
    expect(!missing, missing);
    const job = await bookedJob();
    const { error } = await admin.from('job_offers').insert({
      job_id: job.id, fundi_id: user.id, round: 1, status: 'accepted', responded_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    if (error) throw error;
    await jobService.sendQuote(job.id, user.id, { items: extras(), note: null });
    const after = await jobService.declineQuote(job.id, user.id, { note: 'Release check' });
    expect(after.status === 'requested' && after.fundi_id === null && after.quote_amount === null,
      'a turned-down quotation did not send the job back into the search');
    expect((await matching.fundisWhoTurnedDown(job.id)).has(user.id), 'the fundi whose quotation was turned down can be offered the job again');
    const [q] = await versions(job.id);
    expect(q.declined_at, 'the turned-down quotation is not marked as turned down');
  });

  await check("An updated quotation needs the customer's yes, shows what was added, and keeps the fixed line", async () => {
    const missing = await tableMissing();
    expect(!missing, missing);
    await withRate(async (rate) => {
      const job = await bookedJob();
      const [labour, parts] = extras();
      await jobService.sendQuote(job.id, user.id, { items: [labour], note: null, serviceRateId: rate.id });
      const accepted = await jobService.acceptQuote(job.id, user.id, { payment_method: 'cash' });
      expect(accepted.final_cost === 4000, `the agreed price is ${accepted.final_cost}, not 4000`);

      const change = await jobService.revisePrice(job.id, user.id, { items: [{ ...labour, amount: 2000 }, parts], reason: 'Release check: bolts were needed' });
      expect(change.amount === 7500 && change.previous_amount === 4000, `the update went from ${change.previous_amount} to ${change.amount}, not 4000 to 7500`);
      const { data: still } = await admin.from('jobs').select('final_cost').eq('id', job.id).single();
      expect(still.final_cost === 4000, 'an update changed the agreed price before the customer accepted it');

      let second = null;
      try { await jobService.revisePrice(job.id, user.id, { items: [labour], reason: 'Release check: second update' }); } catch (e) { second = e.code; }
      expect(second === 'conflict', 'a second update was allowed while one was waiting');

      const thread = await jobService.thread(user.id, job.id);
      const update = thread.events.filter((e) => e.type === 'quotation').pop().quotation;
      expect(update.stage === 'update' && update.items[0].kind === 'service' && update.items[0].amount === 2500,
        'the fixed-rate line changed in an update');
      expect(update.items.some((l) => l.id === parts.id) && !thread.events.some((e) => e.type === 'update_answer'),
        'the thread does not show the added line, or shows an answer nobody gave');

      const done = await jobService.answerPriceChange(job.id, user.id, true);
      expect(done.final_cost === 7500, `accepting the update left the price at ${done.final_cost}`);
    });
  });

  await check('Old app versions can still send a single price', async () => {
    const missing = await tableMissing();
    expect(!missing, missing);
    const job = await bookedJob();
    let failure = null;
    await jobsController.quote(
      { params: { id: job.id }, user: { id: user.id }, body: { amount: 1800, note: null } },
      { json: () => {}, status() { return this; } },
      (err) => { failure = err; },
    );
    expect(!failure, failure && failure.message);
    const [q] = await versions(job.id);
    expect(q && q.total === 1800 && q.items.length === 1, 'a price sent the old way did not become a one-line quotation');
  });

  await check('The job thread is only for the customer and the booked fundi', async () => {
    const missing = await tableMissing();
    expect(!missing, missing);
    const job = await bookedJob();
    let code = null;
    try { await jobService.thread('00000000-0000-4000-8000-000000000000', job.id); } catch (e) { code = e.code; }
    expect(code === 'not_found', 'someone with nothing to do with the job could read its quotations');
  });

  await check("Terms say a turned-down quotation goes to another fundi, and updates need the customer's yes", async () => {
    const terms = source('public/terms.html');
    expect(/whose quotation you turn down/.test(terms), 'Terms section 4 does not say a fundi whose quotation was turned down is not offered the job again');
    expect(/updated quotation/.test(terms) && /only counts once the customer accepts it/.test(terms), 'Terms do not describe updated quotations');
  });
}

// ---------- commissions and the 6-day lock (1.6.0) ----------
// A fundi owes commission on jobs paid to them directly, and a commission left
// unpaid past its due date stops job offers until it is paid.
async function commissionChecks(user, category) {
  const commissions = require('../src/services/commissionService');

  await check('Commission is 10% of the price, free for a founding fundi\'s first 7 jobs', async () => {
    const fee = (finalCost, jobNumber, founding) => commissions.commissionFor({ finalCost, jobNumber, founding });
    expect(fee(2000, 1, false).amount === 200 && fee(2000, 1, false).rate === 0.1, 'a fundi who is not founding does not pay 10% from the first job');
    expect(fee(2000, 7, true).amount === 0, 'a founding fundi pays on their 7th job');
    expect(fee(2000, 8, true).amount === 200, 'a founding fundi does not pay from their 8th job');
    expect(fee(1255, 9, true).amount === 126, 'commission is not rounded to whole shillings');
    expect(commissions.GRACE_DAYS === 6, 'the due date is no longer 6 days');
  });

  await check('The lock is checked when ranking, showing and accepting offers, and card is gone', async () => {
    const matching = source('src/services/matchingService.js');
    const rank = matching.split('async function rankCandidates')[1].split('async function expireStaleOffers')[0];
    expect(/commissions\.lockedFundiIds\(/.test(rank), 'rankCandidates offers jobs to fundis who owe commission');
    const show = matching.split('async function offerForFundi')[1].split('async function acceptOffer')[0];
    expect(/commissions\.isLocked\(/.test(show), 'a locked fundi is still shown the offer waiting for them');
    const accept = matching.split('async function acceptOffer')[1].split('async function declineOffer')[0];
    expect(/commissions\.isLocked\(/.test(accept) && /commission_locked/.test(accept), 'a locked fundi can still take a job');
    const eligible = matching.split('async function eligibleFundiCount')[1].split('async function markExhausted')[0];
    expect(!/lockedFundiIds/.test(eligible), 'a locked fundi counts as having turned the job down, so customers are told everyone said no');
    expect(!/value="card"/.test(source('public/my-jobs.html')), 'the Card option is back on the payment screen');
    let status = 200;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    await require('../src/controllers/jobsController').acceptQuote({ params: { id: 'x' }, user: { id: 'x' }, body: { payment_method: 'card' } }, res, () => {});
    expect(status === 400, 'the API still accepts card as a payment method');
  });

  await check('Overdue commission locks a fundi until an admin confirms payment', async () => {
    expect(fs.existsSync(new URL('../supabase/migrations/0025_commissions.sql', import.meta.url)), 'migration 0025 (commissions) is missing');
    if (!category) return;
    const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
    const job = async (fields) => {
      const { data, error } = await admin.from('jobs').insert({
        customer_id: user.id, fundi_id: user.id, status: 'completed', category, area: 'Kasarani',
        description: `Release check: commission ${Date.now()}`, payment_method: 'cash', ...fields,
      }).select().single();
      if (error) throw error;
      return data;
    };
    const locked = async () => (await commissions.lockedFundiIds([user.id])).has(user.id);

    // A job completed now is recorded once, due in 6 days, however often it is read.
    const fresh = await job({ final_cost: 2000, completed_at: iso(0) });
    await commissions.reconcile(user.id);
    await commissions.reconcile(user.id);
    const { data: rows, error } = await admin.from('commissions').select('*').eq('job_id', fresh.id);
    if (error) throw error;
    expect(rows.length === 1, `a completed job has ${rows.length} commissions, not 1`);
    expect(rows[0].amount === 200 && Number(rows[0].rate) === 0.1, `commission recorded as ${rows[0].amount} at ${rows[0].rate}, not 200 at 0.1`);
    const dueInDays = (new Date(rows[0].due_at) - new Date(fresh.completed_at)) / 86400000;
    expect(Math.abs(dueInDays - 6) < 0.01, `commission falls due after ${dueInDays} days, not 6`);
    expect(!(await locked()), 'a fundi whose commission is not due yet is locked');

    // One past its due date locks them. Saying they paid does not unlock.
    const old = await job({ final_cost: 500, completed_at: iso(-30) });
    const { error: insertError } = await admin.from('commissions').insert({
      job_id: old.id, fundi_id: user.id, amount: 50, rate: 0.1, due_at: iso(-1),
    });
    if (insertError) throw insertError;
    expect(await locked(), 'a commission past its due date does not lock the fundi');
    await commissions.markClaimed(user.id, 'QK12ABC3DE');
    expect(await locked(), 'telling us they paid unlocked the fundi before an admin confirmed');
    const { data: claimed } = await admin.from('commissions').select('paid, claim_ref').eq('job_id', old.id).single();
    expect(claimed.paid === false && claimed.claim_ref === 'QK12ABC3DE', 'a payment claim was not recorded as a claim only');

    // Confirming payment lifts it straight away.
    await commissions.markPaid({ fundiId: user.id }, 'mpesa');
    expect(!(await locked()), 'the fundi is still locked after an admin confirmed payment');
    const wallet = await commissions.walletFor(user.id);
    expect(wallet.owed === 0 && wallet.locked === false, 'the wallet still shows a balance after payment');
  });

  await check('Admins are told the moment a fundi says they paid', async () => {
    const service = source('src/services/commissionService.js').split('async function claimPayment')[1].split('// ---------- admin')[0];
    expect(/notify\.commissionPaymentClaimed\(/.test(service), 'a payment claim no longer alerts admins');
    expect(/is_admin/.test(source('src/services/notificationService.js').split('async function commissionPaymentClaimed')[1]), 'the alert is no longer sent to admins');
    expect(/pay-claim/.test(source('public/fundi.html')) && /I've paid/.test(source('public/fundi.html')), 'the fundi can no longer say they have paid');
    // Recently paid once read "(mpesa)" instead of "(M-Pesa)".
    expect(!/\(\$\{c\.method\}\)/.test(source('public/admin.html')), 'the admin Commissions tab shows the raw payment method');
  });

  await check('Terms and Privacy describe the commission, and no payment details are in the code', async () => {
    const terms = source('public/terms.html');
    expect(/Commission \(fundis\)/.test(terms) && /6 days/.test(terms), 'Terms do not describe the commission and its 6 days');
    expect(/does not process, collect or hold any payment a customer makes/.test(terms), 'Terms no longer say customers\' payments are not held');
    expect(/commission owed on each completed job/.test(source('public/privacy.html')), 'Privacy does not mention commission records');
    // The paybill account is held in environment variables, never in a public file.
    const secrets = [process.env.COMMISSION_ACCOUNT_NO, process.env.COMMISSION_PAYBILL].map((v) => (v || '').trim()).filter((v) => v.length >= 5);
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full); else files.push(full);
      }
    };
    ['public', 'src', 'scripts', 'supabase'].forEach((d) => walk(fileURLToPath(new URL(`../${d}`, import.meta.url))));
    files.push(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), fileURLToPath(new URL('../.env.example', import.meta.url)));
    for (const file of files) {
      if (/\.(png|jpe?g|webp|mp4|woff2?|ico)$/i.test(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      secrets.forEach((secret) => expect(!text.includes(secret), `${path.basename(file)} contains the paybill details`));
    }
  });
}

// ---------- matching ----------
// A fundi who passed on a job, or took it and turned it down, kept being
// offered it again in the next search round (found in the 1.2 stress test: one
// job was offered more than 25 times). The test account stands in as the
// fundi, since an offer only needs a profile, so no real fundi is involved.
async function matchingChecks(user, category) {
  const matching = require('../src/services/matchingService');

  await check('A fundi who turned a job down is never offered it again', async () => {
    const { data: job, error } = await admin.from('jobs').insert({
      customer_id: user.id, category, area: 'Kasarani', description: `Release check: turned down ${Date.now()}`,
    }).select().single();
    if (error) throw error;
    const offer = { job_id: job.id, fundi_id: user.id, round: 1, expires_at: new Date(Date.now() + 60000).toISOString() };
    const barred = async () => (await matching.fundisWhoTurnedDown(job.id)).has(user.id);

    const { data: made, error: offerError } = await admin.from('job_offers').insert({ ...offer, status: 'declined' }).select().single();
    if (offerError) throw offerError;
    expect(await barred(), 'a fundi who passed on the job can be offered it again');

    await admin.from('job_offers').update({ status: 'accepted', released_at: new Date().toISOString() }).eq('id', made.id);
    expect(await barred(), 'a fundi who took the job and turned it down can be offered it again');

    await admin.from('job_offers').update({ status: 'expired', released_at: null }).eq('id', made.id);
    expect(!(await barred()), 'a fundi whose offer only ran out of time is barred for good, so a missed offer is lost');

    // Both the ranking and the "is anyone left" count must use the same list,
    // or a job whose fundis all passed goes round forever.
    const source = fs.readFileSync(new URL('../src/services/matchingService.js', import.meta.url), 'utf8');
    const uses = (source.match(/fundisWhoTurnedDown\(/g) || []).length;
    expect(uses >= 3, 'rankCandidates and eligibleFundiCount must both exclude fundis who turned the job down');
  });

  // 1.7 tester feedback: a fundi already booked kept seeing "Finding jobs near
  // you" and kept getting offers.
  await check('A fundi with a job in hand is not offered another', async () => {
    // Earlier checks leave booked test jobs on this account; close them so
    // only this check's job decides whether the account is busy.
    await admin.from('jobs').update({ status: 'cancelled' }).eq('fundi_id', user.id).in('status', ['matched', 'in_progress']);
    const { data: job, error } = await admin.from('jobs').insert({
      customer_id: user.id, fundi_id: user.id, status: 'matched', category, area: 'Kasarani',
      description: `Release check: busy fundi ${Date.now()}`,
    }).select().single();
    if (error) throw error;
    expect(await matching.isBusy(user.id), 'a fundi with a booked job does not count as busy');
    await admin.from('jobs').update({ status: 'in_progress' }).eq('id', job.id);
    expect(await matching.isBusy(user.id), 'a fundi with a job under way does not count as busy');
    await admin.from('jobs').update({ status: 'completed' }).eq('id', job.id);
    expect(!(await matching.isBusy(user.id)), 'a fundi stays busy after marking the job complete');

    const source = fs.readFileSync(new URL('../src/services/matchingService.js', import.meta.url), 'utf8');
    const body = (name) => source.slice(source.indexOf(`async function ${name}(`), source.indexOf('\n}\n', source.indexOf(`async function ${name}(`)));
    expect(/busyFundiIds\(/.test(body('rankCandidates')), 'busy fundis are still ranked for offers');
    expect(/isBusy\(/.test(body('offerForFundi')), 'a busy fundi is still shown an offer waiting');
    expect(/isBusy\(/.test(body('acceptOffer')), 'a busy fundi can still accept another job');
    expect(!/busy/i.test(body('eligibleFundiCount')), 'a busy fundi counts as having turned the job down, so customers are told everyone said no');
    const home = fs.readFileSync(new URL('../public/fundi.html', import.meta.url), 'utf8');
    expect(/'On a job'/.test(home), 'the fundi status bar no longer says when they are on a job');
  });
}

// ---------- 1.7: testimonials ----------
// The check never publishes a testimonial (that would show on the live home page).
async function safetyChecks(user) {
  const source = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const tables = async () => {
    for (const t of ['testimonials']) {
      const { error } = await admin.from(t).select('id').limit(1);
      if (error) return `${t} is missing: run migration 0027_feedback_1_7.sql in the Supabase SQL editor`;
    }
    return null;
  };

  // 0027 stopped with "column requested_rate_id already exists" when it was
  // run a second time. A migration from 0027 on must be safe to run again.
  await check('Migrations from 0027 on can be run twice without an error', async () => {
    const dir = new URL('../supabase/migrations/', import.meta.url);
    const files = fs.readdirSync(dir).filter((f) => /^\d{4}/.test(f) && f >= '0027' && f.endsWith('.sql'));
    expect(files.length, 'migration 0027 is missing');
    for (const f of files) {
      const sql = fs.readFileSync(new URL(f, dir), 'utf8').replace(/--.*$/gm, '');
      expect(!/add\s+column\s+(?!if\s+not\s+exists)/i.test(sql), `${f} adds a column without "if not exists"`);
      expect(!/create\s+(table|index|unique\s+index)\s+(?!if\s+not\s+exists)/i.test(sql), `${f} creates a table or index without "if not exists"`);
    }
    return `${files.length} file(s)`;
  });

  // The panic button is held back for 1.8. Until then no page may offer it,
  // because Terms and Privacy don't describe it.
  await check('The panic button is not offered before 1.8', async () => {
    expect(!/sos-btn|\/fundi\/panic|tel:999/.test(source('public/fundi.html')), 'fundi.html offers the panic button, but Terms and Privacy do not explain it');
    expect(!/data-tab="alerts"/.test(source('public/admin.html')), 'admin.html shows a panic Alerts tab');
  });

  await check('Testimonials need the person\'s agreement, and the home page gets only published ones', async () => {
    const missing = await tables();
    expect(!missing, missing);
    const testimonials = require('../src/services/testimonialService');
    let code = null;
    try { await testimonials.create(user.id, { person_name: 'Release check', role: 'customer', quote: 'Release check testimonial, never published.' }); } catch (e) { code = e.code; }
    expect(code === 'invalid_request', 'a testimonial without the person\'s agreement was saved');
    const made = await testimonials.create(user.id, { person_name: 'Release check', role: 'customer', quote: `Release check testimonial ${Date.now()}, never published.`, consent_confirmed: true });
    try {
      expect(made.published === false, 'a new testimonial goes straight onto the home page');
      const shown = await testimonials.listPublished();
      expect(!shown.some((t) => t.quote === made.quote), 'an unpublished testimonial is on the home page');
      expect(testimonials.PUBLIC_FIELDS === 'person_name, role, area, quote', 'the home page is sent more than name, role, area and words');
      const page = source('public/index.html');
      expect(/id="testimonials" class="bg-white" hidden/.test(page), 'the testimonials section shows before any are published');
    } finally {
      await admin.from('testimonials').delete().eq('id', made.id);
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
  await stressTestChecks();
  await identityChecks();
  const category = await emptyCategory();
  await rateChecks(user, category);
  await commissionChecks(user, category);
  await safetyChecks(user);
  if (!category) {
    console.log('SKIP  Booking checks: every category has a verified fundi, so a test job would page a real person.');
  } else {
    await matchingChecks(user, category);
    await quotationChecks(user, category);
    await browserChecks(user, category);
  }
} finally {
  const removed = await cleanUp(user.id);
  console.log(`\nCleaned up ${removed} test job(s).`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) FAILED. Do not release.` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
