require("dotenv").config();

const express = require("express");
const path = require("path");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const connection = require("./db");

const app = express();
app.use(express.json());

const isProduction = process.env.NODE_ENV === "production";

// Railway (and most hosting platforms) sit your app behind a proxy that
// terminates HTTPS before forwarding to your app over plain HTTP. Without
// this, Express never recognizes the connection as secure, so a
// secure-only session cookie silently fails to persist - causing an
// infinite bounce back to the login page after a successful login.
if (isProduction) {
    app.set("trust proxy", 1);
}

if (!process.env.SESSION_SECRET) {
    console.log("WARNING: SESSION_SECRET is not set in your environment. Using an insecure default - fine for local development, but you MUST set a real SESSION_SECRET before deploying this online.");
}

app.use(session({
    secret: process.env.SESSION_SECRET || "local-dev-only-insecure-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 8, // 8 hour session
        secure: isProduction, // only send cookie over HTTPS in production
        httpOnly: true
    }
}));

// Auth guard: blocks access to protected pages/routes if not logged in
function requireLogin(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    // For page requests, redirect to login. For API requests, send 401.
    if (req.headers.accept && req.headers.accept.includes("text/html")) {
        return res.redirect("/login.html");
    }
    return res.status(401).json({ message: "Not logged in" });
}

// Auth guard for admin-only actions
function requireAdmin(req, res, next) {
    if (req.session && req.session.role === "admin") {
        return next();
    }
    return res.status(403).json({ message: "Admin access required" });
}


/* =====================================================================
   NEW (pack 13 - Student/Parent portal + publish gate, owner request)
   ---------------------------------------------------------------------
   "The result can show to student or parents except it is been publish
   by admin". STAFF behaviour is 100% UNCHANGED (they skip every gate).
   Everyone else must log in with Student ID + surname, may view ONLY
   their own child, and ONLY terms an admin has published.
   ===================================================================== */
function checkPublished(className, term, schoolSession, cb) {
    connection.query(
        "SELECT published FROM result_publish WHERE term = ? AND session = ? AND (class_name = ? OR class_name = '') LIMIT 4",
        [term, schoolSession, className],
        (err, rows) => {
            if (err) return cb(err);
            cb(null, (rows || []).some(r => Number(r.published) === 1));
        }
    );
}

// Owner-only gate (basic records: student info / position). Staff skip it.
function portalOwnerGate(req, res, next) {
    if (req.session && req.session.userId) return next(); // staff: untouched
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(403).json({ message: "Please log in as a student or parent first." });
    // FIX (pack 13): compare trimmed + case-insensitively ('AM' vs 'Am ')
    if (String(sid).trim().toLowerCase() !== String(req.params.studentId).trim().toLowerCase()) {
        return res.status(403).json({ message: "You can only view your own child's record." });
    }
    next();
}

// Result gate (score sheets). Staff skip it; portal users need OWN child
// + a published term/session.
function publishResultGate(req, res, next) {
    if (req.session && req.session.userId) return next(); // staff: FULL old behaviour
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(403).json({ message: "Please log in as a student or parent to check results." });
    // FIX (pack 13): compare trimmed + case-insensitively ('AM' vs 'Am ')
    if (String(sid).trim().toLowerCase() !== String(req.params.studentId).trim().toLowerCase()) {
        return res.status(403).json({ message: "You can only view your own result." });
    }
    const term = req.query.term;
    const schoolSession = req.query.session;
    if (!term || !schoolSession) {
        return res.status(403).json({ message: "Pick a published term and session." });
    }
    connection.query("SELECT class_name FROM students WHERE student_id = ?", [sid], (err, rows) => {
        if (err || !rows.length) return res.status(403).json({ message: "Student record not found." });
        checkPublished(rows[0].class_name, term, schoolSession, (err2, published) => {
            if (err2) { console.log(err2); return res.status(500).json({ message: "Database error" }); }
            if (!published) {
                return res.status(403).json({ message: "This result has not been published by the school yet. Please check back later." });
            }
            next();
        });
    });
}


// NEW (pack 14): admin-only PAGE guard - teachers are sent back to their
// dashboard instead of seeing finance / publish / admissions / settings.
// (API-level guard stays requireAdmin; this one just redirects pages.)
function requireAdminPage(req, res, next) {
    if (req.session && req.session.userId) {
        if (req.session.role === "admin") return next();
        return res.redirect("teacher-dashboard.html");
    }
    if (req.headers.accept && req.headers.accept.includes("text/html")) {
        return res.redirect("/login.html");
    }
    return res.status(401).json({ message: "Not logged in" });
}

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Username and password required" });
    }

    connection.query(
        "SELECT * FROM users WHERE username = ?",
        [username],
        (err, results) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Database error" });
            }
            if (results.length === 0) {
                return res.status(401).json({ message: "Invalid username or password" });
            }

            const user = results[0];

            bcrypt.compare(password, user.password_hash, (err, match) => {
                if (err || !match) {
                    return res.status(401).json({ message: "Invalid username or password" });
                }

                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.role = user.role;

                res.json({
                    message: "Login successful",
                    role: user.role
                });
            });
        }
    );
});

app.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ message: "Logged out" });
    });
});

app.get("/me", (req, res) => {
    if (req.session && req.session.userId) {
        res.json({
            loggedIn: true,
            username: req.session.username,
            role: req.session.role
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// Protect the dashboard pages - must come before express.static
app.get("/teacher-dashboard.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "teacher-dashboard.html"));
});

app.get("/add-student.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "add-student.html"));
});

app.get("/add-subject.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "add-subject.html"));
});

app.get("/manage-signatures.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "manage-signatures.html"));
});



// ----------------------------------------------------------------
// NEW (pack 13): protect the new management pages exactly like the
// existing dashboard pages. Must stay BEFORE express.static.
// ----------------------------------------------------------------
app.get("/manage-publish.html", requireAdminPage, (req, res) => { // CHANGED (pack 14): admin-only (owner request: teachers must not access)
    res.sendFile(path.join(__dirname, "manage-publish.html"));
});

app.get("/manage-admissions.html", requireAdminPage, (req, res) => { // CHANGED (pack 14): admin-only (owner request: teachers must not access)
    res.sendFile(path.join(__dirname, "manage-admissions.html"));
});

app.get("/attendance.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "attendance.html"));
});

app.get("/staff-attendance.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "staff-attendance.html"));
});

app.get("/finance.html", requireAdminPage, (req, res) => { // CHANGED (pack 14): admin-only (owner request: teachers must not access)
    res.sendFile(path.join(__dirname, "finance.html"));
});

app.get("/manage-users.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(__dirname, "manage-users.html"));
});

app.get("/school-settings.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(__dirname, "school-settings.html"));
});

app.get("/id-card.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "id-card.html"));
});

app.get("/create-exam.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "create-exam.html"));
});

app.get("/students.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "students.html"));
});

// ----------------------------------------------------------------
// NEW (whole-class results page): serves the broadsheet page where
// staff pick Class + Session + Term and download ONE combined PDF.
// READ-ONLY: the page only SELECTs existing results. Additive.
// ----------------------------------------------------------------
app.get("/class-results.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "class-results.html"));
});

// ----------------------------------------------------------------
// NEW (PWA conversion): serve the app manifest with the correct
// content type so every browser accepts it. ADDITIVE ONLY - no
// existing route, page or query is modified. (Public, like login.)
// ----------------------------------------------------------------
app.get("/manifest.webmanifest", (req, res) => {
    res.type("application/manifest+json");
    res.sendFile(path.join(__dirname, "manifest.webmanifest"));
});

app.use(express.static(__dirname));

/* ==================================================================
   ADD-ON MODULE  (added by the UI modernization project)
   ------------------------------------------------------------------
   ADDITIVE ONLY. This block:
     - creates TWO brand-new tables (announcements, school_events)
       with CREATE TABLE IF NOT EXISTS - it never alters, renames,
       or touches any existing table (students, results, users, ...)
     - exposes NEW endpoints whose names do not collide with any
       existing route: /students, /dashboard-stats, /recent-activity,
       /api/announcements, /api/events
     - performs READ-ONLY SELECTs against existing tables (for the
       dashboard widgets). The result system is never written to
       outside the original routes.
================================================================== */

