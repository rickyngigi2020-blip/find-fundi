const jobService = require('../services/jobService');

async function create(req, res, next) {
  try {
    const { category, subcategory, urgency, area, customer_lat, customer_lng } = req.body;
    const description = typeof req.body.description === 'string' && req.body.description.trim() ? req.body.description.trim() : null;
    const voice_note_path = typeof req.body.voice_note_path === 'string' && req.body.voice_note_path ? req.body.voice_note_path : null;
    const photo_paths = Array.isArray(req.body.photo_paths) ? req.body.photo_paths.filter((p) => typeof p === 'string' && p) : [];

    if (!category || !area) {
      return res.status(400).json({ error: { message: 'category and area are required', code: 'invalid_request' } });
    }
    if (!description && !voice_note_path) {
      return res.status(400).json({ error: { message: 'Describe the problem in writing or record a voice note', code: 'invalid_request' } });
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

    const job = await jobService.createJob(req.accessToken, req.user.id, {
      category, subcategory, description, urgency, area, voice_note_path, photo_paths,
      customer_lat: customer_lat ?? null, customer_lng: customer_lng ?? null,
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

async function match(req, res, next) {
  try {
    const { fundi_id } = req.body;
    if (!fundi_id) {
      return res.status(400).json({ error: { message: 'fundi_id is required', code: 'invalid_request' } });
    }
    const job = await jobService.matchFundi(req.accessToken, req.params.id, req.user.id, fundi_id);
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

async function confirm(req, res, next) {
  try {
    const { payment_method, estimated_cost_min, estimated_cost_max } = req.body;
    if (!payment_method || !['mpesa', 'card', 'cash'].includes(payment_method)) {
      return res.status(400).json({ error: { message: 'payment_method must be mpesa, card, or cash', code: 'invalid_request' } });
    }
    const job = await jobService.confirmBooking(req.accessToken, req.params.id, req.user.id, {
      payment_method, estimated_cost_min, estimated_cost_max,
    });
    res.json({ data: job });
  } catch (err) {
    next(err);
  }
}

async function complete(req, res, next) {
  try {
    const { final_cost } = req.body;
    const job = await jobService.completeJob(req.accessToken, req.params.id, req.user.id, { final_cost });
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

module.exports = { create, mine, feed, match, confirm, complete, review };
