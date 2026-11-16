const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/fundiController');

const router = express.Router();

router.post('/apply', requireAuth, controller.apply);
router.get('/status', requireAuth, controller.status);
router.post('/availability', requireAuth, controller.setAvailability);
router.get('/dashboard', requireAuth, controller.dashboard);
router.get('/wallet', requireAuth, controller.wallet);
router.post('/commissions/pay-claim', requireAuth, controller.payClaim);

module.exports = router;
