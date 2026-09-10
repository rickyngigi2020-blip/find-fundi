const jobService = require('../services/jobService');

async function create(req, res, next) {
  try {
    const { category, subcategory, description, photo_url, urgency, area } = req.body;
    if (!category || !description || !area) {
      return res.status(400).json({ error: { message: 'category, description, and area are required', code: 'invalid_request' } });
    }
    const job = await jobService.createJob(req.accessToken, req.user.id, {
      category, subcategory, description, photo_url, urgency, area,
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
