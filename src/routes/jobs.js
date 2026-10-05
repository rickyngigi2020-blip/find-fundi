const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/jobsController');

const router = express.Router();

router.post('/', requireAuth, controller.create);
router.get('/mine', requireAuth, controller.mine);
router.get('/feed', requireAuth, controller.feed);
router.get('/my-offer', requireAuth, controller.myOffer);
router.get('/release-reasons', requireAuth, controller.releaseReasons);
router.post('/:id/offer/accept', requireAuth, controller.acceptOffer);
router.post('/:id/offer/decline', requireAuth, controller.declineOffer);
router.post('/:id/quote', requireAuth, controller.quote);
router.post('/:id/accept-quote', requireAuth, controller.acceptQuote);
router.post('/:id/complete', requireAuth, controller.complete);
router.post('/:id/cancel', requireAuth, controller.cancel);
router.post('/:id/release', requireAuth, controller.release);
router.post('/:id/review', requireAuth, controller.review);

module.exports = router;
