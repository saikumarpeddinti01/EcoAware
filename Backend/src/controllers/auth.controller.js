const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken } = require('../utils/token');
const v = require('../utils/validators');
const { createVerification, hashCode, safeEqual, MAX_ATTEMPTS, RESEND_COOLDOWN_SECONDS } = require('../utils/verification');
const { sendVerificationEmail, smtpConfigured } = require('../utils/mailer');

const BCRYPT_ROUNDS = 12;
const requireVerification = () => String(process.env.REQUIRE_EMAIL_VERIFICATION).toLowerCase() !== 'false';

// A real bcrypt hash of a random string, used so login takes the same time
// whether or not the email exists (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  phone: u.phone || null,
  role: u.role,
  isVerified: u.is_verified,
});

// In development without SMTP we also return the code so you can test without email.
const devExtras = ({ code }) =>
  process.env.NODE_ENV === 'development' && !smtpConfigured() ? { devCode: code } : {};

/* ---------------------------------------------------------------
   POST /api/auth/signup      (reporters only)
   body: { email, username, phone?, password }
---------------------------------------------------------------- */
exports.signup = asyncHandler(async (req, res) => {
  const email = v.normalizeEmail(req.body.email);
  const username = String(req.body.username || '').trim();
  const phone = String(req.body.phone || '').trim();
  const { password } = req.body;

  const errors = v.collect({
    email: v.checkEmail(email),
    username: v.checkUsername(username),
    phone: v.checkPhone(phone),
    password: v.checkPassword(password),
  });
  if (errors) throw new AppError('Please fix the highlighted fields', 400, { errors });

  const existing = await query('SELECT email, username FROM users WHERE email = $1 OR LOWER(username) = LOWER($2)', [
    email,
    username,
  ]);
  if (existing.rows.length) {
    const emailTaken = existing.rows.some((r) => r.email === email);
    throw new AppError(emailTaken ? 'An account with this email already exists' : 'This username is taken', 409, {
      errors: emailTaken ? { email: 'Email already registered' } : { username: 'Username already taken' },
    });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const needsVerification = requireVerification();

  const { rows } = await query(
    `INSERT INTO users (username, email, phone, password_hash, role, is_verified)
     VALUES ($1, $2, $3, $4, 'reporter', $5)
     RETURNING id, username, email, phone, role, is_verified`,
    [username, email, phone || null, passwordHash, !needsVerification]
  );
  const user = rows[0];

  if (!needsVerification) {
    return res.status(201).json({
      success: true,
      message: 'Account created',
      token: signToken(user),
      user: publicUser(user),
    });
  }

  const verification = await createVerification(user.id);
  try {
    await sendVerificationEmail({ to: email, username, ...verification });
  } catch (e) {
    // Account + code are already saved; a flaky mail provider shouldn't turn this into a 500.
    // The user can use "Resend code" once the issue clears.
    console.error('Failed to send verification email:', e.message);
  }

  res.status(201).json({
    success: true,
    message: 'Account created. Enter the 6-digit code sent to your email.',
    requiresVerification: true,
    email,
    reference: verification.reference,
    ...devExtras(verification),
  });
});

/* ---------------------------------------------------------------
   POST /api/auth/verify-email
   body: { email, code }
---------------------------------------------------------------- */
exports.verifyEmail = asyncHandler(async (req, res) => {
  const email = v.normalizeEmail(req.body.email);
  const code = String(req.body.code || '').trim();
  if (!/^\d{6}$/.test(code)) throw new AppError('Enter the 6-digit code', 400);

  const { rows } = await query(
    `SELECT u.id, u.username, u.email, u.phone, u.role, u.is_verified,
            ev.code_hash, ev.attempts, ev.expires_at
       FROM users u
       LEFT JOIN email_verifications ev ON ev.user_id = u.id
      WHERE u.email = $1`,
    [email]
  );
  const row = rows[0];
  if (!row) throw new AppError('Invalid code', 400);

  if (row.is_verified) throw new AppError('This account is already verified. Please log in.', 400);
  if (!row.code_hash) throw new AppError('No active code. Please request a new one.', 400);
  if (new Date(row.expires_at) < new Date()) throw new AppError('Code expired. Please request a new one.', 400);
  if (row.attempts >= MAX_ATTEMPTS) throw new AppError('Too many wrong attempts. Please request a new code.', 429);

  if (!safeEqual(hashCode(code), row.code_hash)) {
    await query('UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = $1', [row.id]);
    throw new AppError('Invalid code', 400);
  }

  await query('UPDATE users SET is_verified = TRUE WHERE id = $1', [row.id]);
  await query('DELETE FROM email_verifications WHERE user_id = $1', [row.id]);

  const user = { ...row, is_verified: true };
  res.json({ success: true, message: 'Email verified', token: signToken(user), user: publicUser(user) });
});

/* ---------------------------------------------------------------
   POST /api/auth/resend-code
   body: { email }
---------------------------------------------------------------- */
exports.resendCode = asyncHandler(async (req, res) => {
  const email = v.normalizeEmail(req.body.email);
  const generic = { success: true, message: 'If that account needs verification, a new code has been sent.' };

  const { rows } = await query(
    `SELECT u.id, u.username, u.is_verified, ev.created_at
       FROM users u LEFT JOIN email_verifications ev ON ev.user_id = u.id
      WHERE u.email = $1`,
    [email]
  );
  const row = rows[0];
  if (!row || row.is_verified) return res.json(generic); // don't reveal which emails exist

  if (row.created_at) {
    const secondsAgo = (Date.now() - new Date(row.created_at).getTime()) / 1000;
    if (secondsAgo < RESEND_COOLDOWN_SECONDS) {
      throw new AppError(`Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsAgo)}s before requesting another code`, 429);
    }
  }

  const verification = await createVerification(row.id);
  try {
    await sendVerificationEmail({ to: email, username: row.username, ...verification });
  } catch (e) {
    console.error('Failed to send verification email:', e.message);
  }
  res.json({ ...generic, reference: verification.reference, ...devExtras(verification) });
});

/* ---------------------------------------------------------------
   POST /api/auth/login
   body: { email | identifier, password, portal? }
     identifier = email or username (staff login says "Staff ID / Email")
     portal     = 'reporter' | 'staff' | 'management'  (which login page was used)
---------------------------------------------------------------- */
exports.login = asyncHandler(async (req, res) => {
  const identifier = String(req.body.identifier || req.body.email || '').trim();
  const { password, portal } = req.body;
  if (!identifier || !password) throw new AppError('Email and password are required', 400);
  if (portal && !['reporter', 'staff', 'management'].includes(portal)) throw new AppError('Invalid portal', 400);

  const { rows } = await query(
    `SELECT id, username, email, phone, password_hash, role, is_verified
       FROM users WHERE email = $1 OR LOWER(username) = LOWER($2)`,
    [identifier.toLowerCase(), identifier]
  );
  const user = rows[0];

  const ok = await bcrypt.compare(String(password), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new AppError('Invalid email or password', 401);

  // Password is correct from here on.
  if (portal && portal !== user.role) {
    throw new AppError(`This account cannot sign in through the ${portal} portal`, 403);
  }
  if (!user.is_verified) {
    throw new AppError('Please verify your email before logging in', 403, {
      requiresVerification: true,
      email: user.email,
    });
  }

  res.json({ success: true, message: 'Login successful', token: signToken(user), user: publicUser(user) });
});

/* ---------------------------------------------------------------
   GET /api/auth/me      (needs token)
---------------------------------------------------------------- */
exports.me = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT id, username, email, phone, role, is_verified, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json({ success: true, user: { ...publicUser(rows[0]), createdAt: rows[0].created_at } });
});

/* ---------------------------------------------------------------
   POST /api/auth/change-password      (needs token)
   body: { currentPassword, newPassword }
---------------------------------------------------------------- */
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const err = v.checkPassword(newPassword);
  if (err) throw new AppError(err, 400, { errors: { newPassword: err } });

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const ok = await bcrypt.compare(String(currentPassword || ''), rows[0].password_hash);
  if (!ok) throw new AppError('Current password is incorrect', 401);

  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(newPassword, BCRYPT_ROUNDS), req.user.id]);
  res.json({ success: true, message: 'Password updated' });
});
