const fs = require('fs/promises');
const path = require('path');

const LOCAL_DIR = path.join(__dirname, '..', '..', 'uploads');
const bucket = () => process.env.SUPABASE_BUCKET || 'report-photos';
const driver = () => (process.env.STORAGE_DRIVER || 'supabase').toLowerCase();

let client;
const getClient = () => {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env (or use STORAGE_DRIVER=local)');
    }
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
};
const setClient = (c) => { client = c; }; // used by tests

// Uploads one image. Returns { url, path }.
const uploadImage = async ({ buffer, mime, storagePath }) => {
  if (driver() === 'local') {
    const full = path.join(LOCAL_DIR, storagePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
    const base = process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`;
    return { url: `${base}/uploads/${storagePath}`, path: storagePath };
  }

  const b = getClient().storage.from(bucket());
  const { error } = await b.upload(storagePath, buffer, { contentType: mime, upsert: false });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  const { data } = b.getPublicUrl(storagePath);
  return { url: data.publicUrl, path: storagePath };
};

// Best-effort delete: never throws (a leftover file must not break the request).
const removeFiles = async (paths) => {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  try {
    if (driver() === 'local') {
      await Promise.all(
        list.map((p) => {
          const full = path.resolve(LOCAL_DIR, p);
          if (!full.startsWith(path.resolve(LOCAL_DIR) + path.sep)) return null; // path-traversal guard
          return fs.rm(full, { force: true });
        })
      );
    } else {
      const { error } = await getClient().storage.from(bucket()).remove(list);
      if (error) console.error('Storage cleanup failed:', error.message);
    }
  } catch (e) {
    console.error('Storage cleanup failed:', e.message);
  }
};

// Creates the bucket if it doesn't exist (used by scripts/setup-storage.js)
const ensureBucket = async () => {
  const s = getClient().storage;
  const { data } = await s.getBucket(bucket());
  if (data) return { created: false };
  const { error } = await s.createBucket(bucket(), {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  if (error) throw new Error(error.message);
  return { created: true };
};

module.exports = { uploadImage, removeFiles, ensureBucket, setClient, LOCAL_DIR, driver };
