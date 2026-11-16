const { adminClient } = require('../db/supabase');
const { toApiError } = require('../utils/dbError');
const { apiError } = require('../utils/apiError');
const notify = require('./notificationService');

// Find Fundi's commission on a job paid straight to the fundi (cash or
// M-Pesa). It comes out of the price the customer agreed, so the customer
// never pays more. Card jobs are not here: card money will land with Find
// Fundi first, which is a payout matter (not built yet).
const DIRECT_RATE = 0.10;
const DIRECT_METHODS = ['cash', 'mpesa'];

// The first FOUNDING_SLOTS fundis approved pay nothing on their first
// FREE_JOBS jobs.
const FREE_JOBS = 7;
const FOUNDING_SLOTS = 50;

// A commission falls due this many days after its job is completed. Anything
// unpaid past that stops job offers until it is paid.
const GRACE_DAYS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

// Jobs completed before the ledger existed owe nothing and do not use up a
// founding fundi's free jobs.
const LEDGER_START = '2026-11-16T00:00:00+03:00';

// M-Pesa confirmation codes are ten letters and digits, like QK12ABC3DE.
const MPESA_CODE = /^[A-Z0-9]{10}$/;

// The commission on one job. `jobNumber` is how many jobs the fundi has
// completed since the ledger started, counting this one.
function commissionFor({ finalCost, jobNumber, founding }) {
  if (founding && jobNumber <= FREE_JOBS) return { amount: 0, rate: 0 };
  return { amount: Math.round(finalCost * DIRECT_RATE), rate: DIRECT_RATE };
}

