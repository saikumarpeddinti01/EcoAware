const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

// Is the server alive?
router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Is the database reachable?
router.get('/health/db', async (req, res, next) => {
  try {
    const result = await query('SELECT NOW() AS now');
    res.json({ status: 'ok', database: 'connected', time: result.rows[0].now });
  } catch (err) {
    next(err);
  }
});

router.use('/auth', require('./auth.routes'));   // Stage 2
router.use('/users', require('./user.routes'));  // Stage 2 (management creates staff)

router.use('/reports', require('./report.routes')); // Stage 3
router.use('/staff', require('./staff.routes'));             // Stage 4 (staff portal)
router.use('/manage', require('./manage.routes'));           // Stage 4 (management portal)
router.use('/departments', require('./department.routes'));  // Stage 4 (dropdown list)
router.use('/feedback', require('./feedback.routes'));       // Stage 5 (anonymous feedback)
// Stage 5 -> router.use('/analytics', require('./analytics.routes'));

module.exports = router;
