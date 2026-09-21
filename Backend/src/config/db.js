const { Pool, types } = require('pg');

// Return DATE columns (e.g. due_date) as plain "YYYY-MM-DD" strings. By default pg turns them into
// JavaScript Dates in the server's timezone, which can shift the day by one when sent as JSON.
types.setTypeParser(1082, (value) => value);

const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);

// Pool connects lazily, so the server can start even before the DB is configured.
const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false }, // Supabase needs SSL
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err.message);
});

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
