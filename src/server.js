require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const profileRoutes = require('./routes/profile');
const fundiRoutes = require('./routes/fundi');
const jobsRoutes = require('./routes/jobs');

const app = express();

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());
app.use('/api/v1', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/fundi', fundiRoutes);
app.use('/api/v1/jobs', jobsRoutes);

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

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Find Fundi API listening on http://localhost:${port}`);
});
