const serviceRateService = require('../services/serviceRateService');
const { CATEGORIES } = require('../utils/categories');

// With ?category= it is the menu a customer picks from while booking;
// without, the menu for the signed-in fundi's own trade.
async function list(req, res, next) {
  try {
    const { category } = req.query;
    if (category !== undefined) {
      if (!CATEGORIES.includes(category)) {
        return res.status(400).json({ error: { message: 'Unknown trade.', code: 'invalid_request' } });
      }
      return res.json({ data: await serviceRateService.listForCategory(category) });
    }
    const data = await serviceRateService.listForFundi(req.user.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
