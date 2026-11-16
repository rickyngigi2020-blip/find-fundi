const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/serviceRateController');

const router = express.Router();

router.get('/', requireAuth, controller.list);

module.exports = router;
