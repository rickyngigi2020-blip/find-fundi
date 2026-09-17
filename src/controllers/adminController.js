const adminService = require('../services/adminService');
const { cleanReason } = require('./jobsController');

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

module.exports = { listFundiApplications, setVerificationStatus, listUsers, setSuspension, listJobs, cancelJob };
