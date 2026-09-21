const express = require('express');
const ctrl = require('../controllers/feedback.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { feedbackLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.use(authenticate);

router.post('/', feedbackLimiter, ctrl.submitFeedback); // any signed-in user; stored anonymously
router.get('/', authorize('management'), ctrl.listFeedback);

module.exports = router;
