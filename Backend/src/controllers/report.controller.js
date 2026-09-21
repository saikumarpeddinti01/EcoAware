const crypto = require('crypto');
const { pool, query } = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const detectImage = require('../utils/imageType');
const { uploadImage, removeFiles } = require('../utils/storage');
const { STATE_LABELS, CATEGORIES } = require('../utils/workflow');

const STATUSES = ['Pending', 'In Progress', 'Resolved'];
const STEPS = ['Report Submitted', 'Under Review', 'Team Assigned', 'Work In Progress', 'Resolved'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^#?EA-\d{4}-\d{3,}$/i;

const normCategory = (c) => CATEGORIES.find((x) => x.toLowerCase() === String(c || '').trim().toLowerCase());

const normStatus = (s) => {
  const k = String(s || '').trim().toLowerCase().replace(/[-_]+/g, ' ');
  if (!k || k === 'all') return null;
  const hit = STATUSES.find((x) => x.toLowerCase() === k);
  if (!hit) throw new AppError(`Invalid status. Use one of: all, ${STATUSES.join(', ')}`, 400);
  return hit;
};

const parseCoord = (raw, name, min, max) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new AppError(`Invalid ${name}`, 400, { errors: { [name]: `Invalid ${name}` } });
  return n;
};

const defaultTitle = (category, description) => {
  const first = description.split(/[.\n]/)[0].trim();
  const snippet = first.length > 60 ? first.slice(0, 57).trimEnd() + '...' : first;
  return `${category} issue - ${snippet}`;
};

/* ------------------------------------------------------------------ */
/* shaping helpers                                                     */
/* ------------------------------------------------------------------ */

// Turns raw history rows into the 5-step progress list the UI draws.
const buildSteps = (history) => {
  const reached = new Map();
  history.forEach((h) => reached.set(h.step, h)); // history is oldest -> newest
  let last = -1;
  STEPS.forEach((s, i) => { if (reached.has(s)) last = i; });

  return STEPS.map((step, i) => {
    const h = reached.get(step);
    let state = 'upcoming';
    if (i < last) state = 'done';
    else if (i === last) state = step === 'Resolved' ? 'done' : 'current';
    return { step, state, at: h ? h.created_at : null, note: h ? h.note : null };
  });
};

const groupPhotos = (rows) => {
  const out = { reported: [], before: [], after: [] };
  rows.forEach((p) => out[p.type].push({ id: p.id, url: p.url }));
  return out;
};

