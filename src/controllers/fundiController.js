const fundiService = require('../services/fundiService');

const CATEGORIES = ['phone_electronics', 'computer_laptop', 'mechanical', 'appliance', 'electrical'];

async function apply(req, res, next) {
  try {
    const {
      category, national_id, highest_qualification, years_experience,
      id_document_url, certificate_url, bio,
    } = req.body;

    if (!category || !national_id || !highest_qualification || !years_experience || !id_document_url) {
      return res.status(400).json({
        error: { message: 'category, national_id, highest_qualification, years_experience, and id_document_url are required', code: 'invalid_request' },
      });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: { message: `category must be one of: ${CATEGORIES.join(', ')}`, code: 'invalid_request' } });
    }

    const application = await fundiService.applyAsFundi(req.accessToken, req.user.id, {
      category, national_id, highest_qualification, years_experience, id_document_url, certificate_url, bio,
    });
    res.json({ data: application });
  } catch (err) {
    next(err);
  }
}

async function status(req, res, next) {
  try {
    const data = await fundiService.getStatus(req.accessToken, req.user.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function search(req, res, next) {
  try {
    const { category, area } = req.query;
    const data = await fundiService.searchVerifiedFundis(req.accessToken, { category, area });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

module.exports = { apply, status, search };
