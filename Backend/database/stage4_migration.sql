-- Stage 4: run in Supabase -> SQL Editor (safe to run more than once)
-- Adds: departments, assignment fields, and the internal workflow state.

-- 1. Departments (management picks one when assigning a report)
CREATE TABLE IF NOT EXISTS departments (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(80) NOT NULL UNIQUE
);

INSERT INTO departments (name) VALUES
  ('Staff & Asset Management'),
  ('Facilities Team'),
  ('Grounds & Waste'),
  ('Energy Management'),
  ('Water & Plumbing'),
  ('Campus Sanitation'),
  ('Climate Controls'),
  ('Campus Safety')
ON CONFLICT (name) DO NOTHING;

-- 2. A staff member belongs to (at most) one department
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;

-- 3. New report columns
--    workflow_state = what staff/management work with:
--      new -> assigned -> in_progress -> pending_review -> resolved
--    reports.status stays as the reporter's 3-value view (Pending / In Progress / Resolved)
--    and is always derived from workflow_state by the backend.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS workflow_state          VARCHAR(20);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS priority                VARCHAR(10) NOT NULL DEFAULT 'Medium';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS due_date                DATE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS department_id           INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS location_text           VARCHAR(200);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS assigned_at             TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS started_at              TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_submitted_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS review_note             TEXT;

-- 4. Fill workflow_state for reports that existed before this stage (only rows still empty)
UPDATE reports
   SET workflow_state = CASE status
                          WHEN 'Pending'     THEN 'new'
                          WHEN 'In Progress' THEN 'in_progress'
                          ELSE 'resolved'
                        END
 WHERE workflow_state IS NULL;

ALTER TABLE reports ALTER COLUMN workflow_state SET DEFAULT 'new';
ALTER TABLE reports ALTER COLUMN workflow_state SET NOT NULL;

-- 5. Allowed values
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_workflow_state_check') THEN
    ALTER TABLE reports ADD CONSTRAINT reports_workflow_state_check
      CHECK (workflow_state IN ('new', 'assigned', 'in_progress', 'pending_review', 'resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_priority_check') THEN
    ALTER TABLE reports ADD CONSTRAINT reports_priority_check
      CHECK (priority IN ('Low', 'Medium', 'High', 'Critical'));
  END IF;
END $$;

-- 6. Indexes for the staff / management lists
CREATE INDEX IF NOT EXISTS idx_reports_state       ON reports(workflow_state);
CREATE INDEX IF NOT EXISTS idx_reports_assigned_to ON reports(assigned_to);
CREATE INDEX IF NOT EXISTS idx_reports_department  ON reports(department_id);
CREATE INDEX IF NOT EXISTS idx_reports_due_date    ON reports(due_date);
CREATE INDEX IF NOT EXISTS idx_users_department    ON users(department_id);
