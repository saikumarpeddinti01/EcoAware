-- Stage 4b: run in Supabase -> SQL Editor (safe to run more than once)
-- Allows the "Safety" category that the staff and management screens use.

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'reports'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE reports DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE reports ADD CONSTRAINT reports_category_check
  CHECK (category IN ('Waste', 'Water', 'Energy', 'Safety', 'Other'));
