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
    title: 'Your fundi has sent a new price',
    body: `${name} now says ${ksh(change.amount)} instead of ${ksh(change.previous_amount)}. Open My activity to read why and decide.`,
    url: CUSTOMER_URL,
    tag: `job-${job.id}`,
  });
}

async function priceRevisionAccepted(job, change) {
  await notifyUsers([job.fundi_id], {
    title: 'New price accepted',
    body: `The customer agreed ${ksh(change.amount)} for ${jobTitle(job)}.`,
    url: FUNDI_URL,
    tag: `job-${job.id}`,
  });
}

async function priceRevisionDeclined(job, change) {
  await notifyUsers([job.fundi_id], {
    title: 'New price turned down',
    body: `The customer kept the agreed ${ksh(change.previous_amount)} for ${jobTitle(job)}. Call them before going further.`,
    url: FUNDI_URL,
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
    body: `${name} booked you for ${jobTitle(job)} in ${job.area}. Call them, then send your price.`,
    url: FUNDI_URL,
    tag: `job-${job.id}`,
  });
}

// The customer is waiting for exactly this, often with the app closed.
async function fundiFound(job) {
  const name = await firstName(job.fundi_id);
  await notifyUsers([job.customer_id], {
    title: `${name} is taking your job`,
    body: `${name} took ${jobTitle(job)} and will call you, then send a price.`,
    url: CUSTOMER_URL,
    tag: `job-${job.id}`,
  });
}

async function priceSent(job) {
  const name = await firstName(job.fundi_id);
  await notifyUsers([job.customer_id], {
    title: `${name} sent a price`,
    body: `${ksh(job.quote_amount)} for ${jobTitle(job)}. Review it in My activity.`,
    url: CUSTOMER_URL,
    tag: `job-${job.id}`,
  });
}

async function priceAccepted(job) {
  const name = await firstName(job.customer_id);
  const pay = job.payment_method ? `, paying by ${PAYMENT_LABELS[job.payment_method]}` : '';
  await notifyUsers([job.fundi_id], {
    title: 'Price accepted',
    body: `${name} accepted ${ksh(job.final_cost)} for ${jobTitle(job)}${pay}.`,
    url: FUNDI_URL,
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

module.exports = { jobOffered, priceRevised, priceRevisionAccepted, priceRevisionDeclined, gettingMaterials, backOnSite, searchExhausted, fundiBooked, fundiFound, priceSent, priceAccepted, jobCompleted, jobCancelled, fundiReleased };
