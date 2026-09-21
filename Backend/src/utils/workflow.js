const AppError = require('./AppError');

/* ------------------------------------------------------------------
   The life of a report (workflow_state):

     new  --assign/claim-->  assigned  --start-->  in_progress
                                 \                     |
                                  \--------submit------+--> pending_review
                                                             |        |
                                                     approve |        | request more info
                                                             v        v
                                                         resolved   in_progress

   The reporter never sees these states. They see reports.status:
   Pending / In Progress / Resolved, which we derive with statusFor().
------------------------------------------------------------------- */

const CATEGORIES = ['Waste', 'Water', 'Energy', 'Safety', 'Other'];
const STATES = ['new', 'assigned', 'in_progress', 'pending_review', 'resolved'];

const STATE_LABELS = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In progress',
  pending_review: 'Pending review',
  resolved: 'Resolved',
};

const REPORTER_STATUS = {
  new: 'Pending',
  assigned: 'In Progress',
  in_progress: 'In Progress',
  pending_review: 'In Progress',
  resolved: 'Resolved',
};

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

// Used only when a staff member claims a report without choosing a due date.
const DEFAULT_DUE_DAYS = { Critical: 1, High: 2, Medium: 5, Low: 7 };

const TRANSITIONS = {
  assign: { from: ['new', 'assigned'], to: 'assigned' },
  claim: { from: ['new', 'assigned'], to: 'assigned' },
  start: { from: ['assigned'], to: 'in_progress' },
  submit: { from: ['assigned', 'in_progress'], to: 'pending_review' },
  approve: { from: ['pending_review'], to: 'resolved' },
  requestInfo: { from: ['pending_review'], to: 'in_progress' },
};

const WHY_NOT = {
  assign: 'Only reports that have not been started can be assigned',
  claim: 'Only reports that have not been started can be claimed',
  start: 'Only assigned reports that have not been started can be started',
  submit: 'A resolution can only be submitted while the work is assigned or in progress',
  approve: 'Only reports waiting for review can be approved',
  requestInfo: 'Only reports waiting for review can be sent back for more information',
};

const statusFor = (state) => REPORTER_STATUS[state];

// Returns the state the report moves to, or throws 409 if the move is not allowed.
const nextState = (action, current) => {
  const t = TRANSITIONS[action];
  if (!t) throw new Error(`Unknown workflow action: ${action}`);
  if (!t.from.includes(current)) {
    throw new AppError(`${WHY_NOT[action]} (this report is currently "${STATE_LABELS[current] || current}")`, 409);
  }
  return t.to;
};

/* ---------------- normalisers ---------------- */

const normCategory = (c) => CATEGORIES.find((x) => x.toLowerCase() === String(c || '').trim().toLowerCase()) || null;

const normPriority = (p) => PRIORITIES.find((x) => x.toLowerCase() === String(p || '').trim().toLowerCase()) || null;

// Accepts "in_progress", "in progress", "In-Progress", "all"...  Returns a state or null (= no filter).
const normState = (s) => {
  const k = String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!k || k === 'all') return null;
  if (!STATES.includes(k)) throw new AppError(`Invalid status. Use one of: all, ${STATES.join(', ')}`, 400);
  return k;
};

/* ---------------- dates (plain YYYY-MM-DD strings) ---------------- */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (s) => {
  if (!ISO_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// A due date must be a real date that is not in the past.
const parseDueDate = (raw, field = 'dueDate') => {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!isRealDate(s)) {
    throw new AppError('Please fix the highlighted fields', 400, { errors: { [field]: 'Use a valid date in YYYY-MM-DD format' } });
  }
  if (s < todayISO()) {
    throw new AppError('Please fix the highlighted fields', 400, { errors: { [field]: 'The due date cannot be in the past' } });
  }
  return s;
};

// A date used to filter a list (past dates are fine).
const parseFilterDate = (raw, field) => {
  const s = String(raw).trim();
  if (!isRealDate(s)) throw new AppError(`Invalid ${field}. Use YYYY-MM-DD`, 400, { errors: { [field]: 'Use YYYY-MM-DD' } });
  return s;
};

module.exports = {
  CATEGORIES,
  STATES,
  STATE_LABELS,
  PRIORITIES,
  DEFAULT_DUE_DAYS,
  statusFor,
  nextState,
  normCategory,
  normPriority,
  normState,
  isRealDate,
  todayISO,
  addDays,
  parseDueDate,
  parseFilterDate,
};
