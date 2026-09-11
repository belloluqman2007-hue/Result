-- ============================================================
-- SHARED ARABIC TIMETABLE (الجدول الدراسي) — manual setup (OPTIONAL)
-- ------------------------------------------------------------
-- The application creates this table AUTOMATICALLY at startup
-- (CREATE TABLE IF NOT EXISTS in server.js). This file is only
-- needed if your database user does NOT have CREATE privileges
-- and you prefer to create the table yourself.
--
-- It is a BRAND-NEW table. It stores the school's single shared
-- Arabic timetable document (all classes + letterhead config) so
-- a teacher's edits on one phone appear for every teacher and
-- the admin. It does NOT alter any existing table.
--
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS arabic_timetable (
    id INT PRIMARY KEY DEFAULT 1,
    doc LONGTEXT NOT NULL,
    updated_by VARCHAR(100) DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
