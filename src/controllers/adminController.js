const adminService = require('../services/adminService');

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

module.exports = { listFundiApplications, setVerificationStatus };
