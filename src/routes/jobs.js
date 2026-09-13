const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/jobsController');

const router = express.Router();

router.post('/', requireAuth, controller.create);
router.get('/mine', requireAuth, controller.mine);
router.get('/feed', requireAuth, controller.feed);
router.post('/:id/match', requireAuth, controller.match);
router.post('/:id/quote', requireAuth, controller.quote);
router.post('/:id/accept-quote', requireAuth, controller.acceptQuote);
router.post('/:id/complete', requireAuth, controller.complete);
router.post('/:id/review', requireAuth, controller.review);

module.exports = router;
