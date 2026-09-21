const crypto = require('crypto');
const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const detectImage = require('../utils/imageType');
const { uploadImage, removeFiles } = require('../utils/storage');
const W = require('../utils/workflow');
const L = require('../utils/listing');
const { findReport, withReportLock, addHistory, hasStep } = require('../utils/reportTx');
const { loadDetail } = require('./report.controller');

/* ---------------- helpers ---------------- */

// The logged-in user plus their department (the auth middleware only loads the basics).
const getContext = async (user) => {
  const { rows } = await query(
    `SELECT u.id, u.username, u.department_id, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1`,
    [user.id]
  );
  return rows[0];
};

// "Incoming" = nobody owns the report yet. A staff member with a department sees
// reports for their department (or for no department yet); without one they see everything.
const incomingFilters = (ctx) => {
  const f = L.makeFilters();
  f.raw("r.assigned_to IS NULL AND r.workflow_state IN ('new', 'assigned')");
  if (ctx.department_id) f.add('(r.department_id IS NULL OR r.department_id = ?)', ctx.department_id);
  return f;
};

const taskStatus = (row) => {
  if (row.isOverdue) return 'Overdue';
  return { assigned: 'Not started', in_progress: 'In progress', pending_review: 'Awaiting review', resolved: 'Resolved' }[row.workflowState] || row.stateLabel;
};

