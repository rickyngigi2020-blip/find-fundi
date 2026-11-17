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
  });

  await check('Booking needs only a trade and an area', async () => {
    const page = source('public/book.html');
    expect(!/Describe what you need, or record a voice note/.test(page), 'booking requires a description again');
    expect(!/Describe the problem in writing or record a voice note/.test(source('src/controllers/jobsController.js')), 'the API requires a description again');
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
    expect(/service_rate_id/.test(source('public/assets/fundi-jobs.js')), 'the fundi quote form no longer offers the menu');
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

      const sent = await jobService.sendQuote(job.id, user.id, { amount: 1, note: null, serviceRateId: listed.id });
      expect(sent.quote_amount === 2500, `a listed service was priced at ${sent.quote_amount}, not its listed 2500`);
      expect(sent.service_rate_id === listed.id && sent.service_name === listed.name, 'the job does not record which service it was priced from');

      for (const [label, bad] of [['switched off', off], ['for another trade', elsewhere]]) {
        let code = null;
        try { await jobService.sendQuote(job.id, user.id, { amount: 1, note: null, serviceRateId: bad.id }); } catch (e) { code = e.code; }
        expect(code === 'rate_unavailable', `a service ${label} was accepted`);
      }

      const own = await jobService.sendQuote(job.id, user.id, { amount: 1800, note: null });
      expect(own.quote_amount === 1800 && own.service_rate_id === null && own.service_name === null, 'a job priced by hand still carries a service');
    } finally {
      if (made.length) await admin.from('service_rates').delete().in('id', made);
    }
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
  if (!category) {
    console.log('SKIP  Booking checks: every category has a verified fundi, so a test job would page a real person.');
  } else {
    await matchingChecks(user, category);
    await browserChecks(user, category);
  }
} finally {
  const removed = await cleanUp(user.id);
  console.log(`\nCleaned up ${removed} test job(s).`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) FAILED. Do not release.` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
