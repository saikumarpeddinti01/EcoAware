const express = require('express');
const ctrl = require('../controllers/manage.controller');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Everything here is management-only.
router.use(authenticate, authorize('management'));

router.get('/dashboard', ctrl.dashboard);
router.get('/monitor', ctrl.monitor);
router.get('/reports', ctrl.listReports);
router.post('/reports/:id/assign', ctrl.assignReport);
router.post('/reports/:id/review', ctrl.reviewResolution);
router.get('/reports/:id/history', ctrl.statusHistory);

module.exports = router;
