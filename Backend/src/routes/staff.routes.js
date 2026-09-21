const express = require('express');
const ctrl = require('../controllers/staff.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadPhotos } = require('../middleware/upload');

const router = express.Router();

// Reading is open to staff and management; changing things is staff-only.
router.use(authenticate, authorize('staff', 'management'));

router.get('/dashboard', ctrl.dashboard);
router.get('/reports/incoming', ctrl.listIncoming);
router.get('/reports/resolved', ctrl.listResolved);
router.get('/assignments', ctrl.listAssignments);
router.get('/team', ctrl.team);

router.post('/reports/:id/claim', authorize('staff'), ctrl.claimReport);
router.post('/reports/:id/start', authorize('staff'), ctrl.startWork);
router.post('/reports/:id/resolution', authorize('staff'), uploadPhotos, ctrl.submitResolution);

module.exports = router;
