-- Stage 3: run in Supabase -> SQL Editor (safe to run more than once)

-- Gives every report a friendly ID like EA-2026-0001
CREATE SEQUENCE IF NOT EXISTS report_code_seq START 1;

-- Remember where each photo lives in storage so we can delete it later
ALTER TABLE report_photos ADD COLUMN IF NOT EXISTS storage_path TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_report ON report_photos(report_id);
