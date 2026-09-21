// Creates the Supabase Storage bucket for report photos. Run once:  npm run setup:storage
require('dotenv').config();
const { ensureBucket } = require('../src/utils/storage');

ensureBucket()
  .then((r) => console.log(r.created ? 'Bucket created:' : 'Bucket already exists:', process.env.SUPABASE_BUCKET || 'report-photos'))
  .catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
