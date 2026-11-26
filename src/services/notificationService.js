const { adminClient } = require('../db/supabase');
const { notifyUsers } = require('./pushService');

// What each job change tells the people involved. Wording matches the pages
// the notification opens: fundis act in the fundi app, customers in My activity.

// Keep in step with public/assets/categories.js.
const CATEGORY_LABELS = {
  phone_electronics: 'Phones & Electronics',
  computer_laptop: 'Computers & Laptops',
  appliance: 'Home Appliances',
  mechanical: 'Vehicles',
  general_maintenance: 'General Maintenance',
  installation: 'Installation',
  tailoring: 'Tailoring & Sewing',
  electrical: 'General Maintenance',
};
const PAYMENT_LABELS = { mpesa: 'M-Pesa', card: 'card', cash: 'cash' };

const FUNDI_URL = '/fundi.html';
const CUSTOMER_URL = '/my-jobs.html';

// Price events open the job's quotation thread rather than the job list.
const customerThread = (job) => `${CUSTOMER_URL}?job=${job.id}&thread=1`;
const fundiThread = (job) => `${FUNDI_URL}?job=${job.id}&thread=1`;

const jobTitle = (job) => job.subcategory || CATEGORY_LABELS[job.category] || 'your job';
const ksh = (amount) => `KSh ${Number(amount).toLocaleString('en-KE')}`;

async function firstName(userId) {
  const { data } = await adminClient.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  return (data && data.full_name && data.full_name.trim().split(/\s+/)[0]) || 'Someone';
}

// One fundi at a time gets the job, so this replaces the old broadcast to
// everyone in the category. It expires, so it says so.
async function jobOffered(job, fundiId) {
  const summary = job.description ? job.description.slice(0, 90)
    : job.voice_note_path ? 'Described in a voice note' : 'No details given, the customer explains on the call';
  await notifyUsers([fundiId], {
    title: `Job for you in ${job.area}: ${jobTitle(job)}`,
    body: `${summary.replace(/[.!?\s]+$/, '')}. Open the app to take it before it passes on.`,
    url: FUNDI_URL,
    tag: `offer-${job.id}`,
  });
}

// Everyone who could take it has passed, or the category has nobody approved.
// The customer is waiting on a screen that says "finding your fundi", so they
// need telling.
async function searchExhausted(job) {
  await notifyUsers([job.customer_id], {
    title: 'No fundi available yet',
    body: `Nobody could take ${jobTitle(job)} in ${job.area}. It stays open and goes out again as fundis join.`,
    url: CUSTOMER_URL,
    tag: `job-${job.id}`,
  });
}

async function priceRevised(job, change) {
  const name = await firstName(job.fundi_id);
  await notifyUsers([job.customer_id], {
    title: `${name} updated the quotation`,
    body: `${ksh(change.amount)} instead of the agreed ${ksh(change.previous_amount)}. Open it to see what was added and decide.`,
    url: customerThread(job),
    tag: `job-${job.id}`,
  });
}

async function priceRevisionAccepted(job, change) {
  await notifyUsers([job.fundi_id], {
    title: 'Updated quotation accepted',
    body: `The customer agreed ${ksh(change.amount)} for ${jobTitle(job)}.`,
    url: fundiThread(job),
    tag: `job-${job.id}`,
  });
}

async function priceRevisionDeclined(job, change) {
  await notifyUsers([job.fundi_id], {
    title: 'Updated quotation turned down',
    body: `The customer kept the agreed ${ksh(change.previous_amount)} for ${jobTitle(job)}. Call them before going further.`,
    url: fundiThread(job),
    tag: `job-${job.id}`,
  });
}

async function gettingMaterials(job) {
  const name = await firstName(job.fundi_id);
  const back = job.materials_expected_back
    ? ` Back ${new Date(job.materials_expected_back).toLocaleString('en-KE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.`
    : '';
  await notifyUsers([job.customer_id], {
    title: `${name} has gone for materials`,
    body: `${job.materials_note || 'They are getting what the job needs.'}${back}`,
    url: CUSTOMER_URL,
    tag: `job-${job.id}`,
  });
}

async function backOnSite(job) {
  const name = await firstName(job.fundi_id);
  await notifyUsers([job.customer_id], {
    title: `${name} is back on the job`,
    body: `Work has started again on ${jobTitle(job)}.`,
    url: CUSTOMER_URL,
    tag: `job-${job.id}`,
  });
}

async function fundiBooked(job) {
  const name = await firstName(job.customer_id);
  await notifyUsers([job.fundi_id], {
    title: "You've been booked",
    body: `${name} booked you for ${jobTitle(job)} in ${job.area}. Call them, then send your quotation.`,
    url: FUNDI_URL,
    tag: `job-${job.id}`,
  });
}

