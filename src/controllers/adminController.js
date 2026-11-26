const adminService = require('../services/adminService');
const serviceRateService = require('../services/serviceRateService');
const commissionService = require('../services/commissionService');
const testimonialService = require('../services/testimonialService');
const { cleanReason } = require('./jobsController');
const { CATEGORIES } = require('../utils/categories');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function insights(req, res, next) {
  try {
    const data = await adminService.insights();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function listFundiApplications(req, res, next) {
  try {
    const data = await adminService.listFundiApplications();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function setVerificationStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!['verified', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: { message: 'status must be verified, rejected, or pending', code: 'invalid_request' } });
    }
    const data = await adminService.setVerificationStatus(req.params.id, status);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function setStartingRating(req, res, next) {
  try {
    const rating = Number(req.body.rating);
    // Whole or half stars, from 1 to 5.
    if (!Number.isFinite(rating) || rating < 1 || rating > 5 || (rating * 2) % 1 !== 0) {
      return res.status(400).json({ error: { message: 'rating must be from 1 to 5, in half-star steps', code: 'invalid_request' } });
    }
    const data = await adminService.setStartingRating(req.params.id, rating);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function listServiceRates(req, res, next) {
  try {
    const data = await serviceRateService.listAll();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// Shared by create and update: only the fields sent are checked.
function rateFields(body, { requireAll }) {
  const fields = {};
  const bad = (message) => ({ error: { message, code: 'invalid_request' } });
  if (requireAll || body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) return bad('Pick a trade for this service.');
    fields.category = body.category;
  }
  if (requireAll || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 120) return bad('Give the service a name of 2 to 120 characters.');
    fields.name = name;
  }
  if (requireAll || body.price_kes !== undefined) {
    const price = Number(body.price_kes);
    if (!Number.isInteger(price) || price < 1 || price > 10000000) return bad('Enter the price in whole shillings.');
    fields.price_kes = price;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return bad('active must be true or false');
    fields.active = body.active;
  }
  return { fields };
}

async function createServiceRate(req, res, next) {
  try {
    const parsed = rateFields(req.body, { requireAll: true });
    if (parsed.error) return res.status(400).json(parsed);
    const data = await serviceRateService.create(parsed.fields);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function updateServiceRate(req, res, next) {
  try {
    const parsed = rateFields(req.body, { requireAll: false });
    if (parsed.error) return res.status(400).json(parsed);
    if (!Object.keys(parsed.fields).length) {
      return res.status(400).json({ error: { message: 'Nothing to change.', code: 'invalid_request' } });
    }
    const data = await serviceRateService.update(req.params.id, parsed.fields);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function listCommissions(req, res, next) {
  try {
    const data = await commissionService.listForAdmin();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// Confirms a payment against the bank: either one commission, or everything a
// fundi owes. Confirming is what lifts their lock.
async function confirmCommissionPaid(req, res, next) {
  try {
    const { fundi_id: fundiId, method } = req.body;
    const commissionId = req.params.id;
    if (!commissionId && !UUID_PATTERN.test(String(fundiId || ''))) {
      return res.status(400).json({ error: { message: 'Pick the fundi whose payment you are confirming.', code: 'invalid_request' } });
    }
    const data = await commissionService.markPaid({ commissionId, fundiId }, method);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function listUsers(req, res, next) {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    const data = await adminService.listUsers({ query });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function setSuspension(req, res, next) {
  try {
    if (typeof req.body.suspended !== 'boolean') {
      return res.status(400).json({ error: { message: 'suspended must be true or false', code: 'invalid_request' } });
    }
    const data = await adminService.setSuspended(req.user.id, req.params.id, req.body.suspended);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function listJobs(req, res, next) {
  try {
    const filter = typeof req.query.status === 'string' && adminService.JOB_FILTERS[req.query.status] ? req.query.status : 'all';
    const data = await adminService.listJobs({ filter });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function cancelJob(req, res, next) {
  try {
    const data = await adminService.cancelJob(req.params.id, cleanReason(req.body.reason));
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function listAdmins(req, res, next) {
  try {
    const data = await adminService.listAdmins();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function grantAdmin(req, res, next) {
  try {
    const data = await adminService.grantAdmin(req.body.email);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function revokeAdmin(req, res, next) {
  try {
    const data = await adminService.revokeAdmin(req.user.id, req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function certifyFundi(req, res, next) {
  try {
    const note = typeof req.body.note === 'string' && req.body.note.trim()
      ? req.body.note.trim().slice(0, 500) : null;
    const data = await adminService.certifyFundi(req.user.id, req.params.id, note);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function uncertifyFundi(req, res, next) {
  try {
    const data = await adminService.uncertifyFundi(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

const handle = (work) => async (req, res, next) => {
  try { res.json({ data: await work(req) }); } catch (err) { next(err); }
};

const listTestimonials = handle(() => testimonialService.listAll());
const createTestimonial = handle((req) => testimonialService.create(req.user.id, req.body || {}));
const updateTestimonial = handle((req) => testimonialService.update(req.params.id, req.body || {}));
const deleteTestimonial = handle((req) => testimonialService.remove(req.params.id));

module.exports = { listTestimonials, createTestimonial, updateTestimonial, deleteTestimonial, insights, certifyFundi, uncertifyFundi, listFundiApplications, setVerificationStatus, setStartingRating, listServiceRates, createServiceRate, updateServiceRate, listCommissions, confirmCommissionPaid, listUsers, setSuspension, listJobs, cancelJob, listAdmins, grantAdmin, revokeAdmin };
