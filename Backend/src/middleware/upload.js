const multer = require('multer');

const MAX_PHOTOS = 5;
const MAX_MB = 5;

// Files are kept in memory, validated, then sent straight to storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: MAX_PHOTOS },
});

// Accepts the form field "photos" (or "photo"), up to 5 images total.
const uploadPhotos = upload.fields([
  { name: 'photos', maxCount: MAX_PHOTOS },
  { name: 'photo', maxCount: MAX_PHOTOS },
]);

module.exports = { uploadPhotos, MAX_PHOTOS, MAX_MB };
