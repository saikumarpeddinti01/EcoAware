const { query } = require('../config/db');
const AppError = require('./AppError');
const W = require('./workflow');

/* ---------------- paging ---------------- */

const parsePaging = (q, defLimit = 20, maxLimit = 50) => {
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || defLimit, 1), maxLimit);
  return { page, limit, offset: (page - 1) * limit };
};

const pagingOut = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  totalPages: Math.max(Math.ceil(total / limit), 1),
});

/* ---------------- WHERE builder ----------------
   f.add('r.category = ?', value)   -> adds "r.category = $1" and remembers the value
   f.raw("r.workflow_state = 'new'") -> adds a condition with no value
   Values always travel as parameters, never pasted into the SQL. */

const makeFilters = () => {
  const conds = [];
  const params = [];
  return {
    add(cond, value) {
      params.push(value);
      conds.push(cond.split('?').join(`$${params.length}`));
    },
    raw(cond) {
      conds.push(cond);
    },
    get where() {
      return conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    },
    params,
  };
};

const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// Filters shared by every list: category, priority, search text, reported-date range.
const applyCommonFilters = (f, q) => {
  if (q.category) {
    const c = W.normCategory(q.category);
    if (!c) throw new AppError(`Invalid category. Use one of: ${W.CATEGORIES.join(', ')}`, 400);
    f.add('r.category = ?', c);
  }
  if (q.priority) {
    const p = W.normPriority(q.priority);
    if (!p) throw new AppError(`Invalid priority. Use one of: ${W.PRIORITIES.join(', ')}`, 400);
    f.add('r.priority = ?', p);
  }
  if (q.search && String(q.search).trim()) {
    const like = `%${escapeLike(String(q.search).trim().slice(0, 100))}%`;
    f.add('(r.title ILIKE ? OR r.report_code ILIKE ? OR r.location_text ILIKE ? OR r.description ILIKE ?)', like);
  }
  if (q.from) f.add('r.created_at >= ?::date', W.parseFilterDate(q.from, 'from'));
  if (q.to) f.add('r.created_at < (?::date + 1)', W.parseFilterDate(q.to, 'to'));
};

/* ---------------- the list query ---------------- */

const FROM_JOINS = `
  FROM reports r
  JOIN users u ON u.id = r.reporter_id
  LEFT JOIN users a ON a.id = r.assigned_to
  LEFT JOIN departments d ON d.id = r.department_id`;

const LIST_SELECT = `
  SELECT r.id, r.report_code, r.title, r.category, r.description, r.location_text, r.latitude, r.longitude,
         r.status, r.workflow_state, r.priority, r.due_date,
         r.department_id, d.name AS department_name,
         r.assigned_to, a.username AS assigned_username,
         r.reporter_id, u.username AS reporter_username, u.role AS reporter_role,
         r.created_at, r.assigned_at, r.started_at, r.resolution_submitted_at, r.resolved_at,
         r.resolved_by, r.action_taken,
         (r.due_date IS NOT NULL AND r.due_date < CURRENT_DATE AND r.workflow_state IN ('assigned', 'in_progress')) AS is_overdue,
         ROUND(EXTRACT(EPOCH FROM (r.resolution_submitted_at - r.assigned_at)) / 60)::int AS duration_minutes,
         (SELECT url FROM report_photos p WHERE p.report_id = r.id AND p.type = 'reported'
           ORDER BY p.created_at, p.id LIMIT 1) AS thumbnail
  ${FROM_JOINS}`;

// Sort fragments (fixed strings, never built from user input)
const PRIORITY_ORDER = "CASE r.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END";

const shapeRow = (r) => ({
  id: r.id,
  reportCode: r.report_code,
  title: r.title,
  category: r.category,
  description: r.description,
  location: r.location_text || null,
  latitude: r.latitude,
  longitude: r.longitude,
  status: r.status, // what the reporter sees
  workflowState: r.workflow_state, // what staff/management work with
  stateLabel: W.STATE_LABELS[r.workflow_state],
  priority: r.priority,
  dueDate: r.due_date, // "YYYY-MM-DD" or null
  isOverdue: Boolean(r.is_overdue),
  department: r.department_id ? { id: r.department_id, name: r.department_name } : null,
  assignedTo: r.assigned_to ? { id: r.assigned_to, username: r.assigned_username } : null,
  reportedBy: { id: r.reporter_id, username: r.reporter_username, role: r.reporter_role },
  thumbnail: r.thumbnail || null,
  createdAt: r.created_at,
  assignedAt: r.assigned_at,
  startedAt: r.started_at,
  submittedAt: r.resolution_submitted_at,
  resolvedAt: r.resolved_at,
  resolvedBy: r.workflow_state === 'resolved' ? r.resolved_by : null,
  resolutionNote: r.workflow_state === 'resolved' ? r.action_taken : null,
  durationMinutes: r.duration_minutes === null || r.duration_minutes === undefined ? null : r.duration_minutes,
});

// Runs the count + the page and returns { reports, pagination }.
const runList = async ({ filters, paging, orderBy }) => {
  const total = (await query(`SELECT COUNT(*)::int AS n ${FROM_JOINS} ${filters.where}`, filters.params)).rows[0].n;
  const { rows } = await query(
    `${LIST_SELECT} ${filters.where} ORDER BY ${orderBy} LIMIT ${paging.limit} OFFSET ${paging.offset}`,
    filters.params
  );
  return { reports: rows.map(shapeRow), pagination: pagingOut(paging, total) };
};

const percent = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

module.exports = {
  parsePaging,
  pagingOut,
  makeFilters,
  applyCommonFilters,
  FROM_JOINS,
  LIST_SELECT,
  PRIORITY_ORDER,
  shapeRow,
  runList,
  percent,
};
