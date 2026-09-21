const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const L = require('../utils/listing');

// Must match FEEDBACK_CATEGORIES in the front end (feedback.html).
const FEEDBACK_CATEGORIES = ['cleanliness', 'energy', 'water', 'general'];

/* ------------------------------------------------------------------ */
/* POST /api/feedback                 (any signed-in user)             */
/*   body: { category, message, rating?, suggestion? }                 */
/* Feedback is anonymous: we do NOT store who sent it.                 */
/* ------------------------------------------------------------------ */
exports.submitFeedback = asyncHandler(async (req, res) => {
  const category = String(req.body.category || '').trim().toLowerCase();
  const message = String(req.body.message || '').trim();
  const suggestion = String(req.body.suggestion || '').trim();

  const errors = {};
  if (!FEEDBACK_CATEGORIES.includes(category)) errors.category = `Category must be one of: ${FEEDBACK_CATEGORIES.join(', ')}`;
  if (message.length < 5) errors.message = 'Please tell us a little more (at least 5 characters)';
  else if (message.length > 2000) errors.message = 'Feedback must be 2000 characters or less';
  if (suggestion.length > 2000) errors.suggestion = 'Suggestions must be 2000 characters or less';

  let rating = null;
  if (req.body.rating !== undefined && req.body.rating !== null && String(req.body.rating).trim() !== '') {
    rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = 'Rating must be a whole number from 1 to 5';
  }
  if (Object.keys(errors).length) throw new AppError('Please fix the highlighted fields', 400, { errors });

  await query('INSERT INTO feedback (rating, category, message, suggestion) VALUES ($1, $2, $3, $4)', [
    rating,
    category,
    message,
    suggestion || null,
  ]);
  res.status(201).json({ success: true, message: 'Thank you for your feedback' });
});

/* ------------------------------------------------------------------ */
/* GET /api/feedback?category=&page=&limit=       (management only)    */
/* ------------------------------------------------------------------ */
exports.listFeedback = asyncHandler(async (req, res) => {
  const f = L.makeFilters();
  if (req.query.category) {
    const category = String(req.query.category).trim().toLowerCase();
    if (!FEEDBACK_CATEGORIES.includes(category)) {
      throw new AppError(`Invalid category. Use one of: ${FEEDBACK_CATEGORIES.join(', ')}`, 400);
    }
    f.add('category = ?', category);
  }
  const paging = L.parsePaging(req.query);

  const [rows, stats] = await Promise.all([
    query(
      `SELECT id, rating, category, message, suggestion, created_at FROM feedback ${f.where}
        ORDER BY created_at DESC, id LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      f.params
    ),
    query(`SELECT COUNT(*)::int AS total, AVG(rating)::float8 AS avg_rating FROM feedback ${f.where}`, f.params),
  ]);

  const s = stats.rows[0];
  res.json({
    success: true,
    summary: { total: s.total, averageRating: s.avg_rating === null ? null : Math.round(s.avg_rating * 10) / 10 },
    feedback: rows.rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      category: r.category,
      message: r.message,
      suggestion: r.suggestion,
      createdAt: r.created_at,
    })),
    pagination: L.pagingOut(paging, s.total),
  });
});

exports.FEEDBACK_CATEGORIES = FEEDBACK_CATEGORIES;
