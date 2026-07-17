-- ============================================================
-- NEW (student profile fields - request #4)
-- Adds the three optional profile columns used by "Edit Student
-- Profile" (Parent Name, Parent Phone, Address).
--
-- The server normally adds these AUTOMATICALLY at startup
-- (guarded, idempotent). Only run this file manually if the
-- server log says the database user lacks the ALTER privilege.
--
-- Safe to run more than once on MySQL 8+ (IF NOT EXISTS).
-- It does NOT touch any existing table/column/data.
-- ============================================================
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS parent_name  VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(50)  NULL,
    ADD COLUMN IF NOT EXISTS address      VARCHAR(255) NULL;
