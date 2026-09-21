const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const routes = require('./routes');
const storage = require('./utils/storage');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(
  cors(
    process.env.CLIENT_URL
      ? { origin: process.env.CLIENT_URL, credentials: true }
      : { origin: '*' } // no CLIENT_URL set (local dev) -> allow any origin, no credentials
  )
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ name: 'Eco Ware API', status: 'running' });
});

// Only used when STORAGE_DRIVER=local (offline dev). Supabase serves its own image URLs.
if (storage.driver() === 'local') {
  app.use(
    '/uploads',
    (req, res, next) => { res.set('Cross-Origin-Resource-Policy', 'cross-origin'); next(); }, // let the front end (other port) show images
    express.static(storage.LOCAL_DIR)
  );
}

// All API routes live under /api
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
