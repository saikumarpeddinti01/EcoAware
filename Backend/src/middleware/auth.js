const { verifyToken } = require('../utils/token');
const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Requires a valid "Authorization: Bearer <token>" header. Sets req.user.
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError('Authentication required', 401);

  let payload;
  try {
    payload = verifyToken(token);
  } catch (e) {
    throw new AppError('Invalid or expired token', 401);
  }

  // Re-check the DB so deleted users / changed roles take effect immediately.
  const { rows } = await query(
    'SELECT id, username, email, role, is_verified FROM users WHERE id = $1',
    [payload.id]
  );
  if (!rows.length) throw new AppError('User no longer exists', 401);

  req.user = rows[0];
  next();
});

// Usage: router.get('/x', authenticate, authorize('staff', 'management'), handler)
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(new AppError('Authentication required', 401));
  if (!roles.includes(req.user.role)) {
    return next(new AppError('You do not have permission to do this', 403));
  }
  next();
};

module.exports = { authenticate, authorize };