const addonTables = [
    // Notice board / school news for the dashboard
    `CREATE TABLE IF NOT EXISTS announcements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        body TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // School calendar events shown on the dashboard calendar widget
    `CREATE TABLE IF NOT EXISTS school_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        event_date DATE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // NEW (per-class class-teacher signatures, owner request): MANY class
    // teacher signatures - one assigned per class - so each class's report
    // cards stamp ITS OWN teacher's signature ("appear on class teacher
    // class, not just random class"). The old signatures table and its
    // shared "class_teacher" role stay as the fallback for classes with
    // nothing assigned. Purely additive - no existing table/column touched.
    `CREATE TABLE IF NOT EXISTS class_teacher_signatures (
        class_name VARCHAR(150) PRIMARY KEY,
        signature_path VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    // NEW (pack 13 - results publish gate): class_name '' = WHOLE TERM
    // (admin publishes every class at once; per-class rows publish one
    // class only). Whole-term wins by design (owner decision).
    `CREATE TABLE IF NOT EXISTS result_publish (
        class_name VARCHAR(150) NOT NULL DEFAULT '',
        term VARCHAR(50) NOT NULL,
        session VARCHAR(50) NOT NULL,
        published TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (class_name, term, session)
    )`,
    // NEW (pack 13 - admission enquiries from the school website):
    // visitors register interest; management reviews and admits.
    `CREATE TABLE IF NOT EXISTS admission_enquiries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        child_name VARCHAR(255) NOT NULL,
        parent_name VARCHAR(255),
        phone VARCHAR(50),
        class_applied VARCHAR(150),
        message TEXT,
        status ENUM('new','contacted','admitted') NOT NULL DEFAULT 'new',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // NEW (pack 13 - student attendance): one row per student per day.
    `CREATE TABLE IF NOT EXISTS attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id VARCHAR(100) NOT NULL,
        class_name VARCHAR(150) NOT NULL,
        att_date DATE NOT NULL,
        status ENUM('present','absent','late') NOT NULL DEFAULT 'present',
        marked_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_student_day (student_id, att_date)
    )`,
    // NEW (pack 13 - staff attendance): one row per staff per day.
    `CREATE TABLE IF NOT EXISTS staff_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        staff_username VARCHAR(100) NOT NULL,
        att_date DATE NOT NULL,
        status ENUM('present','absent') NOT NULL DEFAULT 'present',
        marked_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_staff_day (staff_username, att_date)
    )`,
    // NEW (pack 13 - weekly teacher evaluations).
    `CREATE TABLE IF NOT EXISTS staff_evaluations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        staff_username VARCHAR(100) NOT NULL,
        week_start DATE NOT NULL,
        teaching TINYINT,
        punctuality TINYINT,
        conduct TINYINT,
        comment TEXT,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // NEW (pack 13 - finance: fee structure per class per term/session).
    `CREATE TABLE IF NOT EXISTS fee_structure (
        id INT AUTO_INCREMENT PRIMARY KEY,
        class_name VARCHAR(150) NOT NULL,
        term VARCHAR(50) NOT NULL,
        session VARCHAR(50) NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_class_term_session (class_name, term, session)
    )`,
    // NEW (pack 13 - finance: fee payments received).
    `CREATE TABLE IF NOT EXISTS fee_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id VARCHAR(100) NOT NULL,
        term VARCHAR(50) NOT NULL,
        session VARCHAR(50) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        method VARCHAR(60),
        note VARCHAR(255),
        received_by VARCHAR(100),
        paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // NEW (pack 14 - school settings, admin editable profile: name,
    // Arabic name, motto, address, phones, email). Single row (id = 1).
    `CREATE TABLE IF NOT EXISTS school_settings (
        id INT PRIMARY KEY,
        school_name VARCHAR(255),
        school_name_ar VARCHAR(255),
        motto VARCHAR(255),
        motto_ar VARCHAR(255),
        address VARCHAR(255),
        phone1 VARCHAR(50),
        phone2 VARCHAR(50),
        email VARCHAR(120),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    // NEW (pack 14 - academic sessions the admin creates, e.g. 2027/2028).
    `CREATE TABLE IF NOT EXISTS sessions (
        session VARCHAR(50) PRIMARY KEY,
        is_current TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // NEW (pack 13 - finance: school expenses).
    `CREATE TABLE IF NOT EXISTS expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        amount DECIMAL(12,2) NOT NULL,
        spent_on DATE,
        note VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
];

// Provisions ONLY the two add-on tables. Deliberately uses its own
// short-lived connection (never the shared one from db.js) so that:
//   - nothing about the existing app's DB behaviour can change, and
//   - it can self-heal after "MySQL not ready yet" cold-start races.
// Retries a few times, then gives up gracefully: the rest of the app
// (login, results, exams, ...) is completely unaffected either way.
const mysql2 = require("mysql2");

function addonConnection() {
    return mysql2.createConnection({
        host: process.env.MYSQLHOST || process.env.DB_HOST || "localhost",
        port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
        user: process.env.MYSQLUSER || process.env.DB_USER || "root",
        password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "0802",
        database: process.env.MYSQLDATABASE || process.env.DB_NAME || "railway"
    });
}

function addonRetryLater(attempt, err) {
    const reason = err.code || err.message || err;
    if (attempt >= 4) {
        console.log("Add-on setup warning: could not auto-create add-on tables after 4 attempts. Reason:", reason);
        console.log("  -> The app keeps working normally; only the Notice Board / Events / Calendar widgets will be unavailable.");
        if (reason === "ER_DBACCESS_DENIED_ERROR" || reason === "ER_TABLEACCESS_DENIED_ERROR") {
            console.log("  -> Cause: the database user has no CREATE privilege.");
        }
        console.log("  -> Fix: run the SQL in sql/addon_tables.sql against your database (or grant CREATE), then restart.");
        return;
    }
    console.log(`Add-on setup: attempt ${attempt} failed (${reason}); retrying in 4s...`);
    setTimeout(() => setupAddonTables(attempt + 1), 4000);
}

function setupAddonTables(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) {
            conn.destroy();
            return addonRetryLater(attempt, err);
        }
        let firstFailure = null;
        let finished = 0;
        addonTables.forEach((sql) => {
            conn.query(sql, (qErr) => {
                if (qErr && !firstFailure) firstFailure = qErr;
                finished++;
                if (finished === addonTables.length) {
                    conn.end();
                    if (firstFailure) return addonRetryLater(attempt, firstFailure);
                    console.log("Add-on tables ready (announcements, school_events, class_teacher_signatures, result_publish, admission_enquiries, attendance, staff_attendance, staff_evaluations, fee_structure, fee_payments, expenses, school_settings, sessions).");
                }
            });
        });
    });
}

setupAddonTables(1);

/* ==================================================================
   NEW (student profile fields - request #4): parent_name,
   parent_phone, address columns on the students table.
   ------------------------------------------------------------------
   Why this is here: the requested "Edit Student Profile" feature
   (parent name, parent phone, address) needs somewhere to live.
   This is the ONLY structural change in this update, and it is:
     - ADDITIVE: three NULL-able columns are APPENDED; no existing
       table, column, route or query is renamed or changed.
     - GUARDED: it first ASKS information_schema which columns exist,
       so it runs the ALTER once only and never errors on re-boots.
     - GRACEFUL: if the DB user has no ALTER privilege, the app keeps
       working exactly as before; editing of the 3 new fields is
       simply skipped (flag below stays false).
   The result system is untouched by this.
================================================================== */
let studentProfileColsReady = false;

function ensureStudentProfileColumns(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) {
            conn.destroy();
            return profileColsRetry(attempt, err);
        }
        conn.query(
            `SELECT COUNT(*) AS c
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'students'
               AND COLUMN_NAME IN ('parent_name', 'parent_phone', 'address')`,
            (qErr, rows) => {
                if (qErr) {
                    conn.end();
                    return profileColsRetry(attempt, qErr);
                }
                if (rows && rows[0] && Number(rows[0].c) === 3) {
                    conn.end();
                    studentProfileColsReady = true;
                    console.log("Student profile columns ready (parent_name, parent_phone, address).");
                    return;
                }
                // Columns missing - add them in ONE idempotent statement.
                conn.query(
                    `ALTER TABLE students
                        ADD COLUMN parent_name  VARCHAR(255) NULL,
                        ADD COLUMN parent_phone VARCHAR(50)  NULL,
                        ADD COLUMN address      VARCHAR(255) NULL`,
                    (aErr) => {
                        conn.end();
                        if (aErr) {
                            // Another boot raced us and added them first - treat as done.
                            if (aErr.code === "ER_DUP_FIELDNAME") {
                                studentProfileColsReady = true;
                                console.log("Student profile columns ready (added by a parallel boot).");
                                return;
                            }
                            return profileColsRetry(attempt, aErr);
                        }
                        studentProfileColsReady = true;
                        console.log("Student profile columns added (parent_name, parent_phone, address).");
                    }
                );
            }
        );
    });
}

function profileColsRetry(attempt, err) {
    const reason = err.code || err.message || err;
    if (attempt >= 3) {
        console.log("Student profile setup warning: could not add the 3 profile columns. Reason:", reason);
        console.log("  -> Everything keeps working; only Parent Name / Parent Phone / Address editing stays off.");
        console.log("  -> Fix: run the SQL in sql/student_profile_columns.sql, then restart.");
        return;
    }
    console.log(`Student profile setup: attempt ${attempt} failed (${reason}); retrying in 4s...`);
    setTimeout(() => ensureStudentProfileColumns(attempt + 1), 4000);
}

ensureStudentProfileColumns(1);

/* ==================================================================
   NEW (subject enable/disable - request #3): is_active column on the
   subjects table. Same guarded/idempotent pattern as above: check
   information_schema first, add once, fall back gracefully. When the
   column is missing the app behaves exactly as before (all subjects
   visible everywhere).
================================================================== */
let subjectActiveColReady = false;

function ensureSubjectActiveColumn(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) {
            conn.destroy();
            return subjectActiveRetry(attempt, err);
        }
        conn.query(
            `SELECT COUNT(*) AS c
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'subjects'
               AND COLUMN_NAME = 'is_active'`,
            (qErr, rows) => {
                if (qErr) {
                    conn.end();
                    return subjectActiveRetry(attempt, qErr);
                }
                if (rows && rows[0] && Number(rows[0].c) === 1) {
                    conn.end();
                    subjectActiveColReady = true;
                    console.log("Subject is_active column ready.");
                    return;
                }
                conn.query(
                    `ALTER TABLE subjects ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1`,
                    (aErr) => {
                        conn.end();
                        if (aErr) {
                            if (aErr.code === "ER_DUP_FIELDNAME") {
                                subjectActiveColReady = true;
                                console.log("Subject is_active column ready (added by a parallel boot).");
                                return;
                            }
                            return subjectActiveRetry(attempt, aErr);
                        }
                        subjectActiveColReady = true;
                        console.log("Subject is_active column added.");
                    }
                );
            }
        );
    });
}

function subjectActiveRetry(attempt, err) {
    const reason = err.code || err.message || err;
    if (attempt >= 3) {
        console.log("Subject setup warning: could not add the is_active column. Reason:", reason);
        console.log("  -> Everything keeps working; the Enable/Disable switch just stays off.");
        return;
    }
    console.log(`Subject setup: attempt ${attempt} failed (${reason}); retrying in 4s...`);
    setTimeout(() => ensureSubjectActiveColumn(attempt + 1), 4000);
}

ensureSubjectActiveColumn(1);

// Friendly fallback for add-on endpoints when the add-on tables do not
// exist yet (setup above failed and sql/addon_tables.sql was not run).
function addonTableMissing(res, err, verb) {
    if (err && err.code === "ER_NO_SUCH_TABLE") {
        return res.status(503).json({
            message: `Could not ${verb}: notice board / events storage is not initialised yet. Run the SQL in sql/addon_tables.sql and restart.`
        });
    }
    return null;
}

// Helper: run a widget query that must NEVER crash the dashboard -
// on error it logs and resolves with an empty array instead.
function safeQuery(sql, params) {
    return new Promise((resolve) => {
        connection.query(sql, params || [], (err, rows) => {
            if (err) {
                console.log("Dashboard widget query failed:", err.code || err);
                return resolve([]);
            }
            resolve(rows);
        });
    });
}

function countOf(rows) {
    return rows && rows[0] ? Number(rows[0].c) : 0;
}

// Aggregated stats for the NEW dashboard cards + charts.
// All SELECTs below are read-only and do not modify any data.
app.get("/dashboard-stats", requireLogin, async (req, res) => {
    try {
        const students = await safeQuery(`SELECT COUNT(*) AS c FROM students`);
        const subjects = await safeQuery(`SELECT COUNT(*) AS c FROM subjects`);
        const results  = await safeQuery(`SELECT COUNT(*) AS c FROM results`);
        const classes  = await safeQuery(`SELECT COUNT(*) AS c FROM classes`);
        const staff    = await safeQuery(`SELECT COUNT(*) AS c FROM users`);
        const exams    = await safeQuery(`SELECT COUNT(*) AS c FROM exams`);

        const studentsPerClass = await safeQuery(
            `SELECT class_name, COUNT(*) AS count
             FROM students
             GROUP BY class_name
             ORDER BY count DESC
             LIMIT 14`
        );

        const gradeDistribution = await safeQuery(
            `SELECT grade, COUNT(*) AS count
             FROM results
             GROUP BY grade`
        );

        res.json({
            students: countOf(students),
            subjects: countOf(subjects),
            results:  countOf(results),
            classes:  countOf(classes),
            staff:    countOf(staff),
            exams:    countOf(exams),
            studentsPerClass,
            gradeDistribution
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Could not load dashboard stats." });
    }
});

// Recent activity feed - composed from READ-ONLY queries on existing
// tables (latest saved results, updated exams, signatures on file).
app.get("/recent-activity", requireLogin, async (req, res) => {
    const items = [];

    const latestResults = await safeQuery(
        `SELECT student_name, subject, term, session, class_name
         FROM results ORDER BY id DESC LIMIT 5`
    );
    latestResults.forEach((r) => {
        items.push({
            type: "result",
            text: `Result saved: ${r.student_name} - ${r.subject} (${r.class_name}, ${r.term}, ${r.session})`,
            when: null
        });
    });

    const latestExams = await safeQuery(
        `SELECT title, updated_at FROM exams ORDER BY updated_at DESC LIMIT 3`
    );
    latestExams.forEach((x) => {
        items.push({
            type: "exam",
            text: `Exam saved/updated: "${x.title}"`,
            when: x.updated_at || null
        });
    });

    const signatures = await safeQuery(
        `SELECT role, updated_at FROM signatures`
    );
    signatures.forEach((s) => {
        items.push({
            type: "signature",
            text: `${s.role === "class_teacher" ? "Class Teacher" : "Principal"} signature is on file`,
            when: s.updated_at || null
        });
    });

    // Items with timestamps first (newest), then the rest
    items.sort((a, b) => {
        const ta = a.when ? new Date(a.when).getTime() : Infinity;
        const tb = b.when ? new Date(b.when).getTime() : Infinity;
        return tb - ta;
    });

    res.json(items.slice(0, 10));
});

// NEW: full student list for the read-only Students Directory page.
// (Named /students to complement - not replace - the existing
//  single-student route /student/:studentId, which is untouched.)
app.get("/students", requireLogin, (req, res) => {
    // NEW (student profile fields): when the 3 profile columns exist,
    // include them so the profile viewer / edit form is complete.
    // If they don't (older DB), fall back to the ORIGINAL query -
    // the response shape stays backward compatible either way.
    const baseCols = "student_id, full_name, gender, class_name, date_of_birth, photo_path";
    const cols = studentProfileColsReady
        ? baseCols + ", parent_name, parent_phone, address"
        : baseCols;

    connection.query(
        `SELECT ${cols} FROM students ORDER BY class_name, full_name`,
        (err, rows) => {
            if (err) {
                // Safety net: columns vanished/flag wrong - retry with the original list.
                if (err.code === "ER_BAD_FIELD_ERROR" && cols !== baseCols) {
                    return connection.query(
                        `SELECT ${baseCols} FROM students ORDER BY class_name, full_name`,
                        (err2, rows2) => {
                            if (err2) {
                                console.log(err2);
                                return res.status(500).send("Database Error");
                            }
                            res.json(rows2);
                        }
                    );
                }
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json(rows);
        }
    );
});

/* ---------------- Announcements (notice board) ---------------- */

app.get("/api/announcements", requireLogin, (req, res) => {
    connection.query(
        `SELECT id, title, body, created_at
         FROM announcements ORDER BY created_at DESC LIMIT 50`,
        (err, rows) => {
            if (err) {
                console.log(err);
                const handled = addonTableMissing(res, err, "load announcements");
                if (handled) return handled;
                return res.status(500).json({ message: "Could not load announcements." });
            }
            res.json(rows);
        }
    );
});

app.post("/api/announcements", requireLogin, (req, res) => {
    const title = (req.body.title || "").trim();
    const body = (req.body.body || "").trim();

    if (!title) {
        return res.status(400).json({ message: "Announcement title is required." });
    }

    connection.query(
        `INSERT INTO announcements (title, body) VALUES (?, ?)`,
        [title, body],
        (err, result) => {
            if (err) {
                console.log(err);
                const handled = addonTableMissing(res, err, "save the announcement");
                if (handled) return handled;
                return res.status(500).json({ message: "Could not save announcement." });
            }
            res.json({ message: "Announcement posted.", id: result.insertId });
        }
    );
});

app.delete("/api/announcements/:id", requireLogin, (req, res) => {
    connection.query(
        `DELETE FROM announcements WHERE id = ?`,
        [req.params.id],
        (err) => {
            if (err) {
                console.log(err);
                const handled = addonTableMissing(res, err, "delete the announcement");
                if (handled) return handled;
                return res.status(500).json({ message: "Could not delete announcement." });
            }
            res.json({ message: "Announcement deleted." });
        }
    );
});

/* ---------------- School events (calendar) ---------------- */

app.get("/api/events", requireLogin, (req, res) => {
    connection.query(
        `SELECT id, title, event_date, description
         FROM school_events ORDER BY event_date ASC LIMIT 200`,
        (err, rows) => {
            if (err) {
                console.log(err);
                const handled = addonTableMissing(res, err, "load events");
                if (handled) return handled;
                return res.status(500).json({ message: "Could not load events." });
            }
            res.json(rows);
        }
    );
});

app.post("/api/events", requireLogin, (req, res) => {
    const title = (req.body.title || "").trim();
    const eventDate = (req.body.event_date || "").trim();
    const description = (req.body.description || "").trim();

    if (!title || !eventDate) {
        return res.status(400).json({ message: "Event title and date are required." });
    }

    connection.query(
        `INSERT INTO school_events (title, event_date, description) VALUES (?, ?, ?)`,
        [title, eventDate, description || null],
        (err, result) => {
            if (err) {
                console.log(err);
                const handled = addonTableMissing(res, err, "save the event");
                if (handled) return handled;
                return res.status(500).json({ message: "Could not save event." });
            }
            res.json({ message: "Event added.", id: result.insertId });
        }
    );
});

app.delete("/api/events/:id", requireLogin, (req, res) => {
    connection.query(
        `DELETE FROM school_events WHERE id = ?`,
        [req.params.id],
        (err) => {
            if (err) {
                console.log(err);
                const handled = addonTableMissing(res, err, "delete the event");
                if (handled) return handled;
                return res.status(500).json({ message: "Could not delete event." });
            }
            res.json({ message: "Event deleted." });
        }
    );
});

/* ================== END OF ADD-ON MODULE ================== */

// Ensure the uploads folder exists
const uploadDir = path.join(__dirname, "images", "students");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config: store photos in images/students, named by student ID
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const rawId = req.body.student_id || "unknown";
        // Strip anything that isn't a letter, number, dash, or underscore -
        // prevents path traversal (e.g. "../../something") via this field.
        const studentId = rawId.replace(/[^a-zA-Z0-9_-]/g, "") || "unknown";
        const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, "");
        cb(null, `${studentId}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/jpg"];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG and PNG images are allowed."));
        }
    }
});

