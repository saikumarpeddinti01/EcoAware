// Test harness: replaces express/pg/etc. with small fakes and provides an in-memory fake Postgres,
// so the workflow logic can be tested without a database or internet. Run: npm test
const Module = require('module');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const routes = [];          // recorded by the express stub
const sqlLog = [];          // every SQL statement executed
const problems = [];        // placeholder / syntax problems found in SQL

function checkSql(sql, params) {
  const nums = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  const max = nums.length ? Math.max(...nums) : 0;
  const used = new Set(nums);
  if (max !== (params || []).length) problems.push(`placeholder/param count mismatch (max $${max}, ${(params || []).length} params): ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
  for (let i = 1; i <= max; i++) if (!used.has(i)) problems.push(`unused/missing $${i}: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
  const open = (sql.match(/\(/g) || []).length, close = (sql.match(/\)/g) || []).length;
  if (open !== close) problems.push(`unbalanced parentheses: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
  if (/\?/.test(sql.replace(/'[^']*'/g, ''))) problems.push(`leftover ? in SQL: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
  if (/\$\{|undefined|\[object/.test(sql)) problems.push(`bad interpolation in SQL: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
}

const db = { handler: () => ({ rows: [] }) };
const runQuery = async (sql, params) => {
  checkSql(sql, params);
  sqlLog.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
  return db.handler(sql.replace(/\s+/g, ' ').trim(), params || []);
};
class FakePool {
  on() {}
  query(sql, params) { return runQuery(sql, params); }
  async connect() { return { query: (s, p) => runQuery(s, p), release() {} }; }
}

const mkRouter = () => {
  const r = { stack: [] };
  ['get', 'post', 'patch', 'delete', 'put'].forEach((m) => { r[m] = (p, ...h) => { r.stack.push({ m, p, h }); routes.push({ m, p, h, router: r }); return r; }; });
  r.use = (...a) => { r.stack.push({ m: 'use', a }); return r; };
  return r;
};
const stubs = {
  express: Object.assign(() => ({ use() {}, get() {} }), { Router: mkRouter, json: () => () => {}, urlencoded: () => () => {}, static: () => () => {} }),
  pg: { Pool: FakePool, types: { setTypeParser() {} } },
  bcryptjs: { hashSync: () => 'hash', hash: async () => 'hash', compare: async () => true },
  jsonwebtoken: { sign: () => 't', verify: () => ({}) },
  multer: Object.assign(() => ({ fields: () => (req, res, next) => next() }), { memoryStorage: () => ({}), MulterError: class extends Error {} }),
  'express-rate-limit': () => (req, res, next) => next(),
  nodemailer: { createTransport: () => ({ sendMail: async () => {} }) },
  '@supabase/supabase-js': { createClient: () => ({}) },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return origLoad.apply(this, arguments);
};

const call = async (handler, req) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
  let err = null;
  await new Promise((resolve) => {
    handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res, (e) => { err = e || null; resolve(); });
    // asyncHandler resolves after json; give microtasks a tick
    setTimeout(resolve, 30);
  });
  return { res, err };
};

module.exports = { ROOT, routes, sqlLog, problems, db, call, load: (p) => require(path.join(ROOT, p)) };
