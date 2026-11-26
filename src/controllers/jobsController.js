const jobService = require('../services/jobService');
const matching = require('../services/matchingService');
const { cleanItems } = require('../utils/quoteItems');
const serviceRates = require('../services/serviceRateService');

const MIN_DESCRIPTION = 15;
const DETAILS_NEEDED = 'Tell the fundi a little about the job: pick a service, answer a question, or add a sentence, a voice note or a photo.';

async function create(req, res, next) {
  try {
    const { category, subcategory, urgency, area, customer_lat, customer_lng } = req.body;
    const description = typeof req.body.description === 'string' && req.body.description.trim() ? req.body.description.trim() : null;
    const voice_note_path = typeof req.body.voice_note_path === 'string' && req.body.voice_note_path ? req.body.voice_note_path : null;
    const photo_paths = Array.isArray(req.body.photo_paths) ? req.body.photo_paths.filter((p) => typeof p === 'string' && p) : [];

    if (!category || !area) {
      return res.status(400).json({ error: { message: 'category and area are required', code: 'invalid_request' } });
    }
    // The fundi should know what they are walking into before they call, so a
    // job needs something to go on: a service from the menu, a short
    // description (the booking page's quick answers count), a voice note or a
    // photo. Any one is enough, so booking stays quick.
    const requestedRateId = typeof req.body.requested_rate_id === 'string' && req.body.requested_rate_id ? req.body.requested_rate_id : null;
    if (!requestedRateId && !voice_note_path && !photo_paths.length && (!description || description.length < MIN_DESCRIPTION)) {
      return res.status(400).json({ error: { message: DETAILS_NEEDED, code: 'invalid_request' } });
    }
    if (photo_paths.length > 5) {
      return res.status(400).json({ error: { message: 'You can attach up to 5 photos', code: 'invalid_request' } });
    }

    // Media must live in the caller's own storage folder; storage RLS enforces
    // the upload, this stops a job pointing at someone else's files.
    const ownPrefix = `${req.user.id}/`;
    if ((voice_note_path && !voice_note_path.startsWith(ownPrefix)) || photo_paths.some((p) => !p.startsWith(ownPrefix))) {
      return res.status(400).json({ error: { message: 'Attached media must be your own uploads', code: 'invalid_request' } });
    }

    // The name and price are read from the menu, never taken from the request.
    let requested = {};
    if (requestedRateId) {
      const rate = await serviceRates.usableForBooking(requestedRateId, category);
      requested = { requested_rate_id: rate.id, requested_service_name: rate.name, requested_price_kes: rate.price_kes };
    }

    const job = await jobService.createJob(req.user.id, {
      category, subcategory, description, urgency, area, voice_note_path, photo_paths,
      customer_lat: customer_lat ?? null, customer_lng: customer_lng ?? null,
      ...requested,
    });
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

async function mine(req, res, next) {
  try {
    const role = req.query.role === 'fundi' ? 'fundi' : 'customer';
    const data = await jobService.listMine(req.accessToken, req.user.id, role);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function feed(req, res, next) {
  try {
    const data = await jobService.listFeed(req.accessToken);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// Fundis answer the offer the matching service sent them; customers no longer
// pick anyone.
async function acceptOffer(req, res, next) {
  try {
    const job = await matching.acceptOffer(req.params.id, req.user.id);
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

async function declineOffer(req, res, next) {
  try {
    const result = await matching.declineOffer(req.params.id, req.user.id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

// The one job waiting on this fundi right now, with the seconds left to answer.
async function myOffer(req, res, next) {
  try {
    const offer = await matching.offerForFundi(req.user.id);
    if (!offer) return res.json({ data: null });
    const { jobs: job, ...rest } = offer;
    res.json({ data: { ...rest, job, seconds_left: Math.max(0, Math.round((new Date(offer.expires_at) - Date.now()) / 1000)) } });
  } catch (err) {
    next(err);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function quote(req, res, next) {
  try {
    // A listed service sets its own price, and the server adds it as the first
    // line; the fundi's lines are the extras (labour, parts, transport, other).
    const serviceRateId = typeof req.body.service_rate_id === 'string' && req.body.service_rate_id ? req.body.service_rate_id : null;
    if (serviceRateId && !UUID_PATTERN.test(serviceRateId)) {
      return res.status(400).json({ error: { message: 'Pick a service from the list.', code: 'invalid_request' } });
    }
    let items;
    if (Array.isArray(req.body.items)) {
      items = cleanItems(req.body.items, { allowEmpty: !!serviceRateId });
    } else if (serviceRateId) {
      items = [];
    } else {
      // An app version from before quotations sends one number.
      const amount = Number(req.body.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000000) {
        return res.status(400).json({ error: { message: 'Enter the agreed price in whole shillings', code: 'invalid_request' } });
      }
      items = cleanItems([{ kind: 'other', description: 'Price for the job', amount }]);
    }
    const note = typeof req.body.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : null;
    const job = await jobService.sendQuote(req.params.id, req.user.id, { items, note, serviceRateId });
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

// The customer turns the quotation down and the job goes to another fundi.
async function declineQuote(req, res, next) {
  try {
    const note = typeof req.body.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : null;
    const quotedAt = typeof req.body.quoted_at === 'string' ? req.body.quoted_at : null;
    const job = await jobService.declineQuote(req.params.id, req.user.id, { note, quoted_at: quotedAt });
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

async function thread(req, res, next) {
  try {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ error: { message: 'Job not found.', code: 'not_found' } });
    const data = await jobService.thread(req.user.id, req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function acceptQuote(req, res, next) {
  try {
    const { payment_method, quoted_at } = req.body;
    if (!['mpesa', 'cash'].includes(payment_method)) {
      return res.status(400).json({ error: { message: 'Choose how you will pay: M-Pesa or cash', code: 'invalid_request' } });
    }
    const job = await jobService.acceptQuote(req.params.id, req.user.id, { payment_method, quoted_at });
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

async function complete(req, res, next) {
  try {
    const job = await jobService.completeJob(req.params.id, req.user.id);
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

async function review(req, res, next) {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: { message: 'rating must be between 1 and 5', code: 'invalid_request' } });
    }
    const data = await jobService.addReview(req.accessToken, req.params.id, { rating, comment });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// Optional short reason, shown to the other party.
function cleanReason(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null;
}

async function cancel(req, res, next) {
  try {
    const job = await jobService.cancelJob(req.params.id, { by: 'customer', customerId: req.user.id, reason: cleanReason(req.body.reason) });
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

async function release(req, res, next) {
  try {
    const note = typeof req.body.note === 'string' && req.body.note.trim()
      ? req.body.note.trim().slice(0, 500) : null;
    const job = await jobService.releaseJob(req.params.id, req.user.id, { reason: req.body.reason, note });
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

async function revisePrice(req, res, next) {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 10) {
      return res.status(400).json({ error: { message: 'Say what changed, so the customer can decide fairly.', code: 'invalid_request' } });
    }
    let items = null;
    let legacyTotal = null;
    if (Array.isArray(req.body.items)) {
      // The listed service line is kept by the server, so the fundi may send
      // no other lines (taking every extra off).
      items = cleanItems(req.body.items, { allowEmpty: true });
    } else {
      // An app version from before quotations sends one new total.
      legacyTotal = Number(req.body.amount);
      if (!Number.isInteger(legacyTotal) || legacyTotal < 1 || legacyTotal > 10000000) {
        return res.status(400).json({ error: { message: 'Enter the new price in whole shillings', code: 'invalid_request' } });
      }
    }
    const data = await jobService.revisePrice(req.params.id, req.user.id, { items, legacyTotal, reason: reason.slice(0, 500) });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function answerPriceChange(req, res, next) {
  try {
    const data = await jobService.answerPriceChange(req.params.id, req.user.id, req.body.accept === true);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function materials(req, res, next) {
  try {
    const note = typeof req.body.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 300) : null;
    const data = req.body.done === true
      ? await jobService.clearMaterialsPause(req.params.id, req.user.id)
      : await jobService.setMaterialsPause(req.params.id, req.user.id, { note, expectedBack: req.body.expected_back || null });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

module.exports = { thread, declineQuote, revisePrice, answerPriceChange, materials, create, mine, feed, acceptOffer, declineOffer, myOffer, quote, acceptQuote, complete, cancel, release, review, cleanReason };