// Separate multer instance for bulk student uploads - keeps the file in
// memory only (never written to disk) since we just need to read its rows.
const uploadExcel = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel",
            "text/csv"
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only .xlsx, .xls, or .csv files are allowed."));
        }
    }
});

// Signatures: stored in images/signatures, named by role (class_teacher.png, principal.png)
const signatureDir = path.join(__dirname, "images", "signatures");
if (!fs.existsSync(signatureDir)) {
    fs.mkdirSync(signatureDir, { recursive: true });
}

const signatureStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, signatureDir);
    },
    filename: (req, file, cb) => {
        const rawRole = req.body.role || "unknown";
        const role = rawRole.replace(/[^a-zA-Z0-9_-]/g, "") || "unknown";
        cb(null, `${role}.png`);
    }
});

// NEW (per-class class-teacher signatures): class-named files
// (ct_<class>.png) live beside the role files, so every class keeps its own
// signature image. The client appends class_name BEFORE the image field,
// exactly like req.body.role is read above, so the filename callback can
// see it.
const classSignatureStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, signatureDir);
    },
    filename: (req, file, cb) => {
        const rawClass = req.body.class_name || "unknown";
        const safeClass = rawClass.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
        cb(null, `ct_${safeClass}.png`);
    }
});

const uploadClassSignature = multer({
    storage: classSignatureStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/jpg"];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG and PNG images are allowed."));
        }
    }
});

const uploadSignature = multer({
    storage: signatureStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/jpg"];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG and PNG images are allowed."));
        }
    }
});

app.get("/", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "teacher-dashboard.html"));
});

console.log("THIS IS MY SERVER.JS")
app.post("/save-result", requireLogin, (req, res) => {

    const {
        student_id,
        student_name,
        class_name,
        term,
        session,
        subject,
        first_test,
        second_test,
        note_score,
        attendance_score,
        ca_score,
        exam_score,
        total_score,
        grade
    } = req.body;

    const sql = `
    INSERT INTO results
        (student_id, student_name, class_name, term, session, subject,
        first_test, second_test, note_score, attendance_score,
        ca_score, exam_score, total, grade)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    `;
console.log(req.body);
    connection.query(
        sql,
        [
            student_id,
            student_name,
            class_name,
            term,
            session,
            subject,
            first_test,
            second_test,
            note_score,
            attendance_score,
            ca_score,
            exam_score,
            total_score,
            grade
        ],
        (err, result) => {

            if (err) {
                console.log(err);
                res.status(500).send("Error saving result");
            } else {
                res.json({
                    message: "Result saved successfully",
                id: result.insertId
            });
            }

        }
    );

});

app.put("/update-result/:id", requireLogin, (req, res) => {

    const id = req.params.id;

    const {
        student_id,
        student_name,
        class_name,
        term,
        session,
        subject,
        first_test,
        second_test,
        note_score,
        attendance_score,
        ca_score,
        exam_score,
        total_score,
        grade
    } = req.body;

    const sql = `
        UPDATE results SET
            student_id = ?,
            student_name = ?,
            class_name = ?,
            term = ?,
            session = ?,
            subject = ?,
            first_test = ?,
            second_test = ?,
            note_score = ?,
            attendance_score = ?,
            ca_score = ?,
            exam_score = ?,
            total = ?,
            grade = ?
        WHERE id = ?
    `;

    connection.query(
        sql,
        [
            student_id,
            student_name,
            class_name,
            term,
            session,
            subject,
            first_test,
            second_test,
            note_score,
            attendance_score,
            ca_score,
            exam_score,
            total_score,
            grade,
            id
        ],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Error updating result");
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: "Result not found" });
            }
            res.json({ message: "Result updated successfully" });
        }
    );

});

