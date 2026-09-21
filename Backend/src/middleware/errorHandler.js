module.exports = (err, req, res, next) => {
  // Bad JSON body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body' });
  }
  // Upload problems (multer)
  if (err.name === 'MulterError') {
    const msg = {
      LIMIT_FILE_SIZE: 'Each photo must be 5 MB or smaller',
      LIMIT_FILE_COUNT: 'You can upload at most 5 photos',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field. Send photos in the "photos" field (max 5)',
    }[err.code] || err.message;
    return res.status(400).json({ success: false, message: msg });
  }
  // Postgres unique violation
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'That value is already in use' });
  }

  const status = err.status || 500;
  if (status >= 500) console.error(err);

  res.status(status).json({
    success: false,
    message: status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    ...(err.extra || {}),
  });
};