// The customer is waiting for exactly this, often with the app closed.
async function fundiFound(job) {
  const name = await firstName(job.fundi_id);
  await notifyUsers([job.customer_id], {
    title: `${name} is taking your job`,
    body: `${name} took ${jobTitle(job)} and will call you, then send a quotation.`,
    url: CUSTOMER_URL,
    tag: `job-${job.id}`,
  });
}

async function priceSent(job) {
  const name = await firstName(job.fundi_id);
  await notifyUsers([job.customer_id], {
    title: `${name} sent a quotation`,
    body: `${ksh(job.quote_amount)} for ${jobTitle(job)}. Open it to see each charge and decide.`,
    url: customerThread(job),
    tag: `job-${job.id}`,
  });
}

async function priceAccepted(job) {
  const name = await firstName(job.customer_id);
  const pay = job.payment_method ? `, paying by ${PAYMENT_LABELS[job.payment_method]}` : '';
  await notifyUsers([job.fundi_id], {
    title: 'Quotation accepted',
    body: `${name} accepted ${ksh(job.final_cost)} for ${jobTitle(job)}${pay}. You can start the job.`,
    url: fundiThread(job),
    tag: `job-${job.id}`,
  });
}

async function jobCompleted(job) {
  const name = await firstName(job.fundi_id);
  await notifyUsers([job.customer_id], {
    title: 'Job marked complete',
    body: `${name} marked ${jobTitle(job)} complete. Rate how it went.`,
    url: CUSTOMER_URL,
    tag: `job-${job.id}`,
  });
}

// `fundiId` is the fundi who was booked before the change, if any.
async function jobCancelled(job, fundiId) {
  const title = `${jobTitle(job)} was cancelled`;
  const reason = job.cancel_reason ? ` Reason: ${job.cancel_reason}` : '';
  if (job.cancelled_by === 'customer') {
    const name = await firstName(job.customer_id);
    await notifyUsers([fundiId], { title, body: `${name} cancelled this job.${reason}`, url: FUNDI_URL, tag: `job-${job.id}` });
    return;
  }
  const body = `Find Fundi cancelled this job.${reason}`;
  await Promise.all([
    notifyUsers([job.customer_id], { title, body, url: CUSTOMER_URL, tag: `job-${job.id}` }),
    notifyUsers([fundiId], { title, body, url: FUNDI_URL, tag: `job-${job.id}` }),
  ]);
}

async function fundiReleased(job, fundiId) {
  const name = await firstName(fundiId);
  await notifyUsers([job.customer_id], {
    title: `${name} can't take your job`,
    body: `We're offering ${jobTitle(job)} to the next fundi. Nothing for you to do.`,
    url: CUSTOMER_URL,
    tag: `job-${job.id}`,
  });
}

// The customer turned the quotation down and asked for someone else. The job
// is already on its way to the next fundi; this one is not offered it again.
// `fundiId` is the fundi whose quotation it was, `amount` what they quoted.
async function quoteDeclined(job, fundiId, amount) {
  await Promise.all([
    notifyUsers([fundiId], {
      title: 'Quotation turned down',
      body: `The customer chose not to go ahead at ${ksh(amount)} for ${jobTitle(job)}. The job has gone to another fundi.`,
      url: FUNDI_URL,
      tag: `job-${job.id}`,
    }),
    notifyUsers([job.customer_id], {
      title: 'Finding you another fundi',
      body: `We're offering ${jobTitle(job)} to the next fundi. They'll call you and send their own quotation.`,
      url: CUSTOMER_URL,
      tag: `job-${job.id}`,
    }),
  ]);
}

// A fundi says they have paid their commission and sends the M-Pesa code. Every
// admin is told straight away, so a payment is never sitting unnoticed while
// the fundi is locked out. Opens the Commissions tab to confirm it.
async function commissionPaymentClaimed(fundiId, total, ref) {
  const [name, { data: admins, error }] = await Promise.all([
    firstName(fundiId),
    adminClient.from('profiles').select('id').eq('is_admin', true),
  ]);
  if (error) throw error;
  await notifyUsers(admins.map((a) => a.id), {
    title: `${name} says they paid ${ksh(total)}`,
    body: `M-Pesa code ${ref}. Check it against the statement, then confirm it in Commissions.`,
    url: '/admin.html#commissions',
    tag: `commission-${fundiId}`,
  });
}

module.exports = { commissionPaymentClaimed, quoteDeclined, jobOffered, priceRevised, priceRevisionAccepted, priceRevisionDeclined, gettingMaterials, backOnSite, searchExhausted, fundiBooked, fundiFound, priceSent, priceAccepted, jobCompleted, jobCancelled, fundiReleased };