app.get("/search-result/:studentId", publishResultGate, (req, res) => { // CHANGED (pack 13): portal/anon users need login + published term; staff skip the gate completely
    const studentId = req.params.studentId;
    const term = req.query.term;
    const session = req.query.session;

    // FIX (teacher dashboard "Load Results" was erroring): term and session
    // are OPTIONAL again. The student result page always sends both and gets
    // EXACTLY the same behaviour as before (including the 3rd Term
    // cumulative-average enrichment below); the teacher dashboard "Student
    // Scores" loader sends neither because it wants EVERY saved row for the
    // student - requiring them turned its call into a 400 error.
    let sql = "SELECT * FROM results WHERE student_id = ?";
    const params = [studentId];
    if (term) { sql += " AND term = ?"; params.push(term); }
    if (session) { sql += " AND session = ?"; params.push(session); }

    connection.query(sql, params, (err, currentTermResults) => {
        if (err) {
            console.log(err);
            return res.status(500).send("Database Error");
        }

        // For 3rd Term, also pull 1st and 2nd Term results for the same
        // student and session so we can show a cumulative subject average.
        if (term === "3rd Term" && currentTermResults.length > 0) {
            const priorSql = "SELECT * FROM results WHERE student_id = ? AND session = ? AND term IN ('1st Term','2nd Term')";

            connection.query(priorSql, [studentId, session], (err2, priorResults) => {
                if (err2) {
                    console.log(err2);
                    return res.status(500).send("Database Error");
                }

                const firstTermBySubject = {};
                const secondTermBySubject = {};

                priorResults.forEach(row => {
                    if (row.term === "1st Term") {
                        firstTermBySubject[row.subject] = row.total;
                    } else if (row.term === "2nd Term") {
                        secondTermBySubject[row.subject] = row.total;
                    }
                });

                const enriched = currentTermResults.map(row => {
                    const firstTotal = firstTermBySubject.hasOwnProperty(row.subject) ? Number(firstTermBySubject[row.subject]) : null;
                    const secondTotal = secondTermBySubject.hasOwnProperty(row.subject) ? Number(secondTermBySubject[row.subject]) : null;
                    const thirdTotal = Number(row.total);

                    const termsPresent = [firstTotal, secondTotal, thirdTotal].filter(v => v !== null);
                    const cumulativeAverage = termsPresent.length > 0
                        ? Math.round((termsPresent.reduce((a, b) => a + b, 0) / termsPresent.length) * 100) / 100
                        : null;

                    return {
                        ...row,
                        first_term_total: firstTotal,
                        second_term_total: secondTotal,
                        third_term_total: thirdTotal,
                        cumulative_average: cumulativeAverage
                    };
                });

                return res.json(enriched);
            });
        } else {
            res.json(currentTermResults);
        }
    });
});

app.get("/student-position/:studentId", portalOwnerGate, (req, res) => { // CHANGED (pack 13): portal/anon users - owner only; staff unchanged
    const studentId = req.params.studentId;
    const className = req.query.className;
    const term = req.query.term;
    const session = req.query.session;

    if (!className || !term || !session) {
        return res.status(400).json({ message: "className, term, and session are required." });
    }

    if (term === "3rd Term") {
        // Cumulative ranking: pull every term's results for this class+session,
        // build each student's per-subject cumulative average (using whichever
        // of 1st/2nd/3rd terms exist for that subject), then rank students by
        // the average of those cumulative subject averages.
        const sql = `
            SELECT student_id, subject, term, total
            FROM results
            WHERE class_name = ? AND session = ? AND term IN ('1st Term','2nd Term','3rd Term')
        `;

        connection.query(sql, [className, session], (err, rows) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }

            // studentSubjects[studentId][subject] = { '1st Term': total, ... }
            const studentSubjects = {};
            const studentsWithThirdTerm = new Set();

            rows.forEach(row => {
                if (!studentSubjects[row.student_id]) {
                    studentSubjects[row.student_id] = {};
                }
                if (!studentSubjects[row.student_id][row.subject]) {
                    studentSubjects[row.student_id][row.subject] = {};
                }
                studentSubjects[row.student_id][row.subject][row.term] = Number(row.total);

                if (row.term === "3rd Term") {
                    studentsWithThirdTerm.add(row.student_id);
                }
            });

            const rankings = [];

            Object.keys(studentSubjects).forEach(sid => {
                // Only rank students who actually have a 3rd term result
                if (!studentsWithThirdTerm.has(sid)) return;

                const subjects = studentSubjects[sid];
                let subjectAverages = [];

                Object.keys(subjects).forEach(subject => {
                    const terms = subjects[subject];
                    const values = Object.values(terms);
                    if (values.length > 0) {
                        const avg = values.reduce((a, b) => a + b, 0) / values.length;
                        subjectAverages.push(avg);
                    }
                });

                const overallAverage = subjectAverages.length > 0
                    ? subjectAverages.reduce((a, b) => a + b, 0) / subjectAverages.length
                    : 0;

                rankings.push({ student_id: sid, average: overallAverage });
            });

            rankings.sort((a, b) => b.average - a.average);

            let position = 0;
            rankings.forEach((student, index) => {
                if (student.student_id === studentId) {
                    position = index + 1;
                }
            });

            res.json({ position });
        });

    } else {
        const sql = `
            SELECT
                student_id,
                ROUND(AVG(total),2) AS average
            FROM results
            WHERE class_name = ?
            AND term = ?
            AND session = ?
            GROUP BY student_id
            ORDER BY average DESC
        `;

        connection.query(sql, [className, term, session], (err, results) => {

            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }

            let position = 0;

            results.forEach((student, index) => {
                if (student.student_id === studentId) {
                    position = index + 1;
                }
            });

            res.json({ position });

        });
    }
});



app.get("/student/:studentId", portalOwnerGate, (req, res) => { // CHANGED (pack 13): portal/anon users - owner only; staff unchanged

    const studentId = req.params.studentId;

    const sql = "SELECT * FROM students WHERE student_id = ?";

    connection.query(sql, [studentId], (err, results) => {

        if (err) {
            console.log(err);
            res.status(500).send("Database Error");
        } else {
            res.json(results);
        }

    });

});

// Public - the result-checking page needs this without being logged in
app.get("/signatures", (req, res) => {
    connection.query("SELECT role, signature_path FROM signatures", (err, rows) => {
        if (err) {
            console.log(err);
            return res.status(500).send("Database Error");
        }
        res.json(rows);
    });
});

// Handles both a drawn signature (canvas converted to a PNG file on the
// client) and a real uploaded image - both arrive here as a normal file
// upload, so the server treats them identically.
app.post("/save-signature", requireLogin, uploadSignature.single("signature"), (req, res) => {
    const role = req.body.role;

    // CHANGED (signature management, request #4): four staff roles are
    // now accepted instead of two. Same route, same storage, same
    // signatures table - only the allowed role list grew.
    const ALLOWED_SIGNATURE_ROLES = ["class_teacher", "principal", "vice_principal", "head_teacher"];
    if (!role || !ALLOWED_SIGNATURE_ROLES.includes(role)) {
        return res.status(400).json({ message: "Role must be one of: " + ALLOWED_SIGNATURE_ROLES.join(", ") + "." });
    }

    if (!req.file) {
        return res.status(400).json({ message: "No signature image received." });
    }

    const signaturePath = `images/signatures/${req.file.filename}`;

    connection.query(
        `INSERT INTO signatures (role, signature_path) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE signature_path = VALUES(signature_path), updated_at = CURRENT_TIMESTAMP`,
        [role, signaturePath],
        (err) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Error saving signature." });
            }
            res.json({ message: "Signature saved successfully.", path: signaturePath });
        }
    );
});

app.delete("/delete-signature/:role", requireLogin, (req, res) => {
    const role = req.params.role;

    connection.query(
        "DELETE FROM signatures WHERE role = ?",
        [role],
        (err) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Error deleting signature." });
            }
            res.json({ message: "Signature removed." });
        }
    );
});

/* ==================================================================
   NEW (per-class class-teacher signatures, owner request):
   "space to accept many signatures and assign them to classes, so the
   signature appears on its own class, not just random class."
   Public read (the result pages need it, mirror of /signatures);
   save/delete stay behind login. Nothing here replaces the existing
   /signatures flow - classes without an assignment still fall back to
   the shared class_teacher signature exactly as before.
================================================================== */

app.get("/class-signatures", (req, res) => {
    connection.query(
        "SELECT class_name, signature_path FROM class_teacher_signatures ORDER BY class_name",
        (err, rows) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json(rows);
        }
    );
});

app.post("/save-class-signature", requireLogin, uploadClassSignature.single("signature"), (req, res) => {
    const className = (req.body.class_name || "").trim();

    if (!className) {
        return res.status(400).json({ message: "Please choose the class first." });
    }
    if (!req.file) {
        return res.status(400).json({ message: "No signature image received." });
    }

    const signaturePath = `images/signatures/${req.file.filename}`;

    connection.query(
        `INSERT INTO class_teacher_signatures (class_name, signature_path) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE signature_path = VALUES(signature_path), updated_at = CURRENT_TIMESTAMP`,
        [className, signaturePath],
        (err) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Error saving signature." });
            }
            res.json({ message: "Signature saved for " + className + ".", path: signaturePath });
        }
    );
});

app.delete("/class-signature/:className", requireLogin, (req, res) => {
    connection.query(
        "DELETE FROM class_teacher_signatures WHERE class_name = ?",
        [req.params.className],
        (err) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Error deleting signature." });
            }
            res.json({ message: "Class signature removed." });
        }
    );
});

