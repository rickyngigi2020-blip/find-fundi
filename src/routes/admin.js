const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const controller = require('../controllers/adminController');

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get('/insights', controller.insights);
router.get('/fundi-applications', controller.listFundiApplications);
router.post('/fundi-applications/:id/status', controller.setVerificationStatus);
router.post('/fundi-applications/:id/rating', controller.setStartingRating);
router.post('/fundi-applications/:id/certify', controller.certifyFundi);
router.post('/fundi-applications/:id/uncertify', controller.uncertifyFundi);
router.get('/service-rates', controller.listServiceRates);
router.post('/service-rates', controller.createServiceRate);
router.post('/service-rates/:id', controller.updateServiceRate);
router.get('/commissions', controller.listCommissions);
router.post('/commissions/paid', controller.confirmCommissionPaid);
router.post('/commissions/:id/paid', controller.confirmCommissionPaid);
router.get('/users', controller.listUsers);
router.post('/users/:id/suspension', controller.setSuspension);
router.get('/admins', controller.listAdmins);
router.post('/admins', controller.grantAdmin);
router.post('/admins/:id/revoke', controller.revokeAdmin);
router.get('/jobs', controller.listJobs);
router.post('/jobs/:id/cancel', controller.cancelJob);

module.exports = router;
