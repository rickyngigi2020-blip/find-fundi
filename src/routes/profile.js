const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/profileController');

const router = express.Router();

router.post('/', requireAuth, controller.upsertProfile);
router.get('/me', requireAuth, controller.getMe);

module.exports = router;
