const crypto = require('crypto');
const { query } = require('../config/db');

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

const hashCode = (code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(String(code)).digest('hex');

const safeEqual = (a, b) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

// Creates (or replaces) the verification record for a user.
const createVerification = async (userId) => {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const reference = 'REF-' + crypto.randomBytes(3).toString('hex').toUpperCase();

  await query(
    `INSERT INTO email_verifications (user_id, reference, code_hash, attempts, expires_at, created_at)
     VALUES ($1, $2, $3, 0, NOW() + ($4 || ' minutes')::interval, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET reference = EXCLUDED.reference, code_hash = EXCLUDED.code_hash,
           attempts = 0, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
    [userId, reference, hashCode(code), String(CODE_TTL_MINUTES)]
  );

  return { code, reference };
};

module.exports = { createVerification, hashCode, safeEqual, MAX_ATTEMPTS, RESEND_COOLDOWN_SECONDS, CODE_TTL_MINUTES };
