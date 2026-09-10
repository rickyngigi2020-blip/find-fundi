const profileService = require('../services/profileService');

async function upsertProfile(req, res, next) {
  try {
    const { full_name, phone, role, area, street } = req.body;
    if (!full_name || !phone || !role) {
      return res.status(400).json({ error: { message: 'full_name, phone, and role are required', code: 'invalid_request' } });
    }
    if (!['customer', 'fundi'].includes(role)) {
      return res.status(400).json({ error: { message: 'role must be customer or fundi', code: 'invalid_request' } });
    }
    const profile = await profileService.upsertProfile(req.accessToken, req.user.id, { full_name, phone, role, area, street });
    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const profile = await profileService.getOwnProfile(req.accessToken, req.user.id);
    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
}

module.exports = { upsertProfile, getMe };
