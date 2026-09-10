const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const controller = require('../controllers/adminController');

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get('/fundi-applications', controller.listFundiApplications);
router.post('/fundi-applications/:id/status', controller.setVerificationStatus);

module.exports = router;
