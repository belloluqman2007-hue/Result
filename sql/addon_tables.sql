-- ============================================================
-- ADD-ON TABLES (manual setup - OPTIONAL)
-- ------------------------------------------------------------
-- The application creates these tables AUTOMATICALLY at startup
-- (CREATE TABLE IF NOT EXISTS in server.js). This file
-- is only needed if your database user does NOT have CREATE
-- privileges and you prefer to create the tables yourself.
--
-- These are BRAND-NEW tables. They add features (notice board,
-- calendar events) and do NOT alter any existing table.
-- ============================================================

-- Notice board / school announcements shown on the dashboard
CREATE TABLE IF NOT EXISTS announcements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- School calendar events for the dashboard calendar widget
CREATE TABLE IF NOT EXISTS school_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    event_date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Verified sibling links for the parent portal child switcher. Each link is
-- stored in both directions by the application, so a family can log in with
-- any child's credentials and recover the same linked-child list.
CREATE TABLE IF NOT EXISTS portal_family_links (
    student_id VARCHAR(100) NOT NULL,
    linked_student_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, linked_student_id),
    KEY idx_family_linked_student (linked_student_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
