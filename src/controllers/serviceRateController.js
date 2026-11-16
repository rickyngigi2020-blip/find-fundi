const serviceRateService = require('../services/serviceRateService');

async function list(req, res, next) {
  try {
    const data = await serviceRateService.listForFundi(req.user.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