app.post("/save-exam", requireLogin, (req, res) => {
    const { id, title, class_name, subject, term, session, duration, instructions, body_html } = req.body;

    if (!title || !class_name || !subject || !term || !session || !body_html) {
        return res.status(400).json({ message: "Title, class, subject, term, session, and content are all required." });
    }

    if (id) {
        // Update an existing exam
        connection.query(
            `UPDATE exams SET title=?, class_name=?, subject=?, term=?, session=?, duration=?, instructions=?, body_html=? WHERE id=?`,
            [title, class_name, subject, term, session, duration || null, instructions || null, body_html, id],
            (err) => {
                if (err) {
                    console.log(err);
                    return res.status(500).json({ message: "Error updating exam." });
                }
                res.json({ message: "Exam updated successfully.", id });
            }
        );
    } else {
        // Create a new exam
        connection.query(
            `INSERT INTO exams (title, class_name, subject, term, session, duration, instructions, body_html, created_by)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [title, class_name, subject, term, session, duration || null, instructions || null, body_html, req.session.username],
            (err, result) => {
                if (err) {
                    console.log(err);
                    return res.status(500).json({ message: "Error saving exam." });
                }
                res.json({ message: "Exam saved successfully.", id: result.insertId });
            }
        );
    }
});

app.get("/exams", requireLogin, (req, res) => {
    connection.query(
        "SELECT id, title, class_name, subject, term, session, updated_at FROM exams ORDER BY updated_at DESC",
        (err, rows) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json(rows);
        }
    );
});

app.get("/exam/:id", requireLogin, (req, res) => {
    connection.query(
        "SELECT * FROM exams WHERE id = ?",
        [req.params.id],
        (err, rows) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            if (rows.length === 0) {
                return res.status(404).json({ message: "Exam not found." });
            }
            res.json(rows[0]);
        }
    );
});

app.delete("/exam/:id", requireLogin, (req, res) => {
    connection.query(
        "DELETE FROM exams WHERE id = ?",
        [req.params.id],
        (err) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Error deleting exam." });
            }
            res.json({ message: "Exam deleted." });
        }
    );
});

app.get("/classes", requireLogin, (req, res) => {
    connection.query(
        "SELECT * FROM classes ORDER BY id",
        (err, results) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json(results);
        }
    );
});

app.post("/add-class", requireLogin, (req, res) => {
    const { class_name } = req.body;

    if (!class_name || class_name.trim() === "") {
        return res.status(400).json({ message: "Class name is required." });
    }

    connection.query(
        "INSERT INTO classes (class_name) VALUES (?)",
        [class_name.trim()],
        (err, result) => {
            if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(400).json({ message: "That class already exists." });
                }
                console.log(err);
                return res.status(500).json({ message: "Error adding class" });
            }
            res.json({ message: "Class added successfully", id: result.insertId });
        }
    );
});

app.delete("/delete-class/:id", requireLogin, (req, res) => {
    const id = req.params.id;

    connection.query(
        "DELETE FROM classes WHERE id = ?",
        [id],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json({ message: "Class deleted successfully" });
        }
    );
});

app.get("/subjects", requireLogin, (req, res) => {
    const className = req.query.class;

    // CHANGED (subject enable/disable, request #3): dropdowns (score
    // entry, exam builder) now only show ACTIVE subjects. When the
    // is_active column does not exist yet (older DB), the query falls
    // back to the ORIGINAL behaviour - every subject is returned.
    // No row, no saved result and no calculation is affected.
    function runQuery(filterActive) {
        let sql = "SELECT * FROM subjects";
        let params = [];
        const clauses = [];

        if (className) {
            clauses.push("class_name = ?");
            params.push(className);
        }
        if (filterActive) {
            clauses.push("(is_active = 1)");
        }
        if (clauses.length) {
            sql += " WHERE " + clauses.join(" AND ");
        }

        sql += " ORDER BY subject_name";

        connection.query(sql, params, (err, results) => {
            if (err) {
                if (err.code === "ER_BAD_FIELD_ERROR" && filterActive) {
                    subjectActiveColReady = false;
                    return runQuery(false); // graceful fallback to original query
                }
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json(results);
        });
    }

    runQuery(subjectActiveColReady);
});

app.post("/add-subject", requireLogin, (req, res) => {
    const { subject_name, class_name } = req.body;

    if (!subject_name || !class_name) {
        return res.status(400).json({ message: "Subject name and class are both required." });
    }

    connection.query(
        "INSERT INTO subjects (subject_name, class_name) VALUES (?, ?)",
        [subject_name, class_name],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Error adding subject" });
            }
            res.json({ message: "Subject added successfully", id: result.insertId });
        }
    );
});

app.get("/all-subjects", requireLogin, (req, res) => {
    connection.query(
        "SELECT * FROM subjects ORDER BY class_name, subject_name",
        (err, results) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json(results);
        }
    );
});

app.delete("/delete-subject/:id", requireLogin, (req, res) => {
    const id = req.params.id;

    connection.query(
        "DELETE FROM subjects WHERE id = ?",
        [id],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json({ message: "Subject deleted successfully" });
        }
    );
});

// ----------------------------------------------------------------
// NEW (subject editing - request #3): rename a subject or move it to
// another class. ADDITIVE - complements (never changes) the existing
// /add-subject and /delete-subject routes.
// ----------------------------------------------------------------
app.put("/update-subject/:id", requireLogin, (req, res) => {
    const id = req.params.id;
    const { subject_name, class_name } = req.body;
    // CHANGED (subject enable/disable, request #3): optional is_active
    // flag (1 = visible in dropdowns, 0 = hidden/managed-off). Only
    // written when the guarded column exists.
    const hasActiveFlag = subjectActiveColReady && (req.body.is_active === 0 || req.body.is_active === 1);

    if (!subject_name || !class_name) {
        return res.status(400).json({ message: "Subject name and class are both required." });
    }

    const sets = ["subject_name = ?", "class_name = ?"];
    const vals = [subject_name, class_name];
    if (hasActiveFlag) {
        sets.push("is_active = ?");
        vals.push(req.body.is_active);
    }

    connection.query(
        `UPDATE subjects SET ${sets.join(", ")} WHERE id = ?`,
        vals.concat([id]),
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Error updating subject" });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: "Subject not found." });
            }
            res.json({ message: "Subject updated successfully" });
        }
    );
});

// ----------------------------------------------------------------
// NEW (whole-class results PDF - request #7): returns the RAW saved
// result rows for one class + term + session so the Class Results
// page can render a broadsheet and export ONE combined PDF.
// 100% READ-ONLY - it only SELECTs from the results table; it never
// writes, and it does not change any result calculation. The existing
// per-student "Download Result" feature is completely untouched.
// ----------------------------------------------------------------
app.get("/class-results", requireLogin, (req, res) => {
    const className = (req.query["class"] || "").trim();
    const term = (req.query.term || "").trim();
    const session = (req.query.session || "").trim();

    if (!className || !term || !session) {
        return res.status(400).json({ message: "Class, Term and Session are all required." });
    }

    connection.query(
        `SELECT student_id, student_name, class_name, subject, total, grade
         FROM results
         WHERE class_name = ? AND term = ? AND session = ?
         ORDER BY student_name, subject`,
        [className, term, session],
        (err, rows) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Database Error" });
            }
            res.json(rows);
        }
    );
});

app.get("/dashboard-summary", requireLogin, (req, res) => {
    connection.query(
`
SELECT
    (SELECT COUNT(*) FROM students) AS students,
    (SELECT COUNT(*) FROM subjects) AS subjects,
    (SELECT COUNT(*) FROM results) AS results
`,
(err, data) => {

    if (err) {
        console.log(err);
        return res.status(500).send("Database Error");
    }

    res.json(data[0]);
});

});



    app.post("/save-student", requireLogin, upload.single("photo"), (req, res) => {
        const{
            student_id,
            full_name,
            gender,
            class_name,
            date_of_birth
        } = req.body;

        const photoPath = req.file
            ? `images/students/${req.file.filename}`
            : null;

        // NEW (student profile fields): the redesigned Add Student form can
        // optionally send parent_name / parent_phone / address. When they
        // are present AND the columns exist, we store them too; otherwise
        // the ORIGINAL insert below runs unchanged (backward compatible).
        const parentName  = (req.body.parent_name  || "").trim();
        const parentPhone = (req.body.parent_phone || "").trim();
        const address     = (req.body.address      || "").trim();
        const hasParentData = studentProfileColsReady && (parentName || parentPhone || address);

        if (hasParentData) {
            connection.query(
                `INSERT INTO students
                 (student_id, full_name, gender, class_name, date_of_birth, photo_path,
                  parent_name, parent_phone, address)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
                [student_id, full_name, gender, class_name, date_of_birth, photoPath,
                 parentName || null, parentPhone || null, address || null],
                (err) => {
                    if (err) {
                        // Columns unexpectedly missing - fall back to the original insert.
                        if (err.code === "ER_BAD_FIELD_ERROR") {
                            return insertStudentOriginal();
                        }
                        console.log(err);
                        return res.status(500).send("Error saving student");
                    }
                    res.send("Student saved successfully");
                }
            );
            return;
        }

        insertStudentOriginal();

        // ORIGINAL insert - untouched behaviour for all existing clients.
        function insertStudentOriginal() {
            const sql =`
            INSERT INTO students
            (student_id, full_name, gender, class_name, date_of_birth, photo_path)
            VALUES (?,?,?,?,?,?)
            `;

            connection.query(
                sql,
                [
                    student_id,
                    full_name,
                    gender,
                    class_name,
                    date_of_birth,
                    photoPath
                ],
                (err, result) => {
                    if(err) {
                        console.log(err);
                        res.status(500).send("Error saving student");
                    } else {
                        res.send("Student saved successfully");
                    }
                }
            );
        }
    });

    // ----------------------------------------------------------------
    // NEW (student profile editing - request #4): lets the ADMIN edit
    // every profile field of an existing student:
    //   Full Name, Admission Number (student_id), Gender, Date of Birth,
    //   Class, Parent Name, Parent Phone, Address, Passport Photograph.
    // ADDITIVE: no existing route is changed. Admin-only, like
    // /delete-student. Parent fields are only written when the guarded
    // columns exist (see ensureStudentProfileColumns above).
    //
    // FormData note: the client sends "student_id" BEFORE the photo
    // file, because multer uses it to name the saved image file.
    //
    // Admission Number changes are handled safely: the students row is
    // updated together with results.student_id (plain text link), so a
    // renamed student keeps all of their saved results. Nothing about
    // result VALUES or calculations is touched - only the id text.
    // ----------------------------------------------------------------
    app.post("/update-student/:studentId", requireLogin, requireAdmin, upload.single("photo"), (req, res) => {
        const origId = (req.params.studentId || "").trim();

        const fullName = (req.body.full_name || "").trim();
        const gender   = (req.body.gender || "").trim();
        const className = (req.body.class_name || "").trim();
        const dateOfBirth = (req.body.date_of_birth || "").trim() || null;
        const newId = (req.body.student_id || origId).trim() || origId;

        if (!fullName || !gender || !className) {
            return res.status(400).json({ message: "Full Name, Gender and Class are required." });
        }
        if (gender !== "Male" && gender !== "Female") {
            return res.status(400).json({ message: "Gender must be Male or Female." });
        }
        if (!newId) {
            return res.status(400).json({ message: "Admission Number cannot be empty." });
        }

        const photoPath = req.file ? `images/students/${req.file.filename}` : null;

        const parentName  = (req.body.parent_name  || "").trim();
        const parentPhone = (req.body.parent_phone || "").trim();
        const address     = (req.body.address      || "").trim();

        // Build the SET list dynamically so we never write to columns
        // that do not exist on older databases.
        const sets = ["full_name = ?", "gender = ?", "class_name = ?", "date_of_birth = ?"];
        const vals = [fullName, gender, className, dateOfBirth];

        if (studentProfileColsReady) {
            sets.push("parent_name = ?", "parent_phone = ?", "address = ?");
            vals.push(parentName || null, parentPhone || null, address || null);
        }
        if (photoPath) {
            sets.push("photo_path = ?");
            vals.push(photoPath);
        }
        if (newId !== origId) {
            sets.push("student_id = ?");
            vals.push(newId);
        }

        function runUpdate() {
            connection.query(
                `UPDATE students SET ${sets.join(", ")} WHERE student_id = ?`,
                vals.concat([origId]),
                (err, result) => {
                    if (err) {
                        console.log(err);
                        return res.status(500).json({ message: "Database error while updating student." });
                    }
                    if (result.affectedRows === 0) {
                        return res.status(404).json({ message: "No student found with that Admission Number." });
                    }
                    res.json({ message: "Student profile updated.", student_id: newId });
                }
            );
        }

        if (newId !== origId) {
            // Make sure the new Admission Number is not already taken.
            connection.query(
                "SELECT student_id FROM students WHERE student_id = ?",
                [newId],
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return res.status(500).json({ message: "Database error while checking Admission Number." });
                    }
                    if (rows.length > 0) {
                        return res.status(400).json({ message: `Admission Number "${newId}" is already used by another student.` });
                    }
                    // Re-link any saved results to the new id FIRST, so no
                    // result is ever left pointing at a missing student.
                    connection.query(
                        "UPDATE results SET student_id = ? WHERE student_id = ?",
                        [newId, origId],
                        (err2) => {
                            if (err2) {
                                console.log(err2);
                                return res.status(500).json({ message: "Database error while re-linking results." });
                            }
                            runUpdate();
                        }
                    );
                }
            );
        } else {
            runUpdate();
        }
    });

    // ----------------------------------------------------------------
    // NEW (bulk-photo helper): attach or replace the photo of a student
    // who ALREADY exists (e.g. added via bulk Excel upload, which cannot
    // carry photos). ADDITIVE - it changes no existing route or query.
    // The client must send the "student_id" FormData field BEFORE the
    // file, because multer uses it to name the saved file.
    // ----------------------------------------------------------------
    app.post("/update-student-photo", requireLogin, upload.single("photo"), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: "No photo uploaded." });
        }
        const studentId = (req.body.student_id || "").trim();
        if (!studentId) {
            return res.status(400).json({ message: "Missing student ID." });
        }
        const photoPath = `images/students/${req.file.filename}`;
        connection.query(
            "UPDATE students SET photo_path = ? WHERE student_id = ?",
            [photoPath, studentId],
            (err, result) => {
                if (err) {
                    console.log(err);
                    return res.status(500).json({ message: "Database error while saving photo." });
                }
                if (result.affectedRows === 0) {
                    return res.status(404).json({ message: "No student found with that ID." });
                }
                res.json({ message: "Photo saved.", photo_path: photoPath });
            }
        );
    });

    app.get("/download-student-template", requireLogin, (req, res) => {
        const filePath = path.join(__dirname, "templates", "student_upload_template.xlsx");
        res.download(filePath, "student_upload_template.xlsx", (err) => {
            if (err) {
                console.log(err);
                if (!res.headersSent) {
                    res.status(500).send("Could not download template.");
                }
            }
        });
    });

    app.post("/bulk-add-students", requireLogin, uploadExcel.single("file"), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded." });
        }

        let rows;
        try {
            const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        } catch (err) {
            console.log(err);
            return res.status(400).json({ message: "Could not read the uploaded file. Make sure it's a valid .xlsx, .xls, or .csv file." });
        }

        if (rows.length === 0) {
            return res.status(400).json({ message: "The file has no student rows in it." });
        }

        // First, fetch the valid class list so we can validate each row's class name.
        connection.query("SELECT class_name FROM classes", (err, classRows) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Database error while checking classes." });
            }

            const validClasses = new Set(classRows.map(c => c.class_name));
            const results = { inserted: 0, errors: [] };

            let index = 0;

            function processNextRow() {
                if (index >= rows.length) {
                    return res.json({
                        message: `${results.inserted} of ${rows.length} student(s) added successfully.`,
                        inserted: results.inserted,
                        total: rows.length,
                        errors: results.errors
                    });
                }

                const row = rows[index];
                const rowNum = index + 2; // +2 because row 1 is the header and index is 0-based
                index++;

                const studentId = String(row["Student ID"] || "").trim();
                const fullName = String(row["Full Name"] || "").trim();
                const gender = String(row["Gender"] || "").trim();
                const className = String(row["Class"] || "").trim();
                let dob = row["Date of Birth (YYYY-MM-DD)"];

                // NEW (template clarity): rows whose Student ID starts with
                // "EXAMPLE" are the template's sample rows - skip them so a
                // forgotten example row can never create a fake student.
                if (studentId.toUpperCase().startsWith("EXAMPLE")) {
                    return processNextRow();
                }

                // Excel sometimes gives dates as JS Date objects instead of strings
                if (dob instanceof Date) {
                    dob = dob.toISOString().split("T")[0];
                } else {
                    dob = String(dob || "").trim();
                    // NEW (template clarity): also accept dates pasted/typed
                    // as DD/MM/YYYY text - convert to the expected YYYY-MM-DD.
                    const mdy = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                    if (mdy) {
                        dob = `${mdy[3]}-${mdy[2].padStart(2, "0")}-${mdy[1].padStart(2, "0")}`;
                    }
                }

                if (!studentId || !fullName || !gender || !className) {
                    results.errors.push(`Row ${rowNum}: Missing required field(s) (Student ID, Full Name, Gender, and Class are all required).`);
                    return processNextRow();
                }

                if (gender !== "Male" && gender !== "Female") {
                    results.errors.push(`Row ${rowNum}: Gender must be exactly "Male" or "Female" (got "${gender}").`);
                    return processNextRow();
                }

                if (!validClasses.has(className)) {
                    results.errors.push(`Row ${rowNum}: "${className}" is not a recognized class. Check the "Valid Classes" sheet in the template.`);
                    return processNextRow();
                }

                connection.query(
                    "INSERT INTO students (student_id, full_name, gender, class_name, date_of_birth) VALUES (?,?,?,?,?)",
                    [studentId, fullName, gender, className, dob || null],
                    (err) => {
                        if (err) {
                            if (err.code === "ER_DUP_ENTRY") {
                                results.errors.push(`Row ${rowNum}: Student ID "${studentId}" already exists.`);
                            } else {
                                console.log(err);
                                results.errors.push(`Row ${rowNum}: Database error saving this row.`);
                            }
                        } else {
                            results.inserted++;
                        }
                        processNextRow();
                    }
                );
            }

            processNextRow();
        });
    });

