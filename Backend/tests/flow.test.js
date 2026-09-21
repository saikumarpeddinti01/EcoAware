const h = require('./harness');
const assert = require('assert');
process.env.NODE_ENV = 'test';
process.env.STORAGE_DRIVER = 'local';   // photo uploads go to ./uploads, cleaned below
const fs = require('fs');

const manage = h.load('src/controllers/manage.controller.js');
const staffC = h.load('src/controllers/staff.controller.js');
const reportC = h.load('src/controllers/report.controller.js');

// ---- tiny in-memory model of the tables ----
const MGMT = { id: 'aaaaaaaa-0000-4000-8000-000000000001', username: 'maya', role: 'management' };
const AHMAD = { id: 'bbbbbbbb-0000-4000-8000-000000000002', username: 'ahmad', role: 'staff' };
const HASAN = { id: 'cccccccc-0000-4000-8000-000000000003', username: 'hasan', role: 'staff' };
const REP = { id: 'dddddddd-0000-4000-8000-000000000004', username: 'alex', role: 'reporter' };
const USERS = { [MGMT.id]: { ...MGMT, department_id: null }, [AHMAD.id]: { ...AHMAD, department_id: 2 }, [HASAN.id]: { ...HASAN, department_id: 3 }, [REP.id]: { ...REP, department_id: null } };
const DEPTS = { 1: 'Staff & Asset Management', 2: 'Facilities Team', 3: 'Grounds & Waste' };
const RID = '11111111-1111-4111-8111-111111111111';

let R, history, photos;
const reset = () => {
  R = { id: RID, report_code: 'EA-2026-0001', reporter_id: REP.id, title: 'Water leak', category: 'Water', description: 'Leak in room 303',
        latitude: null, longitude: null, location_text: 'Science Building', status: 'Pending', workflow_state: 'new', priority: 'Medium',
        due_date: null, department_id: null, assigned_to: null, assigned_at: null, started_at: null, resolution_submitted_at: null,
        resolved_at: null, resolved_by: null, action_taken: null, review_note: null, created_at: new Date('2026-09-20T09:18:00Z'), updated_at: new Date() };
  history = [{ step: 'Report Submitted', note: 'Report submitted by reporter', by: REP.id, created_at: new Date('2026-09-20T09:18:00Z') }];
  photos = [{ id: 'p1', url: 'http://x/before.jpg', type: 'reported' }];
};
reset();

let t = 0;
h.db.handler = (sql, params) => {
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
  if (/FROM departments WHERE id = \$1/.test(sql)) return { rows: DEPTS[params[0]] ? [{ id: params[0], name: DEPTS[params[0]] }] : [] };
  if (/FROM users WHERE id = \$1 AND role = 'staff'/.test(sql)) { const u = USERS[params[0]]; return { rows: u && u.role === 'staff' ? [u] : [] }; }
  if (/FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = \$1/.test(sql)) { const u = USERS[params[0]]; return { rows: [{ ...u, department_name: DEPTS[u.department_id] || null }] }; }
  if (/^SELECT r\.\* FROM reports r WHERE .* FOR UPDATE$/.test(sql) || /^SELECT r\.\* FROM reports r WHERE (r\.id|UPPER)/.test(sql)) return { rows: [{ ...R }] };
  if (/FROM report_status_history WHERE report_id = \$1 AND step = \$2/.test(sql)) return { rows: history.some((x) => x.step === params[1]) ? [{}] : [] };
  if (/^INSERT INTO report_status_history/.test(sql)) { history.push({ step: params[1], note: params[2], by: params[3], created_at: new Date(2026, 8, 20, 10, ++t) }); return { rows: [] }; }
  if (/^INSERT INTO report_photos/.test(sql)) { photos.push({ id: 'p' + (photos.length + 1), url: params[1], type: 'after' }); return { rows: [] }; }
  if (/^SELECT 1 FROM report_photos WHERE report_id = \$1 AND type = 'after'/.test(sql)) return { rows: photos.some((p) => p.type === 'after') ? [{}] : [] };
  if (/^UPDATE reports SET/.test(sql)) {
    const set = sql.match(/^UPDATE reports SET (.*?) WHERE/)[1];
    const parts = []; let depth = 0, cur = '';
    for (const ch of set) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    parts.forEach((part) => {
      const [col, expr] = part.split(/ = (.+)/).map((x) => x.trim());
      let m;
      if ((m = expr.match(/^\$(\d+)$/))) R[col] = params[m[1] - 1];
      else if (expr === 'NOW()') R[col] = new Date(2026, 8, 20, 11, ++t);
      else if ((m = expr.match(/^COALESCE\((\w+), NOW\(\)\)$/))) R[col] = R[col] || new Date(2026, 8, 20, 11, ++t);
      else if ((m = expr.match(/^COALESCE\((\w+), \$(\d+)\)$/))) R[col] = R[col] || params[m[2] - 1];
      else throw new Error('test harness cannot read SET expression: ' + part);
    });
    return { rows: [] };
  }
  // loadDetail
  if (/^SELECT r\.\*, u\.username AS reporter_username/.test(sql)) return { rows: [{ ...R, reporter_username: REP.username, assigned_username: R.assigned_to ? USERS[R.assigned_to].username : null, department_name: DEPTS[R.department_id] || null }] };
  if (/^SELECT id, url, type FROM report_photos/.test(sql)) return { rows: photos };
  if (/FROM report_status_history h LEFT JOIN users hu/.test(sql)) return { rows: history.map((x) => ({ ...x, by_username: x.by && USERS[x.by] ? USERS[x.by].username : null })) };
  return { rows: [] };
};

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const file = { originalname: 'after.png', buffer: png };
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