/* ------------------------------------------------------------------ */
/* GET /api/staff/dashboard                   (staff, management)      */
/* ------------------------------------------------------------------ */
exports.dashboard = asyncHandler(async (req, res) => {
  const ctx = await getContext(req.user);
  const incA = incomingFilters(ctx);
  const incB = incomingFilters(ctx);

  const [incoming, recent, campus, mine] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE r.priority = 'Critical')::int AS critical
       ${L.FROM_JOINS} ${incA.where}`,
      incA.params
    ),
    query(`${L.LIST_SELECT} ${incB.where} ORDER BY ${L.PRIORITY_ORDER}, r.created_at DESC LIMIT 5`, incB.params),
    query(`
      SELECT COUNT(*) FILTER (WHERE workflow_state = 'in_progress')::int AS in_progress,
             COUNT(DISTINCT department_id) FILTER (WHERE workflow_state = 'in_progress')::int AS teams,
             COUNT(*) FILTER (WHERE workflow_state = 'resolved' AND resolved_at >= date_trunc('day', NOW()))::int AS resolved_today
        FROM reports`),
    query(
      `SELECT COUNT(*) FILTER (WHERE workflow_state IN ('assigned', 'in_progress'))::int AS active,
              COUNT(*) FILTER (WHERE workflow_state IN ('assigned', 'in_progress') AND due_date = CURRENT_DATE)::int AS due_today
         FROM reports WHERE assigned_to = $1`,
      [req.user.id]
    ),
  ]);

  res.json({
    success: true,
    user: { id: ctx.id, username: ctx.username, department: ctx.department_id ? { id: ctx.department_id, name: ctx.department_name } : null },
    stats: {
      incoming: { count: incoming.rows[0].total, critical: incoming.rows[0].critical },
      inProgress: { count: campus.rows[0].in_progress, teams: campus.rows[0].teams },
      resolvedToday: campus.rows[0].resolved_today,
      assignedToYou: { count: mine.rows[0].active, dueToday: mine.rows[0].due_today },
    },
    recentIncoming: recent.rows.map(L.shapeRow),
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/staff/reports/incoming            (staff, management)      */
/*   ?category=&priority=&search=&from=&to=&sort=newest|priority       */
/*   &page=&limit=                                                     */
/* ------------------------------------------------------------------ */
exports.listIncoming = asyncHandler(async (req, res) => {
  const ctx = await getContext(req.user);
  const f = incomingFilters(ctx);
  L.applyCommonFilters(f, req.query);

  const orderBy =
    String(req.query.sort).toLowerCase() === 'priority'
      ? `${L.PRIORITY_ORDER}, r.created_at DESC, r.id`
      : 'r.created_at DESC, r.id';
  const list = await L.runList({ filters: f, paging: L.parsePaging(req.query), orderBy });
  res.json({ success: true, ...list });
});

/* ------------------------------------------------------------------ */
/* POST /api/staff/reports/:id/claim          (staff)                  */
/*   body: { dueDate?, priority? }                                     */
/* A staff member takes an incoming report as their own task.          */
/* ------------------------------------------------------------------ */
exports.claimReport = asyncHandler(async (req, res) => {
  const ctx = await getContext(req.user);

  let priority = null;
  if (req.body.priority !== undefined && req.body.priority !== null && req.body.priority !== '') {
    priority = W.normPriority(req.body.priority);
    if (!priority) throw new AppError('Please fix the highlighted fields', 400, { errors: { priority: `Priority must be one of: ${W.PRIORITIES.join(', ')}` } });
  }
  let dueDate = null;
  if (req.body.dueDate !== undefined && req.body.dueDate !== null && req.body.dueDate !== '') dueDate = W.parseDueDate(req.body.dueDate);

  const reportId = await withReportLock(req.params.id, async (db, r) => {
    const to = W.nextState('claim', r.workflow_state);
    if (r.assigned_to) throw new AppError('This report is already assigned to someone', 409);
    if (ctx.department_id && r.department_id && r.department_id !== ctx.department_id) {
      throw new AppError('This report belongs to another department', 403);
    }
    const wasNew = r.workflow_state === 'new';
    const finalPriority = priority || r.priority;
    const due = dueDate || r.due_date || W.addDays(W.todayISO(), W.DEFAULT_DUE_DAYS[finalPriority]);

    await db.query(
      `UPDATE reports
          SET assigned_to = $1, department_id = $2, priority = $3, due_date = $4, assigned_at = NOW(),
              workflow_state = $5, status = $6, updated_at = NOW()
        WHERE id = $7`,
      [ctx.id, r.department_id || ctx.department_id || null, finalPriority, due, to, W.statusFor(to), r.id]
    );

    if (wasNew) {
      if (!(await hasStep(db, r.id, 'Under Review'))) {
        await addHistory(db, r.id, 'Under Review', 'Report reviewed by the facilities team', req.user.id);
      }
      // The reporter sees only the team, never a person's name.
      const team = ctx.department_name;
      await addHistory(db, r.id, 'Team Assigned', team ? `Assigned to ${team}` : 'Assigned to a response team', req.user.id);
    }
    // "Claimed" is not one of the reporter's 5 steps, so only staff and management see who took it.
    await addHistory(db, r.id, 'Claimed', `${ctx.username} took this report`, req.user.id);
    return r.id;
  });

  res.json({ success: true, message: 'Report added to your assignments', report: await loadDetail(reportId, req.user) });
});

/* ------------------------------------------------------------------ */
/* GET /api/staff/assignments                 (staff, management)      */
/*   ?tab=active|overdue|completed&page=&limit=                        */
/* The logged-in person's own tasks.                                   */
/* ------------------------------------------------------------------ */
exports.listAssignments = asyncHandler(async (req, res) => {
  const tab = String(req.query.tab || 'active').toLowerCase();
  if (!['active', 'overdue', 'completed'].includes(tab)) throw new AppError('tab must be active, overdue or completed', 400);

  const f = L.makeFilters();
  f.add('r.assigned_to = ?', req.user.id);
  let orderBy;
  if (tab === 'active') {
    f.raw("r.workflow_state IN ('assigned', 'in_progress')");
    orderBy = `r.due_date ASC NULLS LAST, ${L.PRIORITY_ORDER}, r.id`;
  } else if (tab === 'overdue') {
    f.raw("r.workflow_state IN ('assigned', 'in_progress') AND r.due_date < CURRENT_DATE");
    orderBy = 'r.due_date ASC, r.id';
  } else {
    f.raw("r.workflow_state IN ('pending_review', 'resolved') AND COALESCE(r.resolution_submitted_at, r.resolved_at) >= NOW() - INTERVAL '7 days'");
    orderBy = 'COALESCE(r.resolution_submitted_at, r.resolved_at) DESC, r.id';
  }
  L.applyCommonFilters(f, req.query);

  const [list, stats] = await Promise.all([
    L.runList({ filters: f, paging: L.parsePaging(req.query), orderBy }),
    query(
      `SELECT COUNT(*) FILTER (WHERE workflow_state IN ('assigned', 'in_progress'))::int AS active,
              COUNT(*) FILTER (WHERE workflow_state = 'assigned')::int AS not_started,
              COUNT(*) FILTER (WHERE workflow_state = 'in_progress')::int AS in_progress,
              COUNT(*) FILTER (WHERE workflow_state IN ('assigned', 'in_progress') AND due_date < CURRENT_DATE)::int AS overdue,
              COUNT(*) FILTER (WHERE workflow_state IN ('pending_review', 'resolved')
                                 AND COALESCE(resolution_submitted_at, resolved_at) >= NOW() - INTERVAL '7 days')::int AS completed_week,
              (AVG(EXTRACT(EPOCH FROM (resolution_submitted_at - assigned_at)) / 3600)
                 FILTER (WHERE resolution_submitted_at IS NOT NULL AND assigned_at IS NOT NULL))::float8 AS avg_hours,
              COUNT(*) FILTER (WHERE resolution_submitted_at IS NOT NULL AND due_date IS NOT NULL)::int AS sla_total,
              COUNT(*) FILTER (WHERE resolution_submitted_at IS NOT NULL AND due_date IS NOT NULL
                                 AND resolution_submitted_at::date <= due_date)::int AS sla_ok
         FROM reports WHERE assigned_to = $1`,
      [req.user.id]
    ),
  ]);

  const s = stats.rows[0];
  res.json({
    success: true,
    tab,
    stats: {
      totalActive: s.active,
      notStarted: s.not_started,
      inProgress: s.in_progress,
      overdue: s.overdue,
      avgResolutionHours: s.avg_hours === null ? null : Math.round(s.avg_hours * 10) / 10,
      slaCompliancePercent: L.percent(s.sla_ok, s.sla_total),
    },
    counts: { active: s.active, overdue: s.overdue, completedThisWeek: s.completed_week },
    tasks: list.reports.map((row) => ({ ...row, taskStatus: taskStatus(row) })),
    pagination: list.pagination,
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/staff/reports/:id/start          (staff)                  */
/*   body: { note? }                                                   */
/* Only the person the report is assigned to can start it.             */
/* ------------------------------------------------------------------ */
exports.startWork = asyncHandler(async (req, res) => {
  const note = String(req.body.note || '').trim();
  if (note.length > 500) throw new AppError('Please fix the highlighted fields', 400, { errors: { note: 'Note must be 500 characters or less' } });

  const reportId = await withReportLock(req.params.id, async (db, r) => {
    if (!r.assigned_to) throw new AppError('Claim this report first, then start work', 409);
    if (r.assigned_to !== req.user.id) throw new AppError('This report is assigned to someone else', 403);
    const to = W.nextState('start', r.workflow_state);

    await db.query(
      'UPDATE reports SET workflow_state = $1, status = $2, started_at = NOW(), updated_at = NOW() WHERE id = $3',
      [to, W.statusFor(to), r.id]
    );
    await addHistory(db, r.id, 'Work In Progress', note || 'Work has started on your report', req.user.id);
    return r.id;
  });

  res.json({ success: true, message: 'Work started', report: await loadDetail(reportId, req.user) });
});

/* ------------------------------------------------------------------ */
/* POST /api/staff/reports/:id/resolution     (staff)                  */
/*   multipart/form-data: note (10-2000 chars), photos (0-5 "after"    */
/*   images; at least one in total across submissions)                 */
/* Sends the fix to management for approval (state: Pending review).   */
/* Also used again after management asked for more information.        */
/* ------------------------------------------------------------------ */
exports.submitResolution = asyncHandler(async (req, res) => {
  const files = [...(req.files?.photos || []), ...(req.files?.photo || [])];
  const note = String(req.body.note || '').trim();

  // Cheap checks first, before anything is uploaded.
  const before = await findReport(req.params.id);
  if (!before.assigned_to) throw new AppError('Claim this report first', 409);
  if (before.assigned_to !== req.user.id) throw new AppError('This report is assigned to someone else', 403);
  W.nextState('submit', before.workflow_state);

  const errors = {};
  if (note.length < 10) errors.note = 'Please describe what was done (at least 10 characters)';
  else if (note.length > 2000) errors.note = 'The note must be 2000 characters or less';
  if (files.length > 5) errors.photos = 'You can upload at most 5 photos';
  if (!files.length) {
    const existing = await query("SELECT 1 FROM report_photos WHERE report_id = $1 AND type = 'after' LIMIT 1", [before.id]);
    if (!existing.rows.length) errors.photos = 'Please attach at least one "after" photo as evidence';
  }
  if (Object.keys(errors).length) throw new AppError('Please fix the highlighted fields', 400, { errors });

  const images = files.map((file) => {
    const type = detectImage(file.buffer);
    if (!type) throw new AppError(`"${file.originalname}" is not a valid JPG, PNG or WebP image`, 400, { errors: { photos: 'Only JPG, PNG or WebP images are allowed' } });
    return { buffer: file.buffer, ...type };
  });

  const ctx = await getContext(req.user);
  const uploaded = [];
  try {
    for (const img of images) {
      const storagePath = `reports/${before.id}/after-${crypto.randomUUID()}.${img.ext}`;
      uploaded.push(await uploadImage({ buffer: img.buffer, mime: img.mime, storagePath }));
    }

    await withReportLock(before.id, async (db, r) => {
      // Check again inside the lock: things may have changed while the photos were uploading.
      if (r.assigned_to !== req.user.id) throw new AppError('This report is assigned to someone else', 403);
      const to = W.nextState('submit', r.workflow_state);

      if (r.workflow_state === 'assigned') {
        await addHistory(db, r.id, 'Work In Progress', 'Work has started on your report', req.user.id);
      }
      for (const u of uploaded) {
        await db.query(
          `INSERT INTO report_photos (report_id, url, storage_path, type, created_at)
           VALUES ($1, $2, $3, 'after', clock_timestamp())`,
          [r.id, u.url, u.path]
        );
      }
      await db.query(
        `UPDATE reports
            SET workflow_state = $1, status = $2, action_taken = $3, resolved_by = $4,
                started_at = COALESCE(started_at, NOW()), resolution_submitted_at = NOW(), updated_at = NOW()
          WHERE id = $5`,
        [to, W.statusFor(to), note, ctx.department_name || ctx.username, r.id]
      );
      await addHistory(db, r.id, 'Resolution Submitted', note, req.user.id);
    });
  } catch (e) {
    await removeFiles(uploaded.map((u) => u.path)); // don't leave orphan photos behind
    throw e;
  }

  res.json({
    success: true,
    message: 'Resolution sent to management for review',
    report: await loadDetail(before.id, req.user),
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/staff/reports/resolved            (staff, management)      */
/*   ?days=30&mine=true&category=&search=&page=&limit=                 */
/* ------------------------------------------------------------------ */
exports.listResolved = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const f = L.makeFilters();
  f.raw("r.workflow_state = 'resolved'");
  f.add("r.resolved_at >= NOW() - (?::int * INTERVAL '1 day')", days);
  if (String(req.query.mine).toLowerCase() === 'true') f.add('r.assigned_to = ?', req.user.id);
  L.applyCommonFilters(f, req.query);

  const [list, stats] = await Promise.all([
    L.runList({ filters: f, paging: L.parsePaging(req.query), orderBy: 'r.resolved_at DESC, r.id' }),
    query(
      `SELECT COUNT(*)::int AS resolved,
              (AVG(EXTRACT(EPOCH FROM (r.resolution_submitted_at - r.assigned_at)) / 3600)
                 FILTER (WHERE r.resolution_submitted_at IS NOT NULL AND r.assigned_at IS NOT NULL))::float8 AS avg_hours,
              COUNT(*) FILTER (WHERE r.resolution_submitted_at IS NOT NULL AND r.due_date IS NOT NULL)::int AS sla_total,
              COUNT(*) FILTER (WHERE r.resolution_submitted_at IS NOT NULL AND r.due_date IS NOT NULL
                                 AND r.resolution_submitted_at::date <= r.due_date)::int AS sla_ok
       ${L.FROM_JOINS} ${f.where}`,
      f.params
    ),
  ]);

  const s = stats.rows[0];
  res.json({
    success: true,
    days,
    stats: {
      resolved: s.resolved,
      avgResolutionHours: s.avg_hours === null ? null : Math.round(s.avg_hours * 10) / 10,
      slaCompliancePercent: L.percent(s.sla_ok, s.sla_total),
    },
    ...list,
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/staff/team                        (staff, management)      */
/* ------------------------------------------------------------------ */
exports.team = asyncHandler(async (req, res) => {
  const [members, week] = await Promise.all([
    query(`
      SELECT u.id, u.username, u.email, d.id AS department_id, d.name AS department_name,
             COUNT(r.id) FILTER (WHERE r.workflow_state IN ('assigned', 'in_progress'))::int AS active,
             COUNT(r.id) FILTER (WHERE r.workflow_state = 'resolved' AND r.resolved_at >= date_trunc('month', NOW()))::int AS resolved_this_month
        FROM users u
        LEFT JOIN departments d ON d.id = u.department_id
        LEFT JOIN reports r ON r.assigned_to = u.id
       WHERE u.role = 'staff'
       GROUP BY u.id, d.id
       ORDER BY d.name NULLS LAST, u.username`),
    query("SELECT COUNT(*)::int AS n FROM reports WHERE workflow_state = 'resolved' AND resolved_at >= NOW() - INTERVAL '7 days'"),
  ]);

  const list = members.rows.map((m) => ({
    id: m.id,
    username: m.username,
    email: m.email,
    department: m.department_id ? { id: m.department_id, name: m.department_name } : null,
    activeAssignments: m.active,
    resolvedThisMonth: m.resolved_this_month,
  }));
  const totalActive = list.reduce((sum, m) => sum + m.activeAssignments, 0);

  res.json({
    success: true,
    summary: {
      totalMembers: list.length,
      activeLoadPerPerson: list.length ? Math.round((totalActive / list.length) * 10) / 10 : 0,
      resolvedThisWeek: week.rows[0].n,
    },
    members: list,
  });
});
