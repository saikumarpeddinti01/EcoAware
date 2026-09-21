// Creates the first management account. Run once:  npm run seed:admin
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');
const v = require('../src/utils/validators');

(async () => {
  const email = v.normalizeEmail(process.env.SEED_ADMIN_EMAIL);
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD;

  const problem = v.checkEmail(email) || v.checkUsername(username) || v.checkPassword(password);
  if (problem) {
    console.error('Seed failed:', problem, '(check SEED_ADMIN_* in .env)');
    process.exit(1);
  }

  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows.length) {
    console.log('Management account already exists:', email);
  } else {
    await pool.query(
      `INSERT INTO users (username, email, password_hash, role, is_verified) VALUES ($1, $2, $3, 'management', TRUE)`,
      [username, email, await bcrypt.hash(password, 12)]
    );
    console.log('Management account created:', email);
  }
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
