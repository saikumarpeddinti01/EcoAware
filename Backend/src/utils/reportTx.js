const { pool } = require('../config/db');
const AppError = require('./AppError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^#?EA-\d{4}-\d{3,}$/i;

// A report can be addressed by its UUID or by its code (EA-2026-0001 / #EA-2026-0001).
const parseKey = (idOrCode) => {
  const key = String(idOrCode || '').trim();
  if (UUID_RE.test(key)) return { where: 'r.id = $1', param: key };
  if (CODE_RE.test(key)) return { where: 'UPPER(r.report_code) = UPPER($1)', param: key.replace(/^#/, '') };
  throw new AppError('Report not found', 404);
};

// Plain read of one report row.
const findReport = async (idOrCode) => {
  const { where, param } = parseKey(idOrCode);
  const { rows } = await pool.query(`SELECT r.* FROM reports r WHERE ${where}`, [param]);
  if (!rows.length) throw new AppError('Report not found', 404);
  return rows[0];
};

// Runs fn(db, reportRow) inside a transaction while the report row is LOCKED.
// Two people acting on the same report at the same moment (e.g. two staff claiming it)
// are handled one after the other, so the second one sees the updated state and gets a 409.
const withReportLock = async (idOrCode, fn) => {
  const { where, param } = parseKey(idOrCode);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(`SELECT r.* FROM reports r WHERE ${where} FOR UPDATE`, [param]);
    if (!rows.length) throw new AppError('Report not found', 404);
    const result = await fn(db, rows[0]);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await db.query('ROLLBACK');
    } catch (_) {
      /* connection already broken; nothing more to do */
    }
    throw e;
  } finally {
    db.release();
  }
};

// One row in the timeline / audit trail. clock_timestamp() keeps rows written in the same
// transaction in the right order.
const addHistory = (db, reportId, step, note, userId) =>
  db.query(
    `INSERT INTO report_status_history (report_id, step, note, changed_by, created_at)
     VALUES ($1, $2, $3, $4, clock_timestamp())`,
    [reportId, step, note || null, userId || null]
  );

const hasStep = async (db, reportId, step) => {
  const { rows } = await db.query('SELECT 1 FROM report_status_history WHERE report_id = $1 AND step = $2 LIMIT 1', [reportId, step]);
  return rows.length > 0;
};

module.exports = { UUID_RE, CODE_RE, parseKey, findReport, withReportLock, addHistory, hasStep };
