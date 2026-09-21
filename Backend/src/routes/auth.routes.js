const express = require('express');
const ctrl = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/signup', authLimiter, ctrl.signup);
router.post('/verify-email', authLimiter, ctrl.verifyEmail);
router.post('/resend-code', authLimiter, ctrl.resendCode);
router.post('/login', authLimiter, ctrl.login);

router.get('/me', authenticate, ctrl.me);
router.post('/change-password', authenticate, ctrl.changePassword);

module.exports = router;
