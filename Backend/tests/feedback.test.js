const h = require('./harness');
const assert = require('assert');
process.env.NODE_ENV = 'test';
const fb = h.load('src/controllers/feedback.controller.js');
const report = h.load('src/controllers/report.controller.js');

const MGMT = { id: 'aaaaaaaa-0000-4000-8000-000000000001', role: 'management', username: 'maya' };
const ALEX = { id: 'cccccccc-0000-4000-8000-000000000003', role: 'reporter', username: 'alex' };

h.db.handler = (sql) => {
  if (/^SELECT COUNT\(\*\)::int AS total, AVG\(rating\)/.test(sql)) return { rows: [{ total: 2, avg_rating: 4.25 }] };
  if (/^SELECT id, rating, category, message/.test(sql)) {
    return { rows: [{ id: 'f1', rating: 5, category: 'water', message: 'Great', suggestion: null, created_at: new Date() }] };
  }
  return { rows: [], rowCount: 1 };
};

const bad = async (name, fn, req, code) => {
  const { err } = await h.call(fn, req);
  assert(err && err.status === code, `${name}: expected ${code}, got ${err && err.status}`);
  console.log('  PASS', name, '->', code);
  return err;
};

(async () => {
  console.log('Feedback');

  // valid submission is stored WITHOUT the user id (feedback is anonymous)
  const { res, err } = await h.call(fb.submitFeedback, { user: ALEX, body: { category: 'Water', message: 'Tap in block C drips', rating: '4', suggestion: 'Fix it' } });
  assert.ifError(err);
  assert.strictEqual(res.code, 201);
  const ins = h.sqlLog.find((x) => /^INSERT INTO feedback/.test(x.sql));
  assert(ins, 'insert executed');
  assert.deepStrictEqual(ins.params, [4, 'water', 'Tap in block C drips', 'Fix it']);
  assert(!ins.params.includes(ALEX.id), 'must not store the user id');
  console.log('  PASS valid feedback stored anonymously');

  await h.call(fb.submitFeedback, { user: ALEX, body: { category: 'general', message: 'Nice app' } });
  const ins2 = [...h.sqlLog].reverse().find((x) => /^INSERT INTO feedback/.test(x.sql));
  assert.deepStrictEqual(ins2.params, [null, 'general', 'Nice app', null]);
  console.log('  PASS rating and suggestion are optional');

  let e = await bad('bad category', fb.submitFeedback, { user: ALEX, body: { category: 'nope', message: 'hello there' } }, 400);
  assert(e.extra.errors.category);
  e = await bad('message too short', fb.submitFeedback, { user: ALEX, body: { category: 'water', message: 'hi' } }, 400);
  assert(e.extra.errors.message);
  e = await bad('rating out of range', fb.submitFeedback, { user: ALEX, body: { category: 'water', message: 'hello there', rating: 9 } }, 400);
  assert(e.extra.errors.rating);
  await bad('rating not a whole number', fb.submitFeedback, { user: ALEX, body: { category: 'water', message: 'hello there', rating: '2.5' } }, 400);
  await bad('message too long', fb.submitFeedback, { user: ALEX, body: { category: 'water', message: 'x'.repeat(2001) } }, 400);

  // management list
  const list = await h.call(fb.listFeedback, { user: MGMT, query: { category: 'water', page: '1', limit: '10' } });
  assert.ifError(list.err);
  assert.strictEqual(list.res.body.summary.total, 2);
  assert.strictEqual(list.res.body.summary.averageRating, 4.3);
  assert.strictEqual(list.res.body.feedback[0].category, 'water');
  assert(!('user_id' in list.res.body.feedback[0]));
  console.log('  PASS management can list feedback (filter + summary)');
  await bad('bad category filter', fb.listFeedback, { user: MGMT, query: { category: 'zzz' } }, 400);

  // only management may read; routes are wired
  h.load('src/routes/index.js');
  const post = h.routes.find((r) => r.m === 'post' && r.h.includes(fb.submitFeedback));
  const get = h.routes.find((r) => r.m === 'get' && r.h.includes(fb.listFeedback));
  assert(post && get, 'feedback routes are registered');
  assert(get.h.length > post.h.length - 1, 'GET has an extra authorize() guard');
  console.log('  PASS POST /feedback and GET /feedback (management only) are wired');

  // race fix: deleting/editing a report that was just picked up gives 409, not a fake success
  const REPORT_ID = '11111111-1111-4111-8111-111111111111';
  h.db.handler = (sql) => {
    if (/FROM reports r\s*JOIN users u/.test(sql) || /^SELECT r\.\*, u\.username/.test(sql)) {
      return { rows: [{ id: REPORT_ID, report_code: 'EA-2026-0001', title: 't', category: 'Waste', description: 'long enough text', status: 'Pending', reporter_id: ALEX.id,
        reporter_username: 'alex', created_at: new Date(), updated_at: new Date() }] };
    }
    if (/^SELECT storage_path/.test(sql)) return { rows: [{ storage_path: 'reports/x/y.jpg' }] };
    if (/^DELETE FROM reports/.test(sql) || /^UPDATE reports/.test(sql)) return { rows: [], rowCount: 0 }; // someone else got there first
    return { rows: [], rowCount: 0 };
  };
  await bad('delete after pickup -> 409', report.deleteReport, { user: ALEX, params: { id: REPORT_ID } }, 409);
  await bad('edit after pickup -> 409', report.updateReport, { user: ALEX, params: { id: REPORT_ID }, body: { description: 'a new longer description' } }, 409);

  console.log('\nALL FEEDBACK TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
