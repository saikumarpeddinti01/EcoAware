const rateLimit = require('express-rate-limit');

// Slows down password guessing / code spamming.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in a few minutes.' },
});

// Stops someone flooding storage with uploads.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many reports submitted. Please try again later.' },
});

// Feedback is anonymous, so limit by IP/account rate to stop spam.
const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too much feedback submitted. Please try again later.' },
});

module.exports = { authLimiter, reportLimiter, feedbackLimiter };