app.post("/promote-class", requireLogin, (req, res) => {
    console.log("PROMOTE ROUTE CALLED");

    const { currentClass } = req.body;

    let nextClass = "";

    switch (currentClass) {
        case "الأوّل التّحضيريّ":
            nextClass = "الثّاني التّحضيريّ";
            break;

        case "الثّاني التّحضيريّ":
            nextClass = "الثّالث التّحضيريّ";
            break;

        case "الثّالث التّحضيريّ":
            nextClass = "الأوّل الابتدائيّ";
            break;

        case "الأوّل الابتدائيّ":
            nextClass = "الثّاني الابتدائيّ";
            break;

        case "الثّاني الابتدائيّ":
            nextClass = "الثّالث الابتدائيّ";
            break;

        case "الثّالث الابتدائيّ":
            nextClass = "الرّابع الابتدائيّ";
            break;

        case "الرّابع الابتدائيّ":
            nextClass = "الأوّل الإعداديّ";
            break;

        case "الأوّل الإعداديّ":
            nextClass = "الثّاني الإعداديّ";
            break;

        case "الثّاني الإعداديّ":
            nextClass = "الثّالث الإعداديّ";
            break;

        case "الثّالث الإعداديّ":
            nextClass = "الأوّل الثّانويّ";
            break;

        case "الأوّل الثّانويّ":
            nextClass = "الثّاني الثّانويّ";
            break;

        case "الثّاني الثّانويّ":
            nextClass = "الثّالث الثّانويّ";
            break;

        default:
            return res.status(400).send("Invalid class selected.");
    }

    const sql = `
        UPDATE students
        SET class_name = ?
        WHERE class_name = ?
    `;

    connection.query(sql, [nextClass, currentClass], (err, result) => {

        if (err) {
            console.log(err);
            return res.status(500).send("Database Error");
        }

        res.send(`${result.affectedRows} student(s) promoted from ${currentClass} to ${nextClass}.`);

    });

});


// ----------------------------------------------------------------
// NEW (export): download EVERY result in the school as ONE Excel file.
// 100% READ-ONLY - it only SELECTs; no result calculation, style, print
// logic or result page is touched in any way. Uses the existing XLSX
// dependency already installed for bulk student upload.
// ----------------------------------------------------------------
app.get("/export-all-results", requireLogin, (req, res) => {
    // NEW (per-class export): optional ?class=<exact class name> filter.
    // Empty or missing -> export everything (unchanged behaviour).
    const classFilter = (req.query.class || "").trim();
    const where = classFilter ? "WHERE class_name = ?" : "";
    const params = classFilter ? [classFilter] : [];

    connection.query(
        `SELECT student_id, student_name, class_name, term, session, subject,
                first_test, second_test, note_score, attendance_score,
                ca_score, exam_score, total, grade
         FROM results
         ${where}
         ORDER BY session, term, class_name, student_name, subject`,
        params,
        (err, rows) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            if (!rows || rows.length === 0) {
                return res.status(404).send(classFilter
                    ? "No results found for that class yet."
                    : "No results to export yet.");
            }

            // Rename columns once, in human-friendly plain English.
            const data = rows.map((r) => ({
                "Student ID": r.student_id,
                "Student Name": r.student_name,
                "Class": r.class_name,
                "Session": r.session,
                "Term": r.term,
                "Subject": r.subject,
                "1st Test": r.first_test,
                "2nd Test": r.second_test,
                "Note": r.note_score,
                "Attendance": r.attendance_score,
                "CA Total": r.ca_score,
                "Exam Score": r.exam_score,
                "Total": r.total,
                "Grade": r.grade
            }));

            const workbook = XLSX.utils.book_new();
            const sheet = XLSX.utils.json_to_sheet(data);
            sheet["!cols"] = [
                { wch: 12 }, { wch: 28 }, { wch: 24 }, { wch: 12 }, { wch: 10 },
                { wch: 26 }, { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 11 },
                { wch: 9 }, { wch: 11 }, { wch: 8 }, { wch: 7 }
            ];
            XLSX.utils.book_append_sheet(workbook, sheet, "All Results");
            const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

            const fileName = classFilter
                ? `results-${classFilter.replace(/[^\w؀-ۿ-]/g, "_")}.xlsx`
                : "all-results.xlsx";
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            // NEW: encodeURIComponent keeps Arabic class names valid in the filename header
            res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
            res.send(buffer);
        }
    );
});

app.delete("/delete-result/:id", requireLogin, (req, res) => {
    const id= req.params.id;

    connection.query(
        "DELETE FROM results WHERE id = ?",
        [id],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json({
                message:"Result deleted successfully",
        });
        }
    );
});

app.delete("/delete-results-by-student/:studentId", requireLogin, (req, res) => {
    const studentId = req.params.studentId;

    connection.query(
        "DELETE FROM results WHERE student_id = ?",
        [studentId],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json({
                message: `${result.affectedRows} result(s) deleted successfully`,
                count: result.affectedRows
            });
        }
    );
});

app.delete("/delete-student/:studentId", requireLogin, requireAdmin, (req, res) => {
    const studentId = req.params.studentId;

    connection.query(
        "DELETE FROM students WHERE student_id = ?",
        [studentId],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json({
                message: "Student deleted successfully",
            });
        }
    );
});

// Admin-only: wipe ALL results and ALL students. Used for clearing test data
// before real use. This does NOT touch subjects or users (login accounts).
app.delete("/wipe-all-data", requireLogin, requireAdmin, (req, res) => {
    connection.query("DELETE FROM results", (err) => {
        if (err) {
            console.log(err);
            return res.status(500).send("Database Error while clearing results");
        }

        connection.query("DELETE FROM students", (err2) => {
            if (err2) {
                console.log(err2);
                return res.status(500).send("Database Error while clearing students");
            }

            res.json({ message: "All results and student records have been cleared." });
        });
    });
});


