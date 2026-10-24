const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/diagnosticsController');

const router = express.Router();

// Open to any origin, so a report can still be sent from a page on the local
// dev server or a tunnel. No cookies are used, and nothing here returns
// personal data.
router.use(cors({ origin: '*', allowedHeaders: ['Content-Type', 'Authorization', 'X-Pad'], maxAge: 600 }));

// Raw bytes rather than JSON: the echo must count exactly what arrived, and a
// connection check sends bodies that are deliberately not JSON.
const raw = express.raw({ type: () => true, limit: '256kb' });

// One connection check makes about ten echo calls.
router.all('/echo', rateLimit({ windowMs: 15 * 60 * 1000, max: 150 }), raw, controller.echo);

// Reports write to storage, so they get a much tighter limit than the API.
const reportLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 40 });
router.post('/reports', reportLimit, express.raw({ type: () => true, limit: '64kb' }), controller.create);
router.get('/reports', reportLimit, controller.createFromQuery);

module.exports = router;
