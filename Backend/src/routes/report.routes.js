const express = require('express');
const ctrl = require('../controllers/report.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadPhotos } = require('../middleware/upload');
const { reportLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize('reporter', 'staff', 'management'), reportLimiter, uploadPhotos, ctrl.createReport); // staff/management can file a report too
router.get('/mine', ctrl.listMyReports);   // must stay above /:id
router.get('/:id', ctrl.getReport);
router.patch('/:id', authorize('reporter'), ctrl.updateReport);
router.delete('/:id', authorize('reporter'), ctrl.deleteReport);

module.exports = router;
