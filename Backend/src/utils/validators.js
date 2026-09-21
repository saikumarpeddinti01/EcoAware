const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const PHONE_RE = /^\+?[0-9\s\-()]{7,20}$/;

const normalizeEmail = (v) => String(v || '').trim().toLowerCase();

// Each function returns an error message string, or null if valid.
const checkEmail = (v) => (EMAIL_RE.test(v) ? null : 'Please enter a valid email address');

const checkUsername = (v) =>
  USERNAME_RE.test(v) ? null : 'Username must be 3-30 characters: letters, numbers, underscore';

const checkPhone = (v) => (!v || PHONE_RE.test(v) ? null : 'Please enter a valid phone number');

const checkPassword = (v) => {
  if (typeof v !== 'string' || v.length < 8) return 'Password must be at least 8 characters';
  if (v.length > 72) return 'Password must be at most 72 characters';
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return 'Password must contain letters and numbers';
  return null;
};

// Collects errors into { field: message }
const collect = (checks) => {
  const errors = {};
  for (const [field, msg] of Object.entries(checks)) if (msg) errors[field] = msg;
  return Object.keys(errors).length ? errors : null;
};

module.exports = { normalizeEmail, checkEmail, checkUsername, checkPhone, checkPassword, collect };
