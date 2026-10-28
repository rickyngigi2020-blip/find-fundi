const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/pushController');

const router = express.Router();

router.get('/public-key', controller.publicKey);
router.post('/subscriptions', requireAuth, controller.subscribe);
router.post('/test', requireAuth, controller.test);

module.exports = router;
