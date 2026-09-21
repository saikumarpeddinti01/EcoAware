const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const v = require('../utils/validators');

/* POST /api/users        (management only)
   Staff and management accounts are created by an admin, never self-registered.
   body: { email, username, phone?, password, role: 'staff' | 'management' } */
exports.createUser = asyncHandler(async (req, res) => {
  const email = v.normalizeEmail(req.body.email);
  const username = String(req.body.username || '').trim();
  const phone = String(req.body.phone || '').trim();
  const { password, role } = req.body;

  // Optional: which department this staff member works in (see GET /api/departments)
  let departmentId = null;
  if (req.body.departmentId !== undefined && req.body.departmentId !== null && req.body.departmentId !== '') {
    departmentId = Number.parseInt(req.body.departmentId, 10);
    const dept = Number.isInteger(departmentId) && departmentId > 0
      ? await query('SELECT 1 FROM departments WHERE id = $1', [departmentId])
      : { rows: [] };
    if (!dept.rows.length) throw new AppError('Please fix the highlighted fields', 400, { errors: { departmentId: 'Department not found' } });
  }

  if (!['staff', 'management'].includes(role)) throw new AppError("Role must be 'staff' or 'management'", 400);

  const errors = v.collect({
    email: v.checkEmail(email),
    username: v.checkUsername(username),
    phone: v.checkPhone(phone),
    password: v.checkPassword(password),
  });
  if (errors) throw new AppError('Please fix the highlighted fields', 400, { errors });

  const dup = await query('SELECT 1 FROM users WHERE email = $1 OR LOWER(username) = LOWER($2)', [email, username]);
  if (dup.rows.length) throw new AppError('Email or username already in use', 409);

  const hash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (username, email, phone, password_hash, role, is_verified, department_id)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6)
     RETURNING id, username, email, phone, role, department_id, created_at`,
    [username, email, phone || null, hash, role, departmentId]
  );
  res.status(201).json({ success: true, message: `${role} account created`, user: rows[0] });
});

/* GET /api/users?role=staff        (management only) */
exports.listUsers = asyncHandler(async (req, res) => {
  const { role } = req.query;
  const params = [];
  let where = '';
  if (role) {
    if (!['reporter', 'staff', 'management'].includes(role)) throw new AppError('Invalid role filter', 400);
    params.push(role);
    where = 'WHERE u.role = $1';
  }
  const { rows } = await query(
    `SELECT u.id, u.username, u.email, u.phone, u.role, u.is_verified, u.created_at,
            u.department_id, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       ${where}
      ORDER BY u.created_at DESC`,
    params
  );
  res.json({ success: true, count: rows.length, users: rows });
});