const summary = (r) => ({
  id: r.id,
  reportCode: r.report_code,
  title: r.title,
  category: r.category,
  description: r.description,
  status: r.status,
  thumbnail: r.thumbnail || null,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

// Loads one report with photos + timeline. Reporters can only see their own (404 otherwise).
const loadDetail = async (idOrCode, viewer) => {
  const key = String(idOrCode || '').trim();
  let where;
  if (UUID_RE.test(key)) where = 'r.id = $1';
  else if (CODE_RE.test(key)) where = 'UPPER(r.report_code) = UPPER($1)';
  else throw new AppError('Report not found', 404);

  const params = [key.replace(/^#/, '')];
  if (viewer.role === 'reporter') {
    params.push(viewer.id);
    where += ' AND r.reporter_id = $2';
  }

  const { rows } = await query(
    `SELECT r.*, u.username AS reporter_username, a.username AS assigned_username, d.name AS department_name
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       LEFT JOIN users a ON a.id = r.assigned_to
       LEFT JOIN departments d ON d.id = r.department_id
      WHERE ${where}`,
    params
  );
  if (!rows.length) throw new AppError('Report not found', 404);
  const r = rows[0];

  const [photos, history] = await Promise.all([
    query('SELECT id, url, type FROM report_photos WHERE report_id = $1 ORDER BY created_at, id', [r.id]),
    query(
      `SELECT h.step, h.note, h.created_at, hu.username AS by_username
         FROM report_status_history h
         LEFT JOIN users hu ON hu.id = h.changed_by
        WHERE h.report_id = $1
        ORDER BY h.created_at, h.id`,
      [r.id]
    ),
  ]);

  // Completion ("after") photos stay hidden from the reporter until management approves the fix.
  const reporterPhotos = groupPhotos(photos.rows);
  if (viewer.role === 'reporter' && r.status !== 'Resolved') reporterPhotos.after = [];

  const detail = {
    id: r.id,
    reportCode: r.report_code,
    title: r.title,
    category: r.category,
    description: r.description,
    status: r.status,
    location: r.location_text || null,
    latitude: r.latitude,
    longitude: r.longitude,
    estimatedCompletion: r.due_date || null, // "YYYY-MM-DD" once the report has been assigned
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
    photos: reporterPhotos,
    steps: buildSteps(history.rows),
    // Reporters only see their own 5 steps; staff/management also see internal events (with who did them).
    timeline: history.rows
      .filter((h) => viewer.role !== 'reporter' || STEPS.includes(h.step))
      .map((h) => ({ step: h.step, note: h.note, at: h.created_at, ...(viewer.role !== 'reporter' ? { by: h.by_username } : {}) })),
    resolution:
      r.status === 'Resolved'
        ? { resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, actionTaken: r.action_taken }
        : null,
  };
  if (viewer.role !== 'reporter') {
    detail.reporter = { id: r.reporter_id, username: r.reporter_username };
    detail.assignedTo = r.assigned_to ? { id: r.assigned_to, username: r.assigned_username } : null;

    // Stage 4: fields for the staff and management screens
    const submission = [...history.rows].reverse().find((h) => h.step === 'Resolution Submitted');
    detail.workflowState = r.workflow_state;
    detail.stateLabel = STATE_LABELS[r.workflow_state];
    detail.priority = r.priority;
    detail.department = r.department_id ? { id: r.department_id, name: r.department_name } : null;
    detail.assignedAt = r.assigned_at;
    detail.startedAt = r.started_at;
    detail.reviewNote = r.review_note;
    detail.evidenceComplete = Boolean(r.action_taken && photos.rows.some((p) => p.type === 'after'));
    detail.technicianUpdate = r.resolution_submitted_at
      ? {
          note: r.action_taken,
          submittedBy: submission ? submission.by_username : null,
          submittedAt: r.resolution_submitted_at,
          team: r.resolved_by,
        }
      : null;
  }
  return detail;
};

/* ------------------------------------------------------------------ */
/* POST /api/reports        (reporter)  multipart/form-data            */
/*   fields: category, description, title?, latitude?, longitude?      */
/*   files : photos (1-5 images, jpg/png/webp, <= 5 MB each)           */
/* ------------------------------------------------------------------ */
exports.createReport = asyncHandler(async (req, res) => {
  const files = [...(req.files?.photos || []), ...(req.files?.photo || [])];

  const category = normCategory(req.body.category);
  const description = String(req.body.description || '').trim();
  const errors = {};
  if (!category) errors.category = `Category must be one of: ${CATEGORIES.join(', ')}`;
  if (description.length < 10) errors.description = 'Please describe the issue (at least 10 characters)';
  else if (description.length > 2000) errors.description = 'Description must be 2000 characters or less';
  if (!files.length) errors.photos = 'Please capture at least one photo of the issue';
  if (files.length > 5) errors.photos = 'You can upload at most 5 photos';

  let title = String(req.body.title || '').trim();
  if (title.length > 150) errors.title = 'Title must be 150 characters or less';

  const locationText = String(req.body.location || '').trim(); // e.g. "Science Building - Room 303"
  if (locationText.length > 200) errors.location = errors.location || 'Location must be 200 characters or less';

  let latitude = null, longitude = null;
  try {
    latitude = parseCoord(req.body.latitude, 'latitude', -90, 90);
    longitude = parseCoord(req.body.longitude, 'longitude', -180, 180);
    if ((latitude === null) !== (longitude === null)) errors.location = 'Send both latitude and longitude, or neither';
  } catch (e) {
    Object.assign(errors, e.extra?.errors);
  }
  if (Object.keys(errors).length) throw new AppError('Please fix the highlighted fields', 400, { errors });

  // Verify each file really is an image (by its bytes, not its name).
  const images = files.map((f) => {
    const type = detectImage(f.buffer);
    if (!type) throw new AppError(`"${f.originalname}" is not a valid JPG, PNG or WebP image`, 400, { errors: { photos: 'Only JPG, PNG or WebP images are allowed' } });
    return { buffer: f.buffer, ...type };
  });

  if (!title) title = defaultTitle(category, description);

  const reportId = crypto.randomUUID();
  const uploaded = [];
  try {
    for (const img of images) {
      const storagePath = `reports/${reportId}/${crypto.randomUUID()}.${img.ext}`;
      uploaded.push(await uploadImage({ buffer: img.buffer, mime: img.mime, storagePath }));
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        `INSERT INTO reports (id, report_code, reporter_id, title, category, description, latitude, longitude, location_text, status)
         VALUES ($1, 'EA-' || to_char(NOW(), 'YYYY') || '-' || lpad(nextval('report_code_seq')::text, 4, '0'),
                 $2, $3, $4, $5, $6, $7, $8, 'Pending')`,
        [reportId, req.user.id, title, category, description, latitude, longitude, locationText || null]
      );
      // clock_timestamp() (not NOW()) so photos keep their upload order
      for (const u of uploaded) {
        await db.query(
          `INSERT INTO report_photos (report_id, url, storage_path, type, created_at)
           VALUES ($1, $2, $3, 'reported', clock_timestamp())`,
          [reportId, u.url, u.path]
        );
      }
      await db.query(
        `INSERT INTO report_status_history (report_id, step, note, changed_by, created_at)
         VALUES ($1, 'Report Submitted', 'Report submitted by reporter', $2, clock_timestamp())`,
        [reportId, req.user.id]
      );
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    await removeFiles(uploaded.map((u) => u.path)); // don't leave orphan photos behind
    throw e;
  }

  const report = await loadDetail(reportId, req.user);
  res.status(201).json({ success: true, message: 'Report submitted', report });
});

/* ------------------------------------------------------------------ */
/* GET /api/reports/mine?status=&page=&limit=       (reporter)         */
/* ------------------------------------------------------------------ */
exports.listMyReports = asyncHandler(async (req, res) => {
  const status = normStatus(req.query.status);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

  const params = [req.user.id];
  let filter = '';
  if (status) {
    params.push(status);
    filter = 'AND r.status = $2';
  }

  const list = await query(
    `SELECT r.id, r.report_code, r.title, r.category, r.description, r.status, r.created_at, r.resolved_at,
            (SELECT url FROM report_photos p WHERE p.report_id = r.id AND p.type = 'reported'
              ORDER BY p.created_at, p.id LIMIT 1) AS thumbnail
       FROM reports r
      WHERE r.reporter_id = $1 ${filter}
      ORDER BY r.created_at DESC, r.id
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params
  );

  // Counts for the tab badges (All / Pending / In Progress / Resolved)
  const counts = { all: 0, Pending: 0, 'In Progress': 0, Resolved: 0 };
  (await query('SELECT status, COUNT(*)::int AS n FROM reports WHERE reporter_id = $1 GROUP BY status', [req.user.id])).rows
    .forEach((c) => { counts[c.status] = c.n; counts.all += c.n; });

  const total = status ? counts[status] : counts.all;
  res.json({
    success: true,
    reports: list.rows.map(summary),
    counts,
    pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/reports/:id      (id = UUID or code like EA-2026-0001)     */
/* Reporters: own reports only. Staff/management: any report.          */
/* ------------------------------------------------------------------ */
exports.getReport = asyncHandler(async (req, res) => {
  res.json({ success: true, report: await loadDetail(req.params.id, req.user) });
});

/* ------------------------------------------------------------------ */
/* PATCH /api/reports/:id     (reporter, own, only while Pending)      */
/*   body (JSON): title?, description?, category?                      */
/* ------------------------------------------------------------------ */
exports.updateReport = asyncHandler(async (req, res) => {
  const existing = await loadDetail(req.params.id, req.user); // 404 if not theirs
  if (existing.status !== 'Pending') throw new AppError('Only reports that are still Pending can be edited', 409);

  const sets = [];
  const params = [];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  const errors = {};

  if (req.body.category !== undefined) {
    const c = normCategory(req.body.category);
    if (!c) errors.category = `Category must be one of: ${CATEGORIES.join(', ')}`; else add('category', c);
  }
  if (req.body.description !== undefined) {
    const d = String(req.body.description).trim();
    if (d.length < 10 || d.length > 2000) errors.description = 'Description must be 10-2000 characters'; else add('description', d);
  }
  if (req.body.title !== undefined) {
    const t = String(req.body.title).trim();
    if (!t || t.length > 150) errors.title = 'Title must be 1-150 characters'; else add('title', t);
  }
  if (Object.keys(errors).length) throw new AppError('Please fix the highlighted fields', 400, { errors });
  if (!sets.length) throw new AppError('Nothing to update', 400);

  params.push(existing.id);
  const updated = await query(`UPDATE reports SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} AND status = 'Pending'`, params);
  // The team may have picked the report up between our check and the update.
  if (updated.rowCount === 0) throw new AppError('This report was just picked up by the team and can no longer be edited', 409);
  res.json({ success: true, message: 'Report updated', report: await loadDetail(existing.id, req.user) });
});

/* ------------------------------------------------------------------ */
/* DELETE /api/reports/:id    (reporter, own, only while Pending)      */
/* ------------------------------------------------------------------ */
exports.deleteReport = asyncHandler(async (req, res) => {
  const existing = await loadDetail(req.params.id, req.user);
  if (existing.status !== 'Pending') throw new AppError('Only reports that are still Pending can be deleted', 409);

  const paths = (await query('SELECT storage_path FROM report_photos WHERE report_id = $1', [existing.id])).rows.map((p) => p.storage_path);
  const deleted = await query("DELETE FROM reports WHERE id = $1 AND status = 'Pending'", [existing.id]); // photos + history cascade
  // If the team picked it up a moment ago nothing was deleted, so keep the photos and tell the user.
  if (deleted.rowCount === 0) throw new AppError('This report was just picked up by the team and can no longer be deleted', 409);
  await removeFiles(paths);
  res.json({ success: true, message: 'Report deleted' });
});

// Used by the staff and management controllers (not a route handler).
exports.loadDetail = loadDetail;
