require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// The routes connect to Supabase as soon as they load. Without the keys (for
// example a Vercel project with no environment variables yet) the API answers
// with a clear error instead of crashing every request, including page loads.
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);

const app = express();
const publicDir = path.join(__dirname, '..', 'public');

// Rate limiting needs each visitor's real IP. On Vercel that comes from the
// one proxy in front of the function; locally, requests through the phone
// tunnel come from cloudflared on this machine.
app.set('trust proxy', process.env.VERCEL ? 1 : 'loopback');

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());
app.use('/api/v1', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

if (missingEnv.length) {
  console.error(`Missing environment variables: ${missingEnv.join(', ')}`);
  app.use('/api/v1', (req, res) => {
    res.status(503).json({ error: { message: 'The server is missing its Supabase settings.', code: 'not_configured' } });
  });
} else {
  app.use('/api/v1/profile', require('./routes/profile'));
  app.use('/api/v1/fundi', require('./routes/fundi'));
  app.use('/api/v1/jobs', require('./routes/jobs'));
  app.use('/api/v1/admin', require('./routes/admin'));
}

// The site itself, for local use: a single https tunnel then serves pages and
// API from one origin. On Vercel, public/ is served by its CDN instead (Vercel
// ignores express.static). Only public/ is exposed; .env, source code and
// node_modules must never be served.
app.use('/assets', express.static(path.join(publicDir, 'assets'), { dotfiles: 'deny', index: false, fallthrough: false }));
app.get(/^\/(?:([a-z0-9-]+)\.html)?$/, (req, res, next) => {
  const file = path.join(publicDir, `${req.params[0] || 'index'}.html`);
  if (!fs.existsSync(file)) {
    // On Vercel the pages sit on the CDN, not inside this function, and Vercel
    // sends / here rather than to public/index.html.
    if (process.env.VERCEL && !req.params[0]) return res.redirect(302, '/index.html');
    return next();
  }
  res.set('Cache-Control', 'no-store');
  res.sendFile(file);
});

app.use((req, res) => {
  res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = status < 500 ? err.publicMessage || err.message : 'Something went wrong. Please try again.';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: { message, code: err.code || 'internal_error' } });
});

// Vercel imports the app and runs it as a function. Locally, `node src/server.js`
// starts a server bound to this computer only; the phone reaches it through
// the tunnel.
if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, '127.0.0.1', () => {
    console.log(`Find Fundi API listening on http://localhost:${port}`);
  });
}

module.exports = app;
