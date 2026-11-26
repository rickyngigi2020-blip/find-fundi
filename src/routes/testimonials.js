const express = require('express');
const testimonials = require('../services/testimonialService');

// Public: the home page reads published testimonials without signing in.
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ data: await testimonials.listPublished() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
