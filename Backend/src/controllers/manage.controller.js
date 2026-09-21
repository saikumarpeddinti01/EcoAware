const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const W = require('../utils/workflow');
const L = require('../utils/listing');
const { UUID_RE, findReport, withReportLock, addHistory, hasStep } = require('../utils/reportTx');
const { loadDetail } = require('./report.controller');

/* ------------------------------------------------------------------ */
/* GET /api/departments                       (staff, management)      */
/* For the "Select department" dropdown.                               */
/* ------------------------------------------------------------------ */
exports.listDepartments = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, name FROM departments ORDER BY name');
  res.json({ success: true, departments: rows });
});

/* ------------------------------------------------------------------ */
/* GET /api/manage/dashboard                  (management)             */
/* ------------------------------------------------------------------ */
exports.dashboard = asyncHandler(async (req, res) => {
  const [counts, median, cats, recent] = await Promise.all([
    query(`
      SELECT COUNT(*) FILTER (WHERE workflow_state <> 'resolved')::int                                        AS open_reports,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int                             AS new_this_week,
             COUNT(*) FILTER (WHERE workflow_state = 'assigned')::int                                         AS assigned,
             COUNT(*) FILTER (WHERE workflow_state IN ('assigned', 'in_progress') AND due_date = CURRENT_DATE)::int AS due_today,
             COUNT(*) FILTER (WHERE workflow_state IN ('in_progress', 'pending_review'))::int                 AS in_progress,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int                            AS created_30,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days' AND workflow_state = 'resolved')::int AS resolved_30
        FROM reports`),
    query(`
      SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400))::float8 AS median_days
        FROM reports
       WHERE workflow_state = 'resolved' AND resolved_at >= NOW() - INTERVAL '30 days'`),
    query('SELECT category, COUNT(*)::int AS n FROM reports GROUP BY category'),
    query(`${L.LIST_SELECT} ORDER BY r.created_at DESC LIMIT 5`),
  ]);

  const c = counts.rows[0];
  const total = cats.rows.reduce((sum, r) => sum + r.n, 0);
  const byCategory = W.CATEGORIES.map((name) => {
    const n = (cats.rows.find((r) => r.category === name) || { n: 0 }).n;
    return { category: name, count: n, percent: total ? Math.round((n / total) * 100) : 0 };
  }).sort((x, y) => y.count - x.count);

  const medianDays = median.rows[0].median_days;

  res.json({
    success: true,
    stats: {
      openReports: c.open_reports,
      newThisWeek: c.new_this_week,
      assigned: c.assigned,
      dueToday: c.due_today,
      inProgress: c.in_progress,
      resolutionRate: c.created_30 ? Math.round((c.resolved_30 / c.created_30) * 100) : 0, // last 30 days
      medianResolutionDays: medianDays === null ? null : Math.round(medianDays * 10) / 10,
    },
    byCategory,
    recent: recent.rows.map(L.shapeRow),
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/manage/reports                    (management)             */
/*   ?status=new|assigned|in_progress|pending_review|resolved|all      */
/*   &category=&priority=&departmentId=&overdue=true&search=&from=&to= */
/*   &page=&limit=                                                     */
/* "All reports", the review queue (status=pending_review) and the     */
/* monitoring table are all this same list with different filters.     */
/* ------------------------------------------------------------------ */
exports.listReports = asyncHandler(async (req, res) => {
  const state = W.normState(req.query.status);
  const f = L.makeFilters();
  if (state) f.add('r.workflow_state = ?', state);
  if (req.query.departmentId) {
    const id = parseInt(req.query.departmentId, 10);
    if (!Number.isInteger(id) || id < 1) throw new AppError('Invalid departmentId', 400);
    f.add('r.department_id = ?', id);
  }
  if (req.query.assignedTo) {
    if (!UUID_RE.test(String(req.query.assignedTo))) throw new AppError('Invalid assignedTo', 400);
    f.add('r.assigned_to = ?', String(req.query.assignedTo));
  }
  if (String(req.query.overdue).toLowerCase() === 'true') {
    f.raw("r.due_date < CURRENT_DATE AND r.workflow_state IN ('assigned', 'in_progress')");
  }
  L.applyCommonFilters(f, req.query);

  const paging = L.parsePaging(req.query);
  const [list, stateCounts] = await Promise.all([
    L.runList({ filters: f, paging, orderBy: 'r.created_at DESC, r.id' }),
    query('SELECT workflow_state, COUNT(*)::int AS n FROM reports GROUP BY workflow_state'),
  ]);

  // Tab badges (unfiltered)
  const counts = { all: 0 };
  W.STATES.forEach((s) => { counts[s] = 0; });
  stateCounts.rows.forEach((r) => {
    counts[r.workflow_state] = r.n;
    counts.all += r.n;
  });

  res.json({ success: true, ...list, counts });
});

/* ------------------------------------------------------------------ */
/* POST /api/manage/reports/:id/assign        (management)             */
/*   body: { departmentId, dueDate: "YYYY-MM-DD", priority?, staffId?, note? } */
/* Works while the report is New or Assigned (not yet started).        */
/* ------------------------------------------------------------------ */
exports.assignReport = asyncHandler(async (req, res) => {
  const errors = {};

  const departmentId = Number.parseInt(req.body.departmentId, 10);
  if (!Number.isInteger(departmentId) || departmentId < 1) errors.departmentId = 'Please select a department';

  let dueDate = null;
  try {
    dueDate = W.parseDueDate(req.body.dueDate);
  } catch (e) {
    Object.assign(errors, e.extra && e.extra.errors ? e.extra.errors : { dueDate: e.message });
  }

  let priority = null;
  if (req.body.priority !== undefined && req.body.priority !== null && req.body.priority !== '') {
    priority = W.normPriority(req.body.priority);
    if (!priority) errors.priority = `Priority must be one of: ${W.PRIORITIES.join(', ')}`;
  }

  const staffId = req.body.staffId ? String(req.body.staffId).trim() : null;
  if (staffId && !UUID_RE.test(staffId)) errors.staffId = 'Invalid staff id';

  const note = String(req.body.note || '').trim();
  if (note.length > 500) errors.note = 'Note must be 500 characters or less';

  if (Object.keys(errors).length) throw new AppError('Please fix the highlighted fields', 400, { errors });

  const dept = (await query('SELECT id, name FROM departments WHERE id = $1', [departmentId])).rows[0];
  if (!dept) throw new AppError('Please fix the highlighted fields', 400, { errors: { departmentId: 'Department not found' } });

  let staff = null;
  if (staffId) {
    staff = (await query("SELECT id, username, department_id FROM users WHERE id = $1 AND role = 'staff'", [staffId])).rows[0];
    if (!staff) throw new AppError('Please fix the highlighted fields', 400, { errors: { staffId: 'Staff member not found' } });
    if (staff.department_id && staff.department_id !== dept.id) {
      throw new AppError('Please fix the highlighted fields', 400, { errors: { staffId: 'That staff member belongs to a different department' } });
    }
  }

  const reportId = await withReportLock(req.params.id, async (db, r) => {
    const to = W.nextState('assign', r.workflow_state);
    const wasNew = r.workflow_state === 'new';

    await db.query(
      `UPDATE reports
          SET department_id = $1, assigned_to = $2, priority = $3, due_date = $4, assigned_at = NOW(),
              workflow_state = $5, status = $6, updated_at = NOW()
        WHERE id = $7`,
      [dept.id, staff ? staff.id : null, priority || r.priority, dueDate, to, W.statusFor(to), r.id]
    );

    const summary = `Assigned to ${dept.name}${staff ? ` (${staff.username})` : ''}`;
    if (wasNew) {
      if (!(await hasStep(db, r.id, 'Under Review'))) {
        await addHistory(db, r.id, 'Under Review', 'Report reviewed by management', req.user.id);
      }
      // The reporter sees only the team. Staff names and internal notes go to a staff-only row.
      await addHistory(db, r.id, 'Team Assigned', `Assigned to ${dept.name}`, req.user.id);
      if (staff || note) await addHistory(db, r.id, 'Assignment Details', note ? `${summary}. ${note}` : summary, req.user.id);
    } else {
      // "Reassigned" is not one of the reporter's 5 steps, so it only shows in the audit trail.
      await addHistory(db, r.id, 'Reassigned', note ? `${summary}. ${note}` : summary, req.user.id);
    }
    return r.id;
  });

  res.json({ success: true, message: 'Report assigned', report: await loadDetail(reportId, req.user) });
});

/* ------------------------------------------------------------------ */
/* POST /api/manage/reports/:id/review        (management)             */
/*   body: { decision: "approve" | "request_info", note? }             */
/* note is required when asking for more information.                  */
/* ------------------------------------------------------------------ */
exports.reviewResolution = asyncHandler(async (req, res) => {
  const decision = String(req.body.decision || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!['approve', 'request_info'].includes(decision)) {
    throw new AppError('Please fix the highlighted fields', 400, { errors: { decision: 'Decision must be "approve" or "request_info"' } });
  }
  const note = String(req.body.note || '').trim();
  if (note.length > 500) throw new AppError('Please fix the highlighted fields', 400, { errors: { note: 'Note must be 500 characters or less' } });
  if (decision === 'request_info' && note.length < 5) {
    throw new AppError('Please fix the highlighted fields', 400, { errors: { note: 'Tell the team what information is missing (at least 5 characters)' } });
  }

  const reportId = await withReportLock(req.params.id, async (db, r) => {
    if (decision === 'approve') {
      const to = W.nextState('approve', r.workflow_state);
      await db.query(
        `UPDATE reports
            SET workflow_state = $1, status = $2, resolved_at = NOW(), review_note = $3,
                resolved_by = COALESCE(resolved_by, $4), updated_at = NOW()
          WHERE id = $5`,
        [to, W.statusFor(to), note || null, 'Campus Facilities', r.id]
      );
      // The reviewer note is for staff only; the reporter gets a fixed message.
      if (note) await addHistory(db, r.id, 'Review Note', note, req.user.id);
      await addHistory(db, r.id, 'Resolved', 'Your issue has been resolved', req.user.id);
    } else {
      const to = W.nextState('requestInfo', r.workflow_state);
      await db.query(
        `UPDATE reports SET workflow_state = $1, status = $2, review_note = $3, updated_at = NOW() WHERE id = $4`,
        [to, W.statusFor(to), note, r.id]
      );
      // Not one of the reporter's 5 steps: only staff and management see it.
      await addHistory(db, r.id, 'More Info Requested', note, req.user.id);
    }
    return r.id;
  });

  res.json({
    success: true,
    message: decision === 'approve' ? 'Resolution approved. The report is now Resolved' : 'The team has been asked for more information',
    report: await loadDetail(reportId, req.user),
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/manage/reports/:id/history        (management)             */
/* The full audit trail, newest event first.                           */
/* ------------------------------------------------------------------ */
exports.statusHistory = asyncHandler(async (req, res) => {
  const r = await findReport(req.params.id);

  const { rows } = await query(
    `SELECT h.step, h.note, h.created_at, hu.username, hu.role
       FROM report_status_history h
       LEFT JOIN users hu ON hu.id = h.changed_by
      WHERE h.report_id = $1
      ORDER BY h.created_at DESC, h.id DESC`,
    [r.id]
  );

  let resolutionTime = null;
  if (r.workflow_state === 'resolved' && r.resolved_at) {
    const totalHours = Math.max(Math.round((new Date(r.resolved_at) - new Date(r.created_at)) / 3600000), 0);
    resolutionTime = { totalHours, days: Math.floor(totalHours / 24), hours: totalHours % 24 };
  }

  res.json({
    success: true,
    report: {
      id: r.id,
      reportCode: r.report_code,
      title: r.title,
      location: r.location_text || null,
      workflowState: r.workflow_state,
      stateLabel: W.STATE_LABELS[r.workflow_state],
    },
    events: rows.map((h) => ({
      step: h.step,
      note: h.note,
      at: h.created_at,
      by: h.username ? { username: h.username, role: h.role } : null,
    })),
    resolutionTime,
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/manage/monitor                    (management)             */
/* The counters and "Team workload" box of the monitoring page.        */
/* The table itself = GET /manage/reports (add &departmentId= for      */
/* "View queue").                                                      */
/* ------------------------------------------------------------------ */
exports.monitor = asyncHandler(async (req, res) => {
  const [summary, workload] = await Promise.all([
    query(`
      SELECT COUNT(*) FILTER (WHERE workflow_state = 'assigned')::int AS assigned,
             COUNT(*) FILTER (WHERE workflow_state IN ('assigned', 'in_progress') AND due_date = CURRENT_DATE)::int AS due_today,
             COUNT(*) FILTER (WHERE workflow_state IN ('assigned', 'in_progress') AND due_date < CURRENT_DATE)::int AS overdue,
             COUNT(*) FILTER (WHERE workflow_state = 'pending_review')::int AS awaiting_review
        FROM reports`),
    query(`
      SELECT d.id, d.name,
             COUNT(r.id) FILTER (WHERE r.workflow_state IN ('assigned', 'in_progress', 'pending_review'))::int AS active
        FROM departments d
        LEFT JOIN reports r ON r.department_id = d.id
       GROUP BY d.id, d.name
       ORDER BY active DESC, d.name`),
  ]);

  const s = summary.rows[0];
  res.json({
    success: true,
    summary: { assigned: s.assigned, dueToday: s.due_today, overdue: s.overdue, awaitingReview: s.awaiting_review },
    teamWorkload: workload.rows.map((w) => ({ departmentId: w.id, name: w.name, active: w.active })),
  });
});