const ok = async (name, handler, req, check) => {
  const { res, err } = await h.call(handler, req);
  assert.ifError(err);
  if (check) check(res.body);
  console.log('  PASS', name);
  return res.body;
};
const fails = async (name, handler, req, code, fieldOrText) => {
  const { err } = await h.call(handler, req);
  assert(err, `${name}: expected an error`);
  assert.strictEqual(err.status, code, `${name}: expected ${code}, got ${err.status} (${err.message})`);
  if (fieldOrText) assert(JSON.stringify(err.extra || {}).includes(fieldOrText) || err.message.includes(fieldOrText), `${name}: missing "${fieldOrText}" in ${err.message} ${JSON.stringify(err.extra)}`);
  console.log('  PASS', name, `-> ${code}`);
};
const stepsOf = () => history.map((x) => x.step);

(async () => {
  console.log('A. management assigns, staff works, management approves');
  await fails('assign without fields', manage.assignReport, { user: MGMT, params: { id: RID }, body: {} }, 400, 'departmentId');
  await fails('assign with past due date', manage.assignReport, { user: MGMT, params: { id: RID }, body: { departmentId: 2, dueDate: '2020-01-01' } }, 400, 'past');
  await fails('assign staff of another department', manage.assignReport, { user: MGMT, params: { id: RID }, body: { departmentId: 2, dueDate: tomorrow, staffId: HASAN.id } }, 400, 'different department');
  await ok('management assigns to Facilities + Ahmad', manage.assignReport,
    { user: MGMT, params: { id: 'EA-2026-0001' }, body: { departmentId: 2, dueDate: tomorrow, priority: 'critical', staffId: AHMAD.id } },
    (b) => { assert.strictEqual(b.report.status, 'In Progress'); assert.strictEqual(b.report.workflowState, 'assigned'); assert.strictEqual(b.report.priority, 'Critical'); assert.strictEqual(b.report.estimatedCompletion, tomorrow); });
  assert.deepStrictEqual(stepsOf(), ['Report Submitted', 'Under Review', 'Team Assigned', 'Assignment Details']); // staff name lives in the staff-only row

  await fails('other staff cannot start it', staffC.startWork, { user: HASAN, params: { id: RID }, body: {} }, 403);
  await fails('cannot approve before submission', manage.reviewResolution, { user: MGMT, params: { id: RID }, body: { decision: 'approve' } }, 409, 'waiting for review');
  await ok('Ahmad starts work', staffC.startWork, { user: AHMAD, params: { id: RID }, body: {} }, (b) => assert.strictEqual(b.report.workflowState, 'in_progress'));
  await fails('cannot start twice', staffC.startWork, { user: AHMAD, params: { id: RID }, body: {} }, 409);
  await fails('resolution needs a note', staffC.submitResolution, { user: AHMAD, params: { id: RID }, body: { note: 'x' }, files: { photos: [file] } }, 400, 'note');
  await fails('resolution needs an after photo', staffC.submitResolution, { user: AHMAD, params: { id: RID }, body: { note: 'Replaced the coupling and dried the floor' } }, 400, 'photos');
  await fails('fake image rejected', staffC.submitResolution, { user: AHMAD, params: { id: RID }, body: { note: 'Replaced the coupling and dried the floor' }, files: { photos: [{ originalname: 'x.png', buffer: Buffer.from('not an image at all!!') }] } }, 400, 'JPG');
  const sub = await ok('Ahmad submits resolution with photo', staffC.submitResolution,
    { user: AHMAD, params: { id: RID }, body: { note: 'Replaced the coupling and dried the floor' }, files: { photos: [file] } },
    (b) => { assert.strictEqual(b.report.workflowState, 'pending_review'); assert.strictEqual(b.report.status, 'In Progress'); assert.strictEqual(b.report.evidenceComplete, true); assert.strictEqual(b.report.technicianUpdate.submittedBy, 'ahmad'); assert.strictEqual(b.report.photos.after.length, 1); });

  await fails('request_info needs a note', manage.reviewResolution, { user: MGMT, params: { id: RID }, body: { decision: 'request_info' } }, 400, 'note');
  await ok('management asks for more info', manage.reviewResolution, { user: MGMT, params: { id: RID }, body: { decision: 'request_info', note: 'Please add a photo of the valve' } },
    (b) => { assert.strictEqual(b.report.workflowState, 'in_progress'); assert.strictEqual(b.report.reviewNote, 'Please add a photo of the valve'); });
  await ok('Ahmad resubmits (existing photo is enough)', staffC.submitResolution, { user: AHMAD, params: { id: RID }, body: { note: 'Added valve details, all tested' } }, (b) => assert.strictEqual(b.report.workflowState, 'pending_review'));
  const done = await ok('management approves', manage.reviewResolution, { user: MGMT, params: { id: RID }, body: { decision: 'approve', note: 'Looks good' } },
    (b) => { assert.strictEqual(b.report.workflowState, 'resolved'); assert.strictEqual(b.report.status, 'Resolved'); assert.strictEqual(b.report.resolution.actionTaken, 'Added valve details, all tested'); assert.strictEqual(b.report.resolution.resolvedBy, 'Facilities Team'); });
  await fails('cannot assign a resolved report', manage.assignReport, { user: MGMT, params: { id: RID }, body: { departmentId: 2, dueDate: tomorrow } }, 409);

  console.log('  audit trail:', stepsOf().join(' > '));
  assert.deepStrictEqual(stepsOf(), ['Report Submitted', 'Under Review', 'Team Assigned', 'Assignment Details', 'Work In Progress', 'Resolution Submitted', 'More Info Requested', 'Resolution Submitted', 'Review Note', 'Resolved']);

  console.log('B. what the reporter sees (must hide internal events)');
  const rep = await reportC.loadDetail(RID, REP);
  assert.deepStrictEqual(rep.timeline.map((x) => x.step), ['Report Submitted', 'Under Review', 'Team Assigned', 'Work In Progress', 'Resolved']);
  assert.deepStrictEqual(rep.steps.map((s) => s.state), ['done', 'done', 'done', 'done', 'done']);
  assert(!('priority' in rep) && !('workflowState' in rep) && !('technicianUpdate' in rep), 'reporter must not see internal fields');
  assert(!/ahmad|Looks good|Please add a photo/.test(JSON.stringify(rep.steps) + JSON.stringify(rep.timeline)), 'reporter must not see staff names or internal notes');
  console.log('  PASS reporter timeline has only their 5 steps, no internal fields, no staff names or internal notes');

  console.log('C. staff claims an incoming report');
  reset();
  await ok('Ahmad claims (defaults filled in)', staffC.claimReport, { user: AHMAD, params: { id: RID }, body: {} },
    (b) => { assert.strictEqual(b.report.assignedTo.username, 'ahmad'); assert.strictEqual(b.report.workflowState, 'assigned'); assert.strictEqual(b.report.department.id, 2); assert(b.report.estimatedCompletion >= today); });
  await fails('second person cannot claim it', staffC.claimReport, { user: HASAN, params: { id: RID }, body: {} }, 409, 'already assigned');
  reset(); R.department_id = 3;
  await fails('claim a report routed to another department', staffC.claimReport, { user: AHMAD, params: { id: RID }, body: {} }, 403);
  reset();
  await ok('resolution straight from Assigned auto-starts the work', staffC.claimReport, { user: AHMAD, params: { id: RID }, body: { priority: 'High', dueDate: tomorrow } });
  await ok('  ...then submit', staffC.submitResolution, { user: AHMAD, params: { id: RID }, body: { note: 'Fixed it on the spot, thanks' }, files: { photos: [file] } });
  assert.deepStrictEqual(stepsOf(), ['Report Submitted', 'Under Review', 'Team Assigned', 'Claimed', 'Work In Progress', 'Resolution Submitted']);

  console.log('D. reassign before work starts');
  reset();
  await ok('assign', manage.assignReport, { user: MGMT, params: { id: RID }, body: { departmentId: 2, dueDate: tomorrow } });
  await ok('reassign', manage.assignReport, { user: MGMT, params: { id: RID }, body: { departmentId: 3, dueDate: tomorrow, note: 'Better fit' } }, (b) => assert.strictEqual(b.report.department.id, 3));
  assert.strictEqual(stepsOf().pop(), 'Reassigned');
  await fails('start on unclaimed report', staffC.startWork, { user: AHMAD, params: { id: RID }, body: {} }, 409, 'Claim');

  console.log('E. validation of ids');
  await fails('bad report id', manage.statusHistory, { user: MGMT, params: { id: 'nope' } }, 404);
  await fails('bad decision', manage.reviewResolution, { user: MGMT, params: { id: RID }, body: { decision: 'maybe' } }, 400, 'decision');

  console.log('F. SQL sanity across everything executed:', h.sqlLog.length, 'statements');
  console.log(h.problems.length ? 'PROBLEMS:\n' + h.problems.join('\n') : '  no placeholder / parenthesis problems');
  fs.rmSync(require('path').join(h.ROOT, 'uploads'), { recursive: true, force: true });
  if (h.problems.length) process.exit(1);
  console.log('\nALL FLOW TESTS PASSED');
})().catch((e) => { console.error('\nTEST FAILED:', e.message); console.error(e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });
