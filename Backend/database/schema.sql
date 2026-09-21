-- Eco Ware database schema (run in Supabase -> SQL Editor)
-- Tables are created now so the design is fixed; we use them from Stage 2 onward.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  phone         VARCHAR(20),
  password_hash TEXT         NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'reporter'
                CHECK (role IN ('reporter', 'staff', 'management')),
  is_verified   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_code     VARCHAR(20) UNIQUE,              -- e.g. EA-2026-0001
  reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(150) NOT NULL,
  category        VARCHAR(30)  NOT NULL
                  CHECK (category IN ('Waste', 'Water', 'Energy', 'Other')),
  description     TEXT NOT NULL,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  status          VARCHAR(20) NOT NULL DEFAULT 'Pending'
                  CHECK (status IN ('Pending', 'In Progress', 'Resolved')),
  assigned_to     UUID REFERENCES users(id),
  resolved_by     VARCHAR(150),
  action_taken    TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  type        VARCHAR(10) NOT NULL DEFAULT 'reported'
              CHECK (type IN ('reported', 'before', 'after')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Powers the "Resolution Progress" timeline
CREATE TABLE IF NOT EXISTS report_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  step        VARCHAR(30) NOT NULL,   -- Report Submitted / Under Review / Team Assigned / Work In Progress / Resolved
  note        TEXT,
  changed_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
  category    VARCHAR(50) NOT NULL,
  message     TEXT NOT NULL,
  suggestion  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()   -- no user_id: feedback is anonymous
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_status   ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category);
CREATE INDEX IF NOT EXISTS idx_history_report   ON report_status_history(report_id);