/* =====================================================================
   NEW (pack 13) - SCHOOL WEBSITE + PORTAL + MANAGEMENT APIs.
   Everything below is ADDITIVE: new tables only, no existing route,
   query, result calculation or report generation is touched.
   ===================================================================== */

/* ---------- Student / Parent portal (login: Student ID + surname) --- */
app.post("/portal-login", (req, res) => {
    const studentId = (req.body.student_id || "").trim();
    const password  = (req.body.password  || "").trim();
    if (!studentId || !password) {
        return res.status(400).json({ message: "Student ID and surname are required." });
    }
    connection.query("SELECT * FROM students WHERE student_id = ?", [studentId], (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        if (!rows.length) return res.status(401).json({ message: "Invalid Student ID or surname" });
        const st = rows[0];
        const fullName = (st.full_name || "").trim();
        const surname  = fullName ? fullName.split(/\s+/).pop() : "";
        const ok = password.toLowerCase() === surname.toLowerCase()
                || password.toLowerCase() === fullName.toLowerCase();
        if (!ok) return res.status(401).json({ message: "Invalid Student ID or surname" });
        req.session.portalStudentId = st.student_id;
        res.json({
            message: "Login successful",
            student: {
                student_id: st.student_id,
                full_name: st.full_name,
                class_name: st.class_name,
                gender: st.gender,
                date_of_birth: st.date_of_birth,
                photo_path: st.photo_path
            }
        });
    });
});

app.get("/portal/me", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.json({ loggedIn: false });
    connection.query("SELECT * FROM students WHERE student_id = ?", [sid], (err, rows) => {
        if (err || !rows.length) {
            if (err) console.log(err);
            return res.json({ loggedIn: false });
        }
        res.json({ loggedIn: true, student: rows[0] });
    });
});

app.post("/portal/logout", (req, res) => {
    if (req.session) delete req.session.portalStudentId;
    res.json({ message: "Logged out" });
});

/* Terms/sessions that (a) the student actually has results for AND
   (b) admin has PUBLISHED (per-class row or whole-term row). */
