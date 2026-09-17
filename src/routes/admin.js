const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const controller = require('../controllers/adminController');

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get('/fundi-applications', controller.listFundiApplications);
router.post('/fundi-applications/:id/status', controller.setVerificationStatus);
router.get('/users', controller.listUsers);
router.post('/users/:id/suspension', controller.setSuspension);
router.get('/jobs', controller.listJobs);
router.post('/jobs/:id/cancel', controller.cancelJob);

module.exports = router;