async function completedJobs(fundiId) {
  const { data, error } = await adminClient
    .from('jobs')
    .select('id, final_cost, payment_method, completed_at, category')
    .eq('fundi_id', fundiId)
    .eq('status', 'completed')
    .gte('completed_at', LEDGER_START)
    .order('completed_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw toApiError(error);
  return data;
}

async function isFounding(fundiId) {
  const { data, error } = await adminClient
    .from('fundi_profiles').select('founding_member').eq('id', fundiId).maybeSingle();
  if (error) throw toApiError(error);
  return Boolean(data && data.founding_member);
}

// Makes sure every completed job that owes a commission has one. Called when a
// job is completed, and again whenever the fundi's wallet or lock is read, so
// an insert that failed once is repaired rather than lost. Safe to repeat: a
// job can only have one commission.
async function reconcile(fundiId) {
  const [jobs, founding] = await Promise.all([completedJobs(fundiId), isFounding(fundiId)]);
  if (!jobs.length) return;
  const { data: existing, error } = await adminClient
    .from('commissions').select('job_id').in('job_id', jobs.map((j) => j.id));
  if (error) throw toApiError(error);
  const have = new Set(existing.map((c) => c.job_id));

  const rows = [];
  jobs.forEach((job, index) => {
    if (have.has(job.id) || !DIRECT_METHODS.includes(job.payment_method) || !(job.final_cost > 0)) return;
    const { amount, rate } = commissionFor({ finalCost: job.final_cost, jobNumber: index + 1, founding });
    if (amount < 1) return;
    rows.push({
      job_id: job.id,
      fundi_id: fundiId,
      amount,
      rate,
      due_at: new Date(new Date(job.completed_at).getTime() + GRACE_DAYS * DAY_MS).toISOString(),
    });
  });
  if (!rows.length) return;
  const { error: insertError } = await adminClient
    .from('commissions').upsert(rows, { onConflict: 'job_id', ignoreDuplicates: true });
  if (insertError) throw toApiError(insertError);
}

// Which of these fundis have a commission past its due date. Pure timestamp
// arithmetic: no background worker has to notice anything, and the lock lifts
// the moment the row is marked paid. Used when ranking, so it does not repair
// the ledger; `isLocked` does.
async function lockedFundiIds(ids) {
  if (!ids.length) return new Set();
  const { data, error } = await adminClient
    .from('commissions')
    .select('fundi_id')
    .in('fundi_id', ids)
    .eq('paid', false)
    .lt('due_at', new Date().toISOString());
  if (error) throw toApiError(error);
  return new Set(data.map((c) => c.fundi_id));
}

async function isLocked(fundiId) {
  await reconcile(fundiId).catch((e) => console.error('commission reconcile failed', e.message));
  return (await lockedFundiIds([fundiId])).has(fundiId);
}

const LOCKED_MESSAGE = 'Your offers are paused until you pay the commission you owe. Open Home to see how to pay.';

function payTo() {
  const paybill = (process.env.COMMISSION_PAYBILL || '').trim();
  const account = (process.env.COMMISSION_ACCOUNT_NO || '').trim();
  return paybill && account ? { paybill, account } : null;
}

// Everything the fundi's wallet card shows.
async function walletFor(fundiId) {
  await reconcile(fundiId).catch((e) => console.error('commission reconcile failed', e.message));
  const [{ data: open, error }, founding, jobs] = await Promise.all([
    adminClient
      .from('commissions')
      .select('id, amount, rate, due_at, claimed_at, claim_ref, jobs!inner(category, completed_at)')
      .eq('fundi_id', fundiId)
      .eq('paid', false)
      .order('due_at', { ascending: true }),
    isFounding(fundiId),
    completedJobs(fundiId),
  ]);
  if (error) throw toApiError(error);

  const now = Date.now();
  const claimed = open.find((c) => c.claimed_at);
  return {
    owed: open.reduce((sum, c) => sum + c.amount, 0),
    items: open.map((c) => ({
      id: c.id,
      amount: c.amount,
      rate: Number(c.rate),
      due_at: c.due_at,
      overdue: new Date(c.due_at).getTime() < now,
      category: c.jobs.category,
      completed_at: c.jobs.completed_at,
    })),
    locked: open.some((c) => new Date(c.due_at).getTime() < now),
    next_due_at: open.length ? open[0].due_at : null,
    claim: claimed ? { claimed_at: claimed.claimed_at, ref: claimed.claim_ref } : null,
    free_jobs_left: founding ? Math.max(0, FREE_JOBS - jobs.length) : null,
    free_jobs_total: founding ? FREE_JOBS : null,
    pay_to: payTo(),
  };
}

// Records that the fundi says they have paid. Everything they owe is marked
// claimed. This does not unlock them: an admin confirms it against the bank.
async function markClaimed(fundiId, ref) {
  const code = String(ref || '').replace(/\s+/g, '').toUpperCase();
  if (!MPESA_CODE.test(code)) {
    throw apiError(400, 'Enter the 10-character M-Pesa code from your payment message, like QK12ABC3DE.', 'invalid_request');
  }
  const { data, error } = await adminClient
    .from('commissions')
    .update({ claimed_at: new Date().toISOString(), claim_ref: code, updated_at: new Date().toISOString() })
    .eq('fundi_id', fundiId)
    .eq('paid', false)
    .select('amount');
  if (error) throw toApiError(error);
  if (!data.length) throw apiError(409, 'You do not owe any commission right now.', 'conflict');
  return { total: data.reduce((sum, c) => sum + c.amount, 0), ref: code };
}

async function claimPayment(fundiId, ref) {
  const claim = await markClaimed(fundiId, ref);
  await notify.commissionPaymentClaimed(fundiId, claim.total, claim.ref)
    .catch((e) => console.error('commissionPaymentClaimed failed', e.message));
  return claim;
}

// ---------- admin ----------

// Who owes what, grouped by fundi: those waiting on an admin to confirm a
// payment first, then everyone else who owes, then what was paid lately.
async function listForAdmin() {
  const [open, paid] = await Promise.all([
    adminClient
      .from('commissions')
      .select('id, fundi_id, amount, due_at, claimed_at, claim_ref, profiles!commissions_fundi_id_fkey(full_name, phone)')
      .eq('paid', false)
      .order('due_at', { ascending: true }),
    adminClient
      .from('commissions')
      .select('id, fundi_id, amount, paid_at, method, profiles!commissions_fundi_id_fkey(full_name, phone)')
      .eq('paid', true)
      .order('paid_at', { ascending: false })
      .limit(30),
  ]);
  if (open.error) throw toApiError(open.error);
  if (paid.error) throw toApiError(paid.error);

  const now = Date.now();
  const byFundi = {};
  open.data.forEach((c) => {
    const f = (byFundi[c.fundi_id] ||= {
      fundi_id: c.fundi_id,
      full_name: c.profiles.full_name,
      phone: c.profiles.phone,
      owed: 0,
      count: 0,
      oldest_due_at: c.due_at,
      locked: false,
      claimed_at: null,
      claim_ref: null,
    });
    f.owed += c.amount;
    f.count += 1;
    if (new Date(c.due_at).getTime() < now) f.locked = true;
    if (c.claimed_at && !f.claimed_at) { f.claimed_at = c.claimed_at; f.claim_ref = c.claim_ref; }
  });
  const groups = Object.values(byFundi);
  return {
    waiting: groups.filter((g) => g.claimed_at),
    owed: groups.filter((g) => !g.claimed_at),
    paid: paid.data.map((c) => ({
      id: c.id, fundi_id: c.fundi_id, full_name: c.profiles.full_name, phone: c.profiles.phone,
      amount: c.amount, paid_at: c.paid_at, method: c.method,
    })),
  };
}

const METHODS = ['mpesa', 'cash', 'bank'];

// Marks commissions paid. `where` narrows to one commission or one fundi's
// whole balance. Lifting the lock needs nothing more: it is worked out from
// what is unpaid.
async function markPaid({ commissionId, fundiId }, method) {
  if (!METHODS.includes(method)) throw apiError(400, 'method must be mpesa, cash or bank', 'invalid_request');
  const now = new Date().toISOString();
  let query = adminClient
    .from('commissions')
    .update({ paid: true, paid_at: now, method, updated_at: now })
    .eq('paid', false);
  query = commissionId ? query.eq('id', commissionId) : query.eq('fundi_id', fundiId);
  const { data, error } = await query.select('id, amount');
  if (error) throw toApiError(error);
  if (!data.length) throw apiError(404, 'Nothing unpaid to confirm.', 'not_found');
  return { confirmed: data.length, total: data.reduce((sum, c) => sum + c.amount, 0) };
}

module.exports = {
  commissionFor, reconcile, lockedFundiIds, isLocked, walletFor, markClaimed, claimPayment,
  listForAdmin, markPaid, LOCKED_MESSAGE,
  FREE_JOBS, FOUNDING_SLOTS, GRACE_DAYS, DIRECT_RATE, DIRECT_METHODS, LEDGER_START,
};