app.get("/portal/published-terms", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    const sql = `
        SELECT DISTINCT r.term, r.session
        FROM results r
        JOIN result_publish p
          ON p.term = r.term AND p.session = r.session
         AND p.published = 1
         AND (p.class_name = '' OR p.class_name = r.class_name)
        WHERE r.student_id = ?
        ORDER BY r.session, r.term
    `;
    connection.query(sql, [sid], (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

/* ---------- Admin: publish / unpublish results ---------------------- */
app.get("/result-publish", requireLogin, requireAdmin, (req, res) => {
    let sql = "SELECT class_name, term, session, published FROM result_publish";
    const params = [];
    const wh = [];
    if (req.query.term)    { wh.push("term = ?");    params.push(req.query.term); }
    if (req.query.session) { wh.push("session = ?"); params.push(req.query.session); }
    if (wh.length) sql += " WHERE " + wh.join(" AND ");
    sql += " ORDER BY session, term, class_name";
    connection.query(sql, params, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

// ADMIN only - "except it is been publish by admin".
app.post("/result-publish", requireLogin, requireAdmin, (req, res) => {
    const className = (req.body.class_name || "").trim(); // '' = whole term
    const term      = (req.body.term || "").trim();
    const session   = (req.body.session || "").trim();
    const published = Number(req.body.published) ? 1 : 0;
    if (!term || !session) {
        return res.status(400).json({ message: "Term and session are required." });
    }
    connection.query(
        `INSERT INTO result_publish (class_name, term, session, published)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE published = VALUES(published)`,
        [className, term, session, published],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Saved", class_name: className, term, session, published });
        }
    );
});

/* ---------- Admission enquiries (public website form) --------------- */
app.post("/admission-enquiry", (req, res) => {
    const child  = (req.body.child_name || "").trim();
    const parent = (req.body.parent_name || "").trim();
    const phone  = (req.body.phone || "").trim();
    const cls    = (req.body.class_applied || "").trim();
    const msg    = (req.body.message || "").trim();
    if (!child || !phone) {
        return res.status(400).json({ message: "Child's name and a phone number are required." });
    }
    connection.query(
        "INSERT INTO admission_enquiries (child_name, parent_name, phone, class_applied, message) VALUES (?,?,?,?,?)",
        [child, parent, phone, cls, msg],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Thank you! The school will contact you soon." });
        }
    );
});

app.get("/admission-enquiries", requireLogin, requireAdmin, (req, res) => {
    connection.query(
        "SELECT id, child_name, parent_name, phone, class_applied, message, status, created_at FROM admission_enquiries ORDER BY created_at DESC LIMIT 500",
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

app.put("/admission-enquiry/:id", requireLogin, requireAdmin, (req, res) => {
    const status = (req.body.status || "").trim();
    if (!["new", "contacted", "admitted"].includes(status)) {
        return res.status(400).json({ message: "Invalid status." });
    }
    connection.query("UPDATE admission_enquiries SET status = ? WHERE id = ?", [status, req.params.id], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "Updated" });
    });
});

/* ---------- Student attendance -------------------------------------- */
app.get("/attendance/class", requireLogin, (req, res) => {
    const className = (req.query.class_name || "").trim();
    const date = (req.query.date || "").trim();
    if (!className || !date) return res.status(400).json({ message: "class_name and date are required." });
    connection.query(
        `SELECT s.student_id, s.full_name, s.gender, a.status
         FROM students s
         LEFT JOIN attendance a ON a.student_id = s.student_id AND a.att_date = ?
         WHERE s.class_name = ?
         ORDER BY s.full_name`,
        [date, className],
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

app.post("/attendance/save", requireLogin, (req, res) => {
    const className = (req.body.class_name || "").trim();
    const date = (req.body.date || "").trim();
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    if (!className || !date || !records.length) {
        return res.status(400).json({ message: "class_name, date and records are required." });
    }
    const valid = ["present", "absent", "late"];
    const markedBy = req.session.username || null;
    const rows = records
        .filter(r => r && r.student_id && valid.includes(r.status))
        .map(r => [String(r.student_id), className, date, r.status, markedBy]);
    if (!rows.length) return res.status(400).json({ message: "No valid records supplied." });
    connection.query(
        `INSERT INTO attendance (student_id, class_name, att_date, status, marked_by)
         VALUES ?
         ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by)`,
        [rows],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Attendance saved", count: rows.length });
        }
    );
});

app.get("/attendance/report", requireLogin, (req, res) => {
    const className = (req.query.class_name || "").trim();
    const from = (req.query.from || "").trim();
    const to = (req.query.to || "").trim();
    if (!className || !from || !to) return res.status(400).json({ message: "class_name, from and to are required." });
    connection.query(
        `SELECT a.student_id, s.full_name,
                SUM(a.status = 'present') AS present,
                SUM(a.status = 'absent')  AS absent,
                SUM(a.status = 'late')    AS late,
                COUNT(*) AS marked
         FROM attendance a
         JOIN students s ON s.student_id = a.student_id
         WHERE a.class_name = ? AND a.att_date BETWEEN ? AND ?
         GROUP BY a.student_id, s.full_name
         ORDER BY s.full_name`,
        [className, from, to],
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

/* ---------- Staff attendance + weekly evaluations ------------------- */
app.get("/staff-list", requireLogin, (req, res) => {
    connection.query("SELECT username, role FROM users ORDER BY username", (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.get("/staff-attendance", requireLogin, (req, res) => {
    const date = (req.query.date || "").trim();
    if (!date) return res.status(400).json({ message: "date is required." });
    connection.query(
        `SELECT u.username, u.role, sa.status
         FROM users u
         LEFT JOIN staff_attendance sa ON sa.staff_username = u.username AND sa.att_date = ?
         ORDER BY u.username`,
        [date],
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

app.post("/staff-attendance/save", requireLogin, requireAdmin, (req, res) => {
    const date = (req.body.date || "").trim();
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    if (!date || !records.length) return res.status(400).json({ message: "date and records are required." });
    const markedBy = req.session.username || null;
    const rows = records
        .filter(r => r && r.username && ["present", "absent"].includes(r.status))
        .map(r => [String(r.username), date, r.status, markedBy]);
    if (!rows.length) return res.status(400).json({ message: "No valid records supplied." });
    connection.query(
        `INSERT INTO staff_attendance (staff_username, att_date, status, marked_by)
         VALUES ?
         ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by)`,
        [rows],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Staff attendance saved", count: rows.length });
        }
    );
});

app.post("/staff-evaluation/save", requireLogin, requireAdmin, (req, res) => {
    const username = (req.body.username || "").trim();
    const weekStart = (req.body.week_start || "").trim();
    const clamp = v => { const n = parseInt(v, 10); return (n >= 1 && n <= 10) ? n : null; };
    const teaching = clamp(req.body.teaching), punctuality = clamp(req.body.punctuality), conduct = clamp(req.body.conduct);
    const comment = (req.body.comment || "").trim();
    if (!username || !weekStart) return res.status(400).json({ message: "username and week_start are required." });
    connection.query(
        `INSERT INTO staff_evaluations (staff_username, week_start, teaching, punctuality, conduct, comment, created_by)
         VALUES (?,?,?,?,?,?,?)`,
        [username, weekStart, teaching, punctuality, conduct, comment, req.session.username || null],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Evaluation saved" });
        }
    );
});

app.get("/staff-evaluations", requireLogin, requireAdmin, (req, res) => {
    let sql = "SELECT id, staff_username, week_start, teaching, punctuality, conduct, comment, created_by, created_at FROM staff_evaluations";
    const params = [];
    if (req.query.username) { sql += " WHERE staff_username = ?"; params.push(req.query.username); }
    sql += " ORDER BY week_start DESC, id DESC LIMIT 100";
    connection.query(sql, params, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

/* ---------- Finance: fee structure, payments, expenses -------------- */
app.get("/fee-structure", requireLogin, requireAdmin, (req, res) => {
    let sql = "SELECT class_name, term, session, amount FROM fee_structure";
    const params = [], wh = [];
    if (req.query.term)    { wh.push("term = ?");    params.push(req.query.term); }
    if (req.query.session) { wh.push("session = ?"); params.push(req.query.session); }
    if (wh.length) sql += " WHERE " + wh.join(" AND ");
    sql += " ORDER BY class_name";
    connection.query(sql, params, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.post("/fee-structure", requireLogin, requireAdmin, (req, res) => {
    const className = (req.body.class_name || "").trim();
    const term = (req.body.term || "").trim();
    const session = (req.body.session || "").trim();
    const amount = Number(req.body.amount);
    if (!className || !term || !session || !(amount >= 0)) {
        return res.status(400).json({ message: "class_name, term, session and a valid amount are required." });
    }
    connection.query(
        `INSERT INTO fee_structure (class_name, term, session, amount)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
        [className, term, session, amount],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Fee saved", class_name: className, amount });
        }
    );
});

app.post("/fee-payment", requireLogin, requireAdmin, (req, res) => {
    const studentId = (req.body.student_id || "").trim();
    const term = (req.body.term || "").trim();
    const session = (req.body.session || "").trim();
    const amount = Number(req.body.amount);
    const method = (req.body.method || "").trim();
    const note = (req.body.note || "").trim();
    if (!studentId || !term || !session || !(amount > 0)) {
        return res.status(400).json({ message: "student_id, term, session and an amount above 0 are required." });
    }
    connection.query(
        `INSERT INTO fee_payments (student_id, term, session, amount, method, note, received_by)
         VALUES (?,?,?,?,?,?,?)`,
        [studentId, term, session, amount, method, note, req.session.username || null],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Payment recorded", amount });
        }
    );
});

app.get("/fee-payments", requireLogin, requireAdmin, (req, res) => {
    let sql = "SELECT id, student_id, term, session, amount, method, note, received_by, paid_at FROM fee_payments";
    const params = [], wh = [];
    if (req.query.student_id) { wh.push("student_id = ?"); params.push(req.query.student_id); }
    if (req.query.term)       { wh.push("term = ?");       params.push(req.query.term); }
    if (req.query.session)    { wh.push("session = ?");    params.push(req.query.session); }
    if (wh.length) sql += " WHERE " + wh.join(" AND ");
    sql += " ORDER BY paid_at DESC LIMIT 200";
    connection.query(sql, params, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.get("/fee-balance", requireLogin, requireAdmin, (req, res) => {
    const term = (req.query.term || "").trim();
    const session = (req.query.session || "").trim();
    const className = (req.query.class_name || "").trim();
    if (!term || !session) return res.status(400).json({ message: "term and session are required." });
    let sql = `
        SELECT s.student_id, s.full_name, s.class_name,
               COALESCE(fs.amount, 0) AS fee,
               COALESCE(p.paid, 0) AS paid,
               (COALESCE(fs.amount, 0) - COALESCE(p.paid, 0)) AS balance
        FROM students s
        LEFT JOIN fee_structure fs
               ON fs.class_name = s.class_name AND fs.term = ? AND fs.session = ?
        LEFT JOIN (SELECT student_id, SUM(amount) AS paid
                     FROM fee_payments WHERE term = ? AND session = ?
                    GROUP BY student_id) p ON p.student_id = s.student_id
    `;
    const params = [term, session, term, session];
    if (className) { sql += " WHERE s.class_name = ?"; params.push(className); }
    sql += " ORDER BY s.class_name, s.full_name";
    connection.query(sql, params, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.get("/finance-summary", requireLogin, requireAdmin, (req, res) => {
    const term = (req.query.term || "").trim();
    const session = (req.query.session || "").trim();
    if (!term || !session) return res.status(400).json({ message: "term and session are required." });
    const expectedSql = `
        SELECT COALESCE(SUM(fs.amount * c.cnt), 0) AS expected
        FROM fee_structure fs
        JOIN (SELECT class_name, COUNT(*) AS cnt FROM students GROUP BY class_name) c
          ON c.class_name = fs.class_name
        WHERE fs.term = ? AND fs.session = ?
    `;
    connection.query(expectedSql, [term, session], (err, expRows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        connection.query(
            "SELECT COALESCE(SUM(amount),0) AS received, COUNT(*) AS cnt FROM fee_payments WHERE term = ? AND session = ?",
            [term, session],
            (err2, payRows) => {
                if (err2) { console.log(err2); return res.status(500).json({ message: "Database error" }); }
                connection.query(
                    "SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM expenses",
                    (err3, costRows) => {
                        if (err3) { console.log(err3); return res.status(500).json({ message: "Database error" }); }
                        const expected = Number(expRows[0].expected);
                        const received = Number(payRows[0].received);
                        res.json({
                            expected,
                            received,
                            payments_count: Number(payRows[0].cnt),
                            outstanding: expected - received,
                            expenses_total: Number(costRows[0].total),
                            expenses_count: Number(costRows[0].cnt),
                            term, session
                        });
                    }
                );
            }
        );
    });
});

app.get("/expenses", requireLogin, requireAdmin, (req, res) => {
    connection.query(
        "SELECT id, title, category, amount, spent_on, note, created_at FROM expenses ORDER BY spent_on DESC, id DESC LIMIT 300",
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

app.post("/expenses", requireLogin, requireAdmin, (req, res) => {
    const title = (req.body.title || "").trim();
    const category = (req.body.category || "").trim();
    const amount = Number(req.body.amount);
    const spentOn = (req.body.spent_on || "").trim() || null;
    const note = (req.body.note || "").trim();
    if (!title || !(amount > 0)) {
        return res.status(400).json({ message: "A title and an amount above 0 are required." });
    }
    connection.query(
        "INSERT INTO expenses (title, category, amount, spent_on, note) VALUES (?,?,?,?,?)",
        [title, category, amount, spentOn, note],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Expense recorded", amount });
        }
    );
});

app.delete("/expense/:id", requireLogin, requireAdmin, (req, res) => {
    connection.query("DELETE FROM expenses WHERE id = ?", [req.params.id], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "Expense deleted" });
    });
});


/* =====================================================================
   NEW (pack 14) - payment delete, attendance "already taken" summary,
   school settings, sessions, user management. All additive.
   ===================================================================== */

/* ---------- Delete a fee payment (owner request) -------------------- */
app.delete("/fee-payment/:id", requireLogin, requireAdmin, (req, res) => {
    connection.query("DELETE FROM fee_payments WHERE id = ?", [req.params.id], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "Payment deleted" });
    });
});

/* ---------- Attendance "already taken for this date" summary --------
   Lets the register WARN before re-taking (avoids duplicate surprises);
   editing and saving again stays fully allowed (upsert). */
app.get("/attendance/summary", requireLogin, (req, res) => {
    const className = (req.query.class_name || "").trim();
    const date = (req.query.date || "").trim();
    if (!className || !date) return res.status(400).json({ message: "class_name and date are required." });
    connection.query(
        `SELECT COUNT(*) AS total,
                SUM(status = 'present') AS present,
                SUM(status = 'absent')  AS absent,
                SUM(status = 'late')    AS late,
                MAX(marked_by) AS marked_by,
                MAX(created_at) AS saved_at
         FROM attendance
         WHERE class_name = ? AND att_date = ?`,
        [className, date],
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            const r = rows && rows[0] ? rows[0] : {};
            res.json({
                taken: Number(r.total) > 0,
                total: Number(r.total) || 0,
                present: Number(r.present) || 0,
                absent: Number(r.absent) || 0,
                late: Number(r.late) || 0,
                marked_by: r.marked_by || null,
                saved_at: r.saved_at || null
            });
        }
    );
});

/* ---------- School settings (admin) ----------------------------------
   GET is public so the website can show the correct contact details. */
app.get("/school-settings", (req, res) => {
    connection.query("SELECT * FROM school_settings WHERE id = 1", (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows && rows.length ? rows[0] : {});
    });
});

app.post("/school-settings", requireLogin, requireAdmin, (req, res) => {
    const f = k => String(req.body[k] == null ? "" : req.body[k]).trim();
    connection.query(
        `INSERT INTO school_settings
         (id, school_name, school_name_ar, motto, motto_ar, address, phone1, phone2, email)
         VALUES (1,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           school_name = VALUES(school_name), school_name_ar = VALUES(school_name_ar),
           motto = VALUES(motto), motto_ar = VALUES(motto_ar), address = VALUES(address),
           phone1 = VALUES(phone1), phone2 = VALUES(phone2), email = VALUES(email)`,
        [f("school_name"), f("school_name_ar"), f("motto"), f("motto_ar"), f("address"), f("phone1"), f("phone2"), f("email")],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "School settings saved" });
        }
    );
});

/* ---------- Academic sessions (admin creates) ------------------------ */
app.get("/sessions", requireLogin, (req, res) => {
    connection.query("SELECT session, is_current FROM sessions ORDER BY session", (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.post("/session", requireLogin, requireAdmin, (req, res) => {
    const session = (req.body.session || "").trim();
    const makeCurrent = Number(req.body.is_current) ? 1 : 0;
    if (!session) return res.status(400).json({ message: "Session is required (e.g. 2027/2028)." });
    const insert = () => {
        connection.query(
            "INSERT INTO sessions (session, is_current) VALUES (?, ?) ON DUPLICATE KEY UPDATE is_current = IF(?, 1, is_current)",
            [session, makeCurrent, makeCurrent],
            (err) => {
                if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
                res.json({ message: "Session saved", session, is_current: makeCurrent });
            }
        );
    };
    if (makeCurrent) {
        connection.query("UPDATE sessions SET is_current = 0", (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            insert();
        });
    } else {
        insert();
    }
});

/* ---------- User management (admin creates users of ANY role) -------
   "Let admin be able to create user either admin or teacher and any
   other positions." New roles act like teacher-level everywhere
   (only 'admin' gets admin powers), until you ask otherwise. */
app.get("/users", requireLogin, requireAdmin, (req, res) => {
    connection.query("SELECT id, username, role FROM users ORDER BY username", (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.post("/create-user", requireLogin, requireAdmin, (req, res) => {
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";
    const role = (req.body.role || "teacher").trim().toLowerCase().replace(/[^a-z_]/g, "") || "teacher";
    if (!username || password.length < 4) {
        return res.status(400).json({ message: "Username and a password of at least 4 characters are required." });
    }
    connection.query("SELECT id FROM users WHERE username = ?", [username], (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        if (rows.length) return res.status(409).json({ message: "That username already exists." });
        bcrypt.hash(password, 10, (herr, hash) => {
            if (herr) { console.log(herr); return res.status(500).json({ message: "Error securing password" }); }
            connection.query("INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
                [username, hash, role],
                (err2) => {
                    if (err2) { console.log(err2); return res.status(500).json({ message: "Database error" }); }
                    res.json({ message: "User created", username, role });
                });
        });
    });
});

app.post("/reset-user-password", requireLogin, requireAdmin, (req, res) => {
    const userId = Number(req.body.user_id);
    const password = req.body.password || "";
    if (!userId || password.length < 4) {
        return res.status(400).json({ message: "User and a password of at least 4 characters are required." });
    }
    bcrypt.hash(password, 10, (herr, hash) => {
        if (herr) { console.log(herr); return res.status(500).json({ message: "Error securing password" }); }
        connection.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, userId], (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Password reset" });
        });
    });
});

app.delete("/user/:id", requireLogin, requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (userId === req.session.userId) {
        return res.status(400).json({ message: "You cannot delete your own account." });
    }
    connection.query("DELETE FROM users WHERE id = ?", [userId], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "User deleted" });
    });
});

app.get("/test", (req, res) => {
    res.send("Server is working");
});

// Handle multer errors (bad file type, too large, etc.) with a clean response
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message === "Only JPG and PNG images are allowed.") {
        return res.status(400).send(err.message);
    }
    next(err);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});