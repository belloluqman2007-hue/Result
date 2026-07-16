-- ============================================================
-- ADD-ON TABLES (manual setup - OPTIONAL)
-- ------------------------------------------------------------
-- The application creates these two tables AUTOMATICALLY at
-- startup (CREATE TABLE IF NOT EXISTS in server.js). This file
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
