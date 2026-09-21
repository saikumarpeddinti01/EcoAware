const h = require('./harness');
const assert = require('assert');
process.env.NODE_ENV = 'test';
const manage = h.load('src/controllers/manage.controller.js');
const staffC = h.load('src/controllers/staff.controller.js');

const MGMT = { id: 'aaaaaaaa-0000-4000-8000-000000000001', role: 'management', username: 'maya' };
const AHMAD = { id: 'bbbbbbbb-0000-4000-8000-000000000002', role: 'staff', username: 'ahmad' };
const row = { id: 'r1', report_code: 'EA-2026-0001', title: 't', category: 'Water', description: 'd', location_text: 'Sci', latitude: null, longitude: null,
  status: 'In Progress', workflow_state: 'assigned', priority: 'High', due_date: '2026-09-22', department_id: 2, department_name: 'Facilities Team',
  assigned_to: AHMAD.id, assigned_username: 'ahmad', reporter_id: 'u', reporter_username: 'alex', reporter_role: 'reporter',
  created_at: new Date(), is_overdue: false, duration_minutes: null, thumbnail: null };
const zero = new Proxy({}, { get: () => 0 });

h.db.handler = (sql, params) => {
  if (/^SELECT COUNT\(\*\)::int AS n FROM reports r/.test(sql)) return { rows: [{ n: 1 }] };
  if (/^SELECT r\.id, r\.report_code/.test(sql)) return { rows: [row] };
  if (/FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = \$1/.test(sql)) return { rows: [{ id: AHMAD.id, username: 'ahmad', department_id: 2, department_name: 'Facilities Team' }] };
  if (/AS median_days/.test(sql)) return { rows: [{ median_days: 1.84 }] };
  if (/SELECT category, COUNT/.test(sql)) return { rows: [{ category: 'Waste', n: 42 }, { category: 'Water', n: 27 }, { category: 'Energy', n: 19 }, { category: 'Other', n: 12 }] };
  if (/GROUP BY workflow_state/.test(sql)) return { rows: [{ workflow_state: 'new', n: 3 }, { workflow_state: 'resolved', n: 5 }] };
  if (/FROM departments d LEFT JOIN reports r/.test(sql)) return { rows: [{ id: 2, name: 'Facilities Team', active: 4 }] };
  if (/FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN reports r/.test(sql)) return { rows: [{ id: 'x', username: 'ahmad', email: 'a@b.c', department_id: 2, department_name: 'Facilities Team', active: 2, resolved_this_month: 24 }] };
  if (/^SELECT COUNT\(\*\)::int AS n FROM reports WHERE workflow_state = 'resolved'/.test(sql)) return { rows: [{ n: 54 }] };
  if (/FROM reports WHERE assigned_to = \$1/.test(sql) || /FROM reports$/.test(sql)) return { rows: [{ active: 8, not_started: 2, in_progress: 6, overdue: 2, completed_week: 14, avg_hours: 3.44, sla_total: 100, sla_ok: 94, resolved: 5 }] };
  if (/^SELECT \(percentile|^SELECT COUNT\(\*\)|^SELECT d\.id|^SELECT h\.step/.test(sql)) return { rows: [zero] };
  return { rows: [zero] };
};

const go = async (name, fn, req, check) => {
  const { res, err } = await h.call(fn, req);
  assert.ifError(err);
  if (check) check(res.body);
  console.log('  PASS', name);
  return res.body;
};
const bad = async (name, fn, req, code) => {
  const { err } = await h.call(fn, req);
  assert(err && err.status === code, `${name}: expected ${code}, got ${err && err.status}`);
  console.log('  PASS', name, '->', code);
};
const last = (re) => [...h.sqlLog].reverse().find((x) => re.test(x.sql));

(async () => {
  await go('management dashboard', manage.dashboard, { user: MGMT }, (b) => {
    assert.strictEqual(b.byCategory[0].category, 'Waste'); assert.strictEqual(b.byCategory[0].percent, 42);
    assert.strictEqual(b.stats.medianResolutionDays, 1.8); assert(Array.isArray(b.recent)); });
  await go('management list, all filters', manage.listReports,
    { user: MGMT, query: { status: 'In Progress', category: 'water', priority: 'high', departmentId: '2', assignedTo: AHMAD.id, overdue: 'true', search: '100%_leak', from: '2026-09-01', to: '2026-09-30', page: '2', limit: '10' } },
    (b) => { assert.strictEqual(b.pagination.page, 2); assert.strictEqual(b.counts.new, 3); assert.strictEqual(b.counts.all, 8); assert.strictEqual(b.reports[0].stateLabel, 'Assigned'); });
  const q = last(/^SELECT r\.id, r\.report_code/);
  console.log('\n  generated list SQL (tail):\n  ...' + q.sql.slice(q.sql.indexOf('WHERE')) + '\n  params:', JSON.stringify(q.params), '\n');
  assert(q.params.includes('%100\\%\\_leak%'), 'LIKE wildcards must be escaped');
  await bad('bad status filter', manage.listReports, { user: MGMT, query: { status: 'weird' } }, 400);
  await bad('bad category filter', manage.listReports, { user: MGMT, query: { category: 'nope' } }, 400);
  await bad('bad date filter', manage.listReports, { user: MGMT, query: { from: '2026-13-45' } }, 400);
  await bad('bad departmentId', manage.listReports, { user: MGMT, query: { departmentId: 'abc' } }, 400);
  await go('monitor', manage.monitor, { user: MGMT }, (b) => assert.strictEqual(b.teamWorkload[0].name, 'Facilities Team'));
  await go('departments', manage.listDepartments, { user: MGMT });
  await go('status history', manage.statusHistory, { user: MGMT, params: { id: '11111111-1111-4111-8111-111111111111' } });

  await go('staff dashboard', staffC.dashboard, { user: AHMAD }, (b) => { assert.strictEqual(b.user.department.name, 'Facilities Team'); assert(b.stats.incoming && b.stats.assignedToYou); });
  await go('incoming (priority sort + filters)', staffC.listIncoming, { user: AHMAD, query: { sort: 'priority', category: 'Waste', priority: 'Critical' } });
  const inc = last(/^SELECT r\.id, r\.report_code/);
  console.log('\n  incoming SQL (tail):\n  ...' + inc.sql.slice(inc.sql.indexOf('WHERE')) + '\n  params:', JSON.stringify(inc.params), '\n');
  for (const tab of ['active', 'overdue', 'completed']) {
    await go('assignments tab=' + tab, staffC.listAssignments, { user: AHMAD, query: { tab } }, (b) => {
      assert.strictEqual(b.tab, tab); assert.strictEqual(b.stats.slaCompliancePercent, 94); assert.strictEqual(b.tasks[0].taskStatus, 'Not started'); });
  }
  await bad('bad assignments tab', staffC.listAssignments, { user: AHMAD, query: { tab: 'x' } }, 400);
  await go('resolved list (mine, 7 days)', staffC.listResolved, { user: AHMAD, query: { days: '7', mine: 'true' } }, (b) => assert.strictEqual(b.days, 7));
  await go('team', staffC.team, { user: AHMAD }, (b) => { assert.strictEqual(b.summary.resolvedThisWeek, 54); assert.strictEqual(b.members[0].resolvedThisMonth, 24); });

  console.log('\nSQL statements checked:', h.sqlLog.length);
  console.log(h.problems.length ? 'PROBLEMS:\n' + h.problems.join('\n') : 'no placeholder / parenthesis problems');
  if (h.problems.length) process.exit(1);
  console.log('ALL LIST TESTS PASSED');
})().catch((e) => { console.error('\nTEST FAILED:', e.message); console.error(e.stack.split('\n').slice(0, 5).join('\n')); process.exit(1); });
