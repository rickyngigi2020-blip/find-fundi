const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/fundiController');

const router = express.Router();

router.post('/apply', requireAuth, controller.apply);
router.get('/status', requireAuth, controller.status);
router.get('/search', requireAuth, controller.search);
router.post('/availability', requireAuth, controller.setAvailability);
router.get('/dashboard', requireAuth, controller.dashboard);

module.exports = router;
