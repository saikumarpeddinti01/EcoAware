const h = require('./harness');
process.env.NODE_ENV = 'test';
h.load('src/routes/index.js');
let bad = 0;
h.routes.forEach((r) => {
  const nonFn = r.h.filter((x) => typeof x !== 'function');
  if (nonFn.length) { bad++; console.log('BAD HANDLER', r.m, r.p, nonFn); }
});
console.log('routes registered:', h.routes.length, ' bad:', bad);
['staff', 'manage', 'departments'].forEach(() => {});
h.routes.filter((r) => /dashboard|incoming|resolved|assignments|team|claim|start|resolution|assign|review|history|monitor|^\/$/.test(r.p)).forEach((r) => console.log(' ', r.m.toUpperCase().padEnd(5), r.p));
