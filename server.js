require("dotenv").config();

// NEW (Pack 63): Global Crash Shield - prevents Node.js from exiting on unhandled errors
process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception caught:", err);
});
process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection caught:", reason);
});

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

// NEW (Pack 54/55): Explicit high-priority SEO routes for Google crawler & Search Console
app.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    res.send("User-agent: Googlebot\nAllow: /\nDisallow: /api/\nDisallow: /sql/\n\nUser-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /sql/\n\nSitemap: https://result-1rto.onrender.com/sitemap.xml\n");
});

app.get("/sitemap.xml", (req, res) => {
    res.type("application/xml");
    res.sendFile(path.join(__dirname, "sitemap.xml"));
});

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

/* NEW (pack 25 - owner: "Build it that it will accept 1000 users and
   will not collapse"): the default session store keeps every login in
   PROCESS MEMORY - it warns in production and grows without limit with
   hundreds of parents/staff. Sessions now live in a MySQL table
   (survives restarts too). Express-session Store contract, no new
   packages needed. */
class MySqlSessionStore extends session.Store {
    constructor(db) {
        super();
        this.db = db;
        this.tableReady = false;
        this.ready = new Promise((resolve) => {
            db.query(
                `CREATE TABLE IF NOT EXISTS app_sessions (
                    sid VARCHAR(128) PRIMARY KEY,
                    sess MEDIUMTEXT NOT NULL,
                    expires_at BIGINT NOT NULL,
                    INDEX (expires_at)
                )`,
                () => { this.tableReady = true; resolve(); }
            );
        });
        setInterval(() => {
            if (!this.tableReady) return;
            db.query("DELETE FROM app_sessions WHERE expires_at < ?", [Date.now()], () => {});
        }, 1000 * 60 * 60).unref(); // hourly sweep of expired rows
    }
    whenReady(cb) {
        if (this.tableReady) return cb();
        this.ready.then(cb);
    }
    get(sid, cb) {
        this.whenReady(() => {
            this.db.query("SELECT sess, expires_at FROM app_sessions WHERE sid = ?", [sid], (err, rows) => {
                if (err) return cb(null, null); // read hiccup -> treat as logged out, never crash
                if (!rows || !rows.length) return cb(null, null);
                if (rows[0].expires_at && rows[0].expires_at < Date.now()) {
                    return this.destroy(sid, () => cb(null, null));
                }
                try { cb(null, JSON.parse(rows[0].sess)); } catch (e) { cb(null, null); }
            });
        });
    }
    set(sid, sess, cb) {
        const maxAge = (sess.cookie && sess.cookie.maxAge) || (1000 * 60 * 60 * 8);
        const expires = Date.now() + maxAge;
        const data = JSON.stringify(sess);
        this.whenReady(() => {
            this.db.query(
                "INSERT INTO app_sessions (sid, sess, expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE sess = VALUES(sess), expires_at = VALUES(expires_at)",
                [sid, data, expires],
                (err) => cb && cb(err)
            );
        });
    }
    destroy(sid, cb) {
        this.whenReady(() => {
            this.db.query("DELETE FROM app_sessions WHERE sid = ?", [sid], (err) => cb && cb(err));
        });
    }
    touch(sid, sess, cb) {
        const maxAge = (sess.cookie && sess.cookie.maxAge) || (1000 * 60 * 60 * 8);
        this.whenReady(() => {
            this.db.query("UPDATE app_sessions SET expires_at = ? WHERE sid = ?", [Date.now() + maxAge, sid], (err) => cb && cb(err));
        });
    }
}
const sessionStore = new MySqlSessionStore(connection);

app.use(session({
    secret: process.env.SESSION_SECRET || "local-dev-only-insecure-secret-change-me",
    store: sessionStore, // pack 25: MySQL-backed sessions
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
                return res.status(500).json({ message: "Database Error: " + (err.sqlMessage || err.message || "Could not check users table") });
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
// NEW (pack 24 - owner: "add chat in the side bar for admin and
// teachers"): dedicated staff chat page, guarded exactly like the
// dashboard. Must stay BEFORE express.static.
app.get("/chat.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "chat.html"));
});

// NEW (pack 25): staff notifications / settings / timetable pages -
// same guard as the dashboard (admin AND teachers).
app.get("/notifications.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "notifications.html"));
});
app.get("/settings.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "settings.html"));
});
app.get("/timetable.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "timetable.html"));
});
// NEW (pack 35): certificate generator page (staff only, all client-side)
app.get("/certificates.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "certificates.html"));
});

// NEW (pack 26): the sections the owner moved OUT of the dashboard now
// live on their own pages - same guard as the dashboard (admin + teachers).
app.get("/scores.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "scores.html"));
});
app.get("/notices.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "notices.html"));
});
// NEW (pack 27): the AI Remarks helper page - staff only, same guard style.
app.get("/ai-remarks.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "ai-remarks.html"));
});

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

// NEW (pack 15): calendar editor page - staff can view/print; saving,
// publishing and deleting stay admin-only at the API level.
app.get("/manage-calendars.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "manage-calendars.html"));
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

/* ==================================================================
   FIX (pack 20 - owner: "why is the signature disappearing after some
   time - fix that"): Render (and any cloud host) wipes the app's disk
   on every restart/deploy, so every uploaded image slowly vanished -
   signatures, class signatures, student photos, parent payment proofs
   and receipt snaps. From pack 20 every upload is ALSO stored in the
   database (LONGBLOB column, added by the guarded migration further
   down), and this middleware rebuilds any missing file from the
   database the moment it is requested again. Nothing about the stored
   file paths, routes or readers changes.
================================================================== */
const imageDbSources = [
    // [urlPrefix, table, pathColumn, dataColumn]
    ["/images/signatures/", "signatures", "signature_path", "signature_data"],
    ["/images/signatures/", "class_teacher_signatures", "signature_path", "signature_data"],
    ["/images/students/", "students", "photo_path", "photo_data"],
    ["/uploads/payment-evidence/", "payment_submissions", "evidence_path", "evidence_data"],
    ["/uploads/payment-evidence/", "fee_payments", "receipt_path", "receipt_data"]
];

function tryRestoreImage(relPath, sources, idx, done) {
    if (idx >= sources.length) return done(false);
    const [prefix, table, pathCol, dataCol] = sources[idx];
    if (relPath.indexOf(prefix.replace(/^\//, "")) !== 0) return tryRestoreImage(relPath, sources, idx + 1, done);
    // ?? = escaped identifier (mysql2 built-in), ? = value.
    connection.query(
        "SELECT ?? AS img FROM ?? WHERE ?? = ? LIMIT 1",
        [dataCol, table, pathCol, relPath],
        (err, rows) => {
            if (err || !rows || !rows.length || !rows[0].img) {
                return tryRestoreImage(relPath, sources, idx + 1, done);
            }
            try {
                const abs = path.join(__dirname, relPath);
                fs.mkdirSync(path.dirname(abs), { recursive: true });
                fs.writeFileSync(abs, rows[0].img);
                return done(true);
            } catch (wErr) {
                console.log("Image restore failed for", relPath, wErr.message || wErr);
                return done(false);
            }
        }
    );
}

app.use((req, res, next) => {
    // Only look at GETs under the upload folders; everything else passes.
    if (req.method !== "GET") return next();
    const urlPath = req.path;
    if (!/^\/(images\/(signatures|students)|uploads\/payment-evidence)\//.test(urlPath)) return next();
    if (urlPath.indexOf("..") !== -1) return next();
    const relPath = urlPath.replace(/^\//, "");
    const abs = path.join(__dirname, relPath);
    if (fs.existsSync(abs)) return next();          // file alive - normal static serve
    tryRestoreImage(relPath, imageDbSources, 0, (restored) => next()); // rebuilt or not - continue either way
});

/* FIX (pack 20): save-image queries now also store the bytes in the
   pack-20 backup columns. During the very first boot after deploy the
   migration may still be running (columns missing -> ER_BAD_FIELD_ERROR);
   then we silently retry with the pre-pack-20 columns so saves NEVER fail.
*/
function queryImageSave(sqlWithData, paramsWithData, sqlWithout, paramsWithout, cb) {
    connection.query(sqlWithData, paramsWithData, (err, result) => {
        if (err && err.code === "ER_BAD_FIELD_ERROR") {
            return connection.query(sqlWithout, paramsWithout, cb);
        }
        cb(err, result);
    });
}

/* FIX (pack 20): student photos get their database copy via a small
   follow-up UPDATE after any successful photo write (keeps the original
   multi-branch INSERT/UPDATE code untouched). Swallowed on failure - the
   photo itself is already saved to disk, the backup just waits for the
   next write or the migration window to pass. */
function backupStudentPhoto(studentId, filePath) {
    if (!filePath || !studentId) return;
    let data;
    try { data = fs.readFileSync(filePath); } catch (e) { return; }
    connection.query("UPDATE students SET photo_data = ? WHERE student_id = ?", [data, studentId], () => {});
}

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

// NEW (Pack 67): Zero-Configuration Auto-Schema & Default Admin Bootstrapper
// Automatically creates all core legacy tables if they don't exist in a new MySQL database
// (e.g. fresh Railway deployment) and seeds a default Admin account (username: admin, password: 0802).
function ensureCoreTablesAndDefaultAdmin() {
    const coreTables = [
        `CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'teacher',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS students (
            student_id VARCHAR(64) PRIMARY KEY,
            full_name VARCHAR(160) NOT NULL,
            gender VARCHAR(20) DEFAULT '',
            class_name VARCHAR(100) DEFAULT '',
            date_of_birth DATE NULL,
            photo_path VARCHAR(255) DEFAULT '',
            photo_data LONGBLOB NULL,
            parent_name VARCHAR(160) DEFAULT '',
            parent_phone VARCHAR(60) DEFAULT '',
            address VARCHAR(255) DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS results (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_id VARCHAR(64) NOT NULL,
            student_name VARCHAR(160) DEFAULT '',
            class_name VARCHAR(100) DEFAULT '',
            term VARCHAR(50) DEFAULT '',
            session VARCHAR(50) DEFAULT '',
            subject VARCHAR(120) DEFAULT '',
            first_test DECIMAL(5,2) DEFAULT 0,
            second_test DECIMAL(5,2) DEFAULT 0,
            note_score DECIMAL(5,2) DEFAULT 0,
            attendance_score DECIMAL(5,2) DEFAULT 0,
            ca_score DECIMAL(5,2) DEFAULT 0,
            exam_score DECIMAL(5,2) DEFAULT 0,
            total DECIMAL(5,2) DEFAULT 0,
            grade VARCHAR(10) DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS classes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            class_name VARCHAR(100) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS subjects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            class_name VARCHAR(100) NOT NULL,
            subject_name VARCHAR(120) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS exams (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            class_name VARCHAR(100) NOT NULL,
            subject VARCHAR(120) NOT NULL,
            term VARCHAR(50) NOT NULL,
            session VARCHAR(50) NOT NULL,
            duration VARCHAR(100) NULL,
            instructions TEXT NULL,
            body_html LONGTEXT NOT NULL,
            created_by VARCHAR(100) NULL,
            exam_date DATE NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS signatures (
            id INT AUTO_INCREMENT PRIMARY KEY,
            role VARCHAR(50) NOT NULL UNIQUE,
            signature_path VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ];

    coreTables.forEach(sql => {
        connection.query(sql, (err) => {
            if (err) console.error("Core table creation error:", err.message || err);
        });
    });

    connection.query("SELECT COUNT(*) AS cnt FROM users", (err, rows) => {
        if (!err && rows && rows[0] && rows[0].cnt === 0) {
            bcrypt.hash("0802", 10, (herr, hash) => {
                if (!herr && hash) {
                    connection.query("INSERT IGNORE INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')", [hash], () => {
                        console.log("Seeded default admin account (username: admin, password: 0802)");
                    });
                    connection.query("INSERT IGNORE INTO users (username, password_hash, role) VALUES ('Proprietor', ?, 'admin')", [hash], () => {});
                }
            });
        }
    });
}
ensureCoreTablesAndDefaultAdmin();

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
    // NEW (pack 15 - fee types, owner request: "school fee, developmental
    // fee, exam fee, and so on" - each with its own amount per class).
    `CREATE TABLE IF NOT EXISTS fee_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // NEW (pack 15): fee amounts per fee TYPE per class per term/session.
    // The older fee_structure table stays untouched (migrated as School Fee).
    `CREATE TABLE IF NOT EXISTS fee_structure2 (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fee_type VARCHAR(120) NOT NULL DEFAULT 'School Fee',
        class_name VARCHAR(150) NOT NULL,
        term VARCHAR(50) NOT NULL,
        session VARCHAR(50) NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_ft_class_term_session (fee_type, class_name, term, session)
    )`,
    // NEW (pack 15): many bank accounts shown on the parent portal as
    // "where to pay" details.
    `CREATE TABLE IF NOT EXISTS bank_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bank_name VARCHAR(150) NOT NULL,
        account_name VARCHAR(150),
        account_number VARCHAR(60) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // NEW (pack 15): parents upload a screenshot/PDF of their payment;
    // admin approves (it becomes a real payment) or rejects it.
    `CREATE TABLE IF NOT EXISTS payment_submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id VARCHAR(100) NOT NULL,
        fee_type VARCHAR(120) NOT NULL DEFAULT 'School Fee',
        term VARCHAR(50) NOT NULL,
        session VARCHAR(50) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        note VARCHAR(255),
        evidence_path VARCHAR(255),
        status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        reviewed_by VARCHAR(100),
        reviewed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // NEW (pack 15): termly madrasah calendar. published=1 shows it on
    // the parent portal; publishing one auto-unpublishes the rest so
    // parents never see duplicates from different terms (owner request).
    `CREATE TABLE IF NOT EXISTS calendars (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        doc LONGTEXT,
        published TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
    )`,
    // NEW (Pack 47 - School File Store & Digital Vault for documents/records).
    `CREATE TABLE IF NOT EXISTS school_file_store (
        id INT AUTO_INCREMENT PRIMARY KEY,
        folder_path VARCHAR(255) NOT NULL DEFAULT '/',
        file_name VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
        file_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
        file_path VARCHAR(500) NOT NULL DEFAULT '',
        is_folder TINYINT(1) NOT NULL DEFAULT 0,
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
                    console.log("Add-on tables ready (...,school_settings, sessions, fee_types, fee_structure2, bank_accounts, payment_submissions, calendars).");
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
   NEW (pack 15 - finance v2): safe, guarded migrations +
   one-time seeding. Same pattern as the student-profile columns:
   check information_schema first, ALTER only when needed, never
   error on re-boots, app keeps working if anything is denied.
     1. fee_payments gains a fee_type column (default 'School Fee').
     2. school_settings gains due_day + current_term columns.
     3. fee_types seeded with School Fee / Developmental Fee / Exam Fee.
     4. old fee_structure rows copied into fee_structure2 as School Fee
        (INSERT IGNORE - runs every boot but only ever inserts once).
================================================================== */
function runPack15Migrations(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return pack15Retry(attempt, err); }
        const steps = [
            // 1) fee_type on fee_payments
            `ALTER TABLE fee_payments
               ADD COLUMN fee_type VARCHAR(120) NOT NULL DEFAULT 'School Fee'`,
            // 2) due_day + current_term on school_settings
            `ALTER TABLE school_settings
               ADD COLUMN due_day INT NOT NULL DEFAULT 10,
               ADD COLUMN current_term VARCHAR(50) NOT NULL DEFAULT '1st Term'`,
            // 3) seed fee types
            `INSERT IGNORE INTO fee_types (name) VALUES ('School Fee'), ('Developmental Fee'), ('Exam Fee')`,
            // 4) copy v1 structure into v2 (idempotent)
            `INSERT IGNORE INTO fee_structure2 (fee_type, class_name, term, session, amount)
                SELECT 'School Fee', class_name, term, session, amount FROM fee_structure`
        ];
        let finished = 0;
        let missingTable = false;
        steps.forEach((sql, i) => {
            conn.query(sql, (qErr) => {
                // Duplicate-column race with a parallel boot is fine.
                if (qErr && qErr.code !== "ER_DUP_FIELDNAME" && qErr.code !== "ER_DUP_ENTRY") {
                    console.log("Pack 15 migration step " + (i + 1) + " notice:", qErr.code || qErr.message);
                    // FIX: the add-on tables are created by a SEPARATE boot
                    // task - if it hasn't finished yet, retry the whole
                    // batch a few seconds later so seeding never gets lost.
                    if (qErr.code === "ER_NO_SUCH_TABLE") missingTable = true;
                }
                finished++;
                if (finished === steps.length) {
                    conn.end();
                    if (missingTable) return pack15Retry(attempt, { code: "ER_NO_SUCH_TABLE" });
                    console.log("Pack 15 setup ready (fee types, structure v2, settings v2).");
                }
            });
        });
    });
}
function pack15Retry(attempt, err) {
    if (attempt >= 6) {
        console.log("Pack 15 setup warning:", err.code || err.message || err);
        return;
    }
    setTimeout(() => runPack15Migrations(attempt + 1), 4000);
}
runPack15Migrations(1);

/* ------------------------------------------------------------------
   NEW (pack 17 - owner request): receipt photo on each recorded payment.
   Admin snaps/uploads the receipt written in school; parents see it in
   their portal; admin can remove it. Guarded + idempotent, same pattern
   as the pack-15 migrations above.
------------------------------------------------------------------ */
function runPack17Migrations(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return pack17Retry(attempt, err); }
        let missingTable = false;
        conn.query(
            `ALTER TABLE fee_payments ADD COLUMN receipt_path VARCHAR(255) NULL`,
            (qErr) => {
                if (qErr && qErr.code !== "ER_DUP_FIELDNAME") {
                    console.log("Pack 17 migration notice:", qErr.code || qErr.message);
                    if (qErr.code === "ER_NO_SUCH_TABLE") missingTable = true;
                }
                conn.end();
                if (missingTable) return pack17Retry(attempt, { code: "ER_NO_SUCH_TABLE" });
                console.log("Pack 17 setup ready (payment receipt photos).");
            }
        );
    });
}
function pack17Retry(attempt, err) {
    if (attempt >= 6) {
        console.log("Pack 17 setup warning:", err.code || err.message || err);
        return;
    }
    setTimeout(() => runPack17Migrations(attempt + 1), 4000);
}
runPack17Migrations(1);

/* ------------------------------------------------------------------
   FIX (pack 20 - owner: "signature disappearing after some time"):
   keep a DATABASE COPY of every uploaded image, so a wiped disk can
   always be rebuilt. Same guarded/idempotent pattern as packs 15/17:
   ADD COLUMN is swallowed when it already exists (ER_DUP_FIELDNAME).
   Then a one-time hydration pass re-materialises any files already
   lost for rows that DO have a database copy.
------------------------------------------------------------------ */
function runPack20Migrations(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return pack20Retry(attempt, err); }
        const alters = [
            "ALTER TABLE signatures ADD COLUMN signature_data LONGBLOB NULL",
            "ALTER TABLE class_teacher_signatures ADD COLUMN signature_data LONGBLOB NULL",
            "ALTER TABLE students ADD COLUMN photo_data LONGBLOB NULL",
            "ALTER TABLE payment_submissions ADD COLUMN evidence_data LONGBLOB NULL",
            "ALTER TABLE fee_payments ADD COLUMN receipt_data LONGBLOB NULL"
        ];
        let missingTable = false;
        let i = 0;
        (function nextAlter() {
            if (i >= alters.length) {
                conn.end();
                console.log("Pack 20 setup ready (database-backed uploads).");
                return hydrateUploadedImages();
            }
            conn.query(alters[i++], (qErr) => {
                if (qErr && qErr.code !== "ER_DUP_FIELDNAME") {
                    console.log("Pack 20 migration notice:", qErr.code || qErr.message);
                    if (qErr.code === "ER_NO_SUCH_TABLE") missingTable = true;
                }
                if (missingTable) { conn.destroy(); return pack20Retry(attempt, { code: "ER_NO_SUCH_TABLE" }); }
                nextAlter();
            });
        })();
    });
}
function pack20Retry(attempt, err) {
    if (attempt >= 6) {
        console.log("Pack 20 setup warning:", err.code || err.message || err);
        return;
    }
    setTimeout(() => runPack20Migrations(attempt + 1), 4000);
}
runPack20Migrations(1);

/* ==================================================================
   NEW (pack 28 - owner: "Allow voice note ... also different chat for
   admin and teacher"): messages table grows:
     1. thread    - 'admin' or 'teacher' so the parent portal shows TWO
                    separate conversations (office vs class teacher).
     2. kind      - 'text' or 'voice'.
     3. duration  - voice-note length in seconds.
     4. voice_data + voice_mime - the audio lives IN the database
        (Render's disk is wiped on every deploy; DB is forever).
   Guarded + idempotent, same pattern as packs 15/17/20/22.
================================================================== */
function runPack28Migrations(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return pack28Retry(attempt, err); }
        const alters = [
            "ALTER TABLE messages ADD COLUMN thread VARCHAR(8) NOT NULL DEFAULT 'admin'",
            "ALTER TABLE messages ADD COLUMN kind VARCHAR(8) NOT NULL DEFAULT 'text'",
            "ALTER TABLE messages ADD COLUMN duration INT NULL",
            "ALTER TABLE messages ADD COLUMN voice_data LONGBLOB NULL",
            "ALTER TABLE messages ADD COLUMN voice_mime VARCHAR(64) NULL"
        ];
        let missingTable = false;
        let i = 0;
        (function nextAlter() {
            if (i >= alters.length) {
                // backfill: parent mail's thread is exactly who it was sent to
                conn.query("UPDATE messages SET thread = recipient_type WHERE sender_type = 'portal'", () => {
                    conn.end();
                    console.log("Pack 28 setup ready (voice notes + admin/teacher chat threads).");
                });
                return;
            }
            conn.query(alters[i++], (qErr) => {
                if (qErr && qErr.code !== "ER_DUP_FIELDNAME") {
                    console.log("Pack 28 migration notice:", qErr.code || qErr.message);
                    if (qErr.code === "ER_NO_SUCH_TABLE") missingTable = true;
                }
                if (missingTable) { conn.destroy(); return pack28Retry(attempt, { code: "ER_NO_SUCH_TABLE" }); }
                nextAlter();
            });
        })();
    });
}
function pack28Retry(attempt, err) {
    if (attempt >= 6) {
        console.log("Pack 28 setup warning:", err.code || err.message || err);
        return;
    }
    setTimeout(() => runPack28Migrations(attempt + 1), 4000);
}
runPack28Migrations(1);

/* ==================================================================
   NEW (pack 29 - owner: "make all the ai working"): the admin can now
   add the free AI key INSIDE the app (AI Chat page) - it is stored in
   the `ai_config` table below and instantly wakes up EVERY AI feature
   (staff AI chat, exam question writer, website assistant). No Render
   dashboard, no redeploy. Guarded + idempotent like the packs above.
================================================================== */
function runPack29Migrations(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return pack29Retry(attempt, err); }
        conn.query(
            "CREATE TABLE IF NOT EXISTS ai_config (" +
            "id TINYINT PRIMARY KEY DEFAULT 1, " +
            "api_key VARCHAR(512) NULL, " +
            "base_url VARCHAR(255) NULL, " +
            "model VARCHAR(128) NULL, " +
            "updated_by VARCHAR(60) NULL, " +
            "updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)",
            (qErr) => {
                if (qErr) console.log("Pack 29 migration notice:", qErr.code || qErr.message);
                conn.end();
                if (!qErr) console.log("Pack 29 setup ready (AI key can be saved inside the app).");
            }
        );
    });
}
function pack29Retry(attempt, err) {
    if (attempt >= 6) { console.log("Pack 29 setup warning:", err.code || err.message || err); return; }
    setTimeout(() => runPack29Migrations(attempt + 1), 4000);
}
runPack29Migrations(1);

/* ==================================================================
   NEW (pack 32 - owner picked "push notifications" from the ideas
   menu): WEB PUSH. phones ring even when the app is fully closed.
   Two tables:
     push_keys          - the school's VAPID identity is created BY THE
                          APP on first boot and kept here forever (no
                          Render env vars needed - set them if you prefer).
     push_subscriptions - one row per phone that tapped "Enable alerts".
================================================================== */
function runPack32Migrations(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return pack32Retry(attempt, err); }
        const creates = [
            "CREATE TABLE IF NOT EXISTS push_keys (" +
            "id TINYINT PRIMARY KEY DEFAULT 1, " +
            "public_key VARCHAR(128) NOT NULL, " +
            "private_key VARCHAR(128) NOT NULL, " +
            "created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP)",
            "CREATE TABLE IF NOT EXISTS push_subscriptions (" +
            "id INT AUTO_INCREMENT PRIMARY KEY, " +
            "endpoint TEXT NOT NULL, " +
            "user_type VARCHAR(8) NOT NULL, " +
            "user_ref VARCHAR(64) NOT NULL, " +
            "keys_p256dh VARCHAR(128) NOT NULL, " +
            "keys_auth VARCHAR(64) NOT NULL, " +
            "created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, " +
            "last_seen_at TIMESTAMP NULL, " +
            "UNIQUE KEY uq_push_endpoint (endpoint(180)))"
        ];
        let i = 0;
        (function nextC() {
            if (i >= creates.length) {
                conn.end();
                console.log("Pack 32 setup ready (web push).");
                pushInit(1); // identity comes after tables exist
                return;
            }
            conn.query(creates[i++], (qErr) => {
                if (qErr) console.log("Pack 32 migration notice:", qErr.code || qErr.message);
                nextC();
            });
        })();
    });
}
function pack32Retry(attempt, err) {
    if (attempt >= 6) { console.log("Pack 32 setup warning:", err.code || err.message || err); return; }
    setTimeout(() => runPack32Migrations(attempt + 1), 4000);
}
runPack32Migrations(1);

/* ------------------------------------------------------------------
   NEW (pack 22 - owner requests): announcement AUDIENCES
   (teacher/student/parent/general) + announcement-or-EVENT kind +
   exam timetable dates. Guarded + idempotent like packs 15/17/20.
------------------------------------------------------------------ */
function runPack22Migrations(attempt) {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return pack22Retry(attempt, err); }
        const alters = [
            "ALTER TABLE announcements ADD COLUMN audience VARCHAR(16) NOT NULL DEFAULT 'general'",
            "ALTER TABLE announcements ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'announcement'",
            "ALTER TABLE announcements ADD COLUMN event_date DATE NULL",
            "ALTER TABLE exams ADD COLUMN exam_date DATE NULL"
        ];
        let missingTable = false;
        let i = 0;
        (function nextAlter() {
            if (i >= alters.length) {
                conn.end();
                console.log("Pack 22 setup ready (announcement audiences, exam dates).");
                return;
            }
            conn.query(alters[i++], (qErr) => {
                if (qErr && qErr.code !== "ER_DUP_FIELDNAME") {
                    console.log("Pack 22 migration notice:", qErr.code || qErr.message);
                    if (qErr.code === "ER_NO_SUCH_TABLE") missingTable = true;
                }
                if (missingTable) { conn.destroy(); return pack22Retry(attempt, { code: "ER_NO_SUCH_TABLE" }); }
                nextAlter();
            });
        })();
    });
}
function pack22Retry(attempt, err) {
    if (attempt >= 6) {
        console.log("Pack 22 setup warning:", err.code || err.message || err);
        return;
    }
    setTimeout(() => runPack22Migrations(attempt + 1), 4000);
}
runPack22Migrations(1);

/* ------------------------------------------------------------------
   NEW (pack 23 - owner requests): messaging (parent<->teacher,
   parent<->school), portal + staff SETTINGS, teacher->class
   assignment, friendly receipt view. Guarded + idempotent, additive.
------------------------------------------------------------------ */
function runPack23Migrations() {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return setTimeout(runPack23Migrations, 4000); }
        const steps = [
            // Parent<->school message thread table (+ read_at drives notifications).
            `CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sender_type VARCHAR(8) NOT NULL,
                sender_ref VARCHAR(64) NOT NULL,
                sender_name VARCHAR(160) DEFAULT '',
                recipient_type VARCHAR(8) NOT NULL,
                recipient_ref VARCHAR(64) DEFAULT '',
                recipient_class VARCHAR(120) DEFAULT '',
                body TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                read_at TIMESTAMP NULL DEFAULT NULL
            )`,
            // Which teacher teaches which class. Empty table = every teacher
            // sees all parent messages (safe default - nothing gets hidden).
            `CREATE TABLE IF NOT EXISTS teacher_classes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(64) NOT NULL,
                class_name VARCHAR(120) NOT NULL,
                UNIQUE KEY tc_uniq (username, class_name)
            )`,
            // Optional portal password: when set it REPLACES the surname login.
            "ALTER TABLE students ADD COLUMN portal_password VARCHAR(255) NULL"
        ];
        let i = 0;
        (function next() {
            if (i >= steps.length) { conn.end(); console.log("Pack 23 setup ready (messages, settings, teacher classes)."); return; }
            conn.query(steps[i++], (qErr) => {
                if (qErr && qErr.code !== "ER_DUP_FIELDNAME") console.log("Pack 23 migration notice:", qErr.code || qErr.message);
                next();
            });
        })();
    });
}
runPack23Migrations();

/* ------------------------------------------------------------------
   NEW (pack 37 - admission pipeline): enquiries can now carry gender /
   date of birth (collected at the one-tap ADMIT step), record WHICH
   student id the child became, and a 'declined' status. All guarded +
   idempotent + additive - existing enquiries keep working exactly as
   they did on pack 13.
------------------------------------------------------------------ */
function runPack37Migrations() {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return setTimeout(runPack37Migrations, 4000); }
        const steps = [
            "ALTER TABLE admission_enquiries ADD COLUMN gender VARCHAR(10) NULL",
            "ALTER TABLE admission_enquiries ADD COLUMN date_of_birth DATE NULL",
            "ALTER TABLE admission_enquiries ADD COLUMN admitted_student_id VARCHAR(64) NULL",
            "ALTER TABLE admission_enquiries ADD COLUMN admitted_at TIMESTAMP NULL DEFAULT NULL",
            "ALTER TABLE admission_enquiries MODIFY status ENUM('new','contacted','admitted','declined') NOT NULL DEFAULT 'new'"
        ];
        let i = 0;
        (function next() {
            if (i >= steps.length) { conn.end(); console.log("Pack 37 setup ready (admission pipeline)."); return; }
            conn.query(steps[i++], (qErr) => {
                if (qErr && qErr.code !== "ER_DUP_FIELDNAME") console.log("Pack 37 migration notice:", qErr.code || qErr.message);
                next();
            });
        })();
    });
}
runPack37Migrations();

/* ------------------------------------------------------------------
   NEW (pack 25 - owner: "Add exam and class timetable for admin and
   teachers, and it will display for students after been published").
   Two tables + publish gate: staff build freely, students/parents only
   ever see what admin has PUBLISHED. Guarded + idempotent.
------------------------------------------------------------------ */
function runPack25Migrations() {
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return setTimeout(runPack25Migrations, 4000); }
        const steps = [
            `CREATE TABLE IF NOT EXISTS exam_timetable (
                id INT AUTO_INCREMENT PRIMARY KEY,
                class_name VARCHAR(120) NOT NULL,
                subject VARCHAR(160) NOT NULL,
                exam_date DATE NULL,
                start_time VARCHAR(10) DEFAULT '',
                end_time VARCHAR(10) DEFAULT '',
                published TINYINT(1) NOT NULL DEFAULT 0,
                created_by VARCHAR(64) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS class_timetable (
                id INT AUTO_INCREMENT PRIMARY KEY,
                class_name VARCHAR(120) NOT NULL,
                day_of_week VARCHAR(12) NOT NULL,
                period_no INT NOT NULL DEFAULT 1,
                start_time VARCHAR(10) DEFAULT '',
                end_time VARCHAR(10) DEFAULT '',
                subject VARCHAR(160) NOT NULL,
                published TINYINT(1) NOT NULL DEFAULT 0,
                created_by VARCHAR(64) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];
        let i = 0;
        (function next() {
            if (i >= steps.length) { conn.end(); console.log("Pack 25 setup ready (timetables)."); return; }
            conn.query(steps[i++], (qErr) => {
                if (qErr) console.log("Pack 25 migration notice:", qErr.code || qErr.message);
                next();
            });
        })();
    });
}
runPack25Migrations();

/* =====================================================================
   NEW (pack 25): TIMETABLE API - staff CRUD + admin publish + portal.
===================================================================== */
["exam", "class"].forEach(function (kind) {
    const table = kind === "exam" ? "exam_timetable" : "class_timetable";

    // staff: read one class's rows
    app.get("/api/timetable/" + kind, requireLogin, (req, res) => {
        const cls = String(req.query.class_name || "");
        const orderBy = kind === "exam"
            ? "ORDER BY exam_date IS NULL, exam_date ASC, start_time ASC, id ASC"
            : "ORDER BY FIELD(day_of_week,'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), period_no ASC, id ASC";
        connection.query(
            "SELECT * FROM " + table + " WHERE class_name = ? " + orderBy + " LIMIT 400",
            [cls],
            (err, rows) => {
                if (err) { if (err.code === "ER_NO_SUCH_TABLE") return res.json([]); return res.status(500).json({ message: "Database error" }); }
                res.json(rows);
            }
        );
    });

    // staff (admin + teacher): add a row
    app.post("/api/timetable/" + kind, requireLogin, (req, res) => {
        const cls = String(req.body.class_name || "").trim();
        const subject = String(req.body.subject || "").trim();
        if (!cls || !subject) return res.status(400).json({ message: "Class and subject are required." });
        let cols, vals;
        if (kind === "exam") {
            cols = "(class_name, subject, exam_date, start_time, end_time, created_by)";
            vals = [cls, subject, req.body.exam_date || null, String(req.body.start_time || ""), String(req.body.end_time || ""), req.session.username];
        } else {
            const day = String(req.body.day_of_week || "").trim();
            if (!day) return res.status(400).json({ message: "Day is required." });
            cols = "(class_name, day_of_week, period_no, start_time, end_time, subject, created_by)";
            vals = [cls, day, Number(req.body.period_no) || 1, String(req.body.start_time || ""), String(req.body.end_time || ""), subject, req.session.username];
        }
        connection.query(
            "INSERT INTO " + table + " " + cols + " VALUES (" + cols.replace(/\(|\)/g, "").split(",").map(() => "?").join(",") + ")",
            vals,
            (err) => {
                if (err) return res.status(500).json({ message: "Database error" });
                res.json({ message: "Added - remember to Publish when it is ready." });
            }
        );
    });

    app.delete("/api/timetable/" + kind + "/:id", requireLogin, (req, res) => {
        connection.query("DELETE FROM " + table + " WHERE id = ?", [req.params.id], (err) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json({ message: "Removed." });
        });
    });

    // publish gate: ADMIN ONLY - students never see unpublished rows
    app.post("/api/timetable/" + kind + "/publish", requireLogin, requireAdmin, (req, res) => {
        const cls = String(req.body.class_name || "").trim();
        const pub = req.body.published ? 1 : 0;
        if (!cls) return res.status(400).json({ message: "Class is required." });
        connection.query(
            "UPDATE " + table + " SET published = ? WHERE class_name = ?",
            [pub, cls],
            (err) => {
                if (err) return res.status(500).json({ message: "Database error" });
                res.json({ message: pub ? "Published - students & parents of " + cls + " can see it now." : "Unpublished - hidden from students again." });
            }
        );
    });

    // portal: student/parent reads ONLY published rows of their own class
    app.get("/portal/timetable/" + kind, (req, res) => {
        const sid = req.session && req.session.portalStudentId;
        if (!sid) return res.status(401).json({ message: "Not logged in" });
        connection.query("SELECT class_name FROM students WHERE student_id = ? LIMIT 1", [sid], (err, stu) => {
            if (err || !stu.length) return res.json([]);
            const orderBy = kind === "exam"
                ? "ORDER BY exam_date IS NULL, exam_date ASC, start_time ASC, id ASC"
                : "ORDER BY FIELD(day_of_week,'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), period_no ASC, id ASC";
            connection.query(
                "SELECT * FROM " + table + " WHERE class_name = ? AND published = 1 " + orderBy + " LIMIT 400",
                [stu[0].class_name],
                (err2, rows) => {
                    if (err2) { if (err2.code === "ER_NO_SUCH_TABLE") return res.json([]); return res.json([]); }
                    res.json(rows);
                }
            );
        });
    });
});

// Rebuild every missing upload file that HAS a database copy (runs once
// at boot; the request-time middleware covers anything saved later).
function hydrateUploadedImages() {
    const jobs = [
        ["signatures", "signature_path", "signature_data"],
        ["class_teacher_signatures", "signature_path", "signature_data"],
        ["students", "photo_path", "photo_data"],
        ["payment_submissions", "evidence_path", "evidence_data"],
        ["fee_payments", "receipt_path", "receipt_data"]
    ];
    const conn = addonConnection();
    conn.connect((err) => {
        if (err) { conn.destroy(); return; }
        let done = 0, restored = 0;
        jobs.forEach(([table, pathCol, dataCol]) => {
            conn.query("SELECT ?? AS p, ?? AS d FROM ?? WHERE ?? IS NOT NULL", [pathCol, dataCol, table, dataCol], (qErr, rows) => {
                if (!qErr && rows) {
                    rows.forEach((r) => {
                        if (!r.p || !r.d) return;
                        const abs = path.join(__dirname, r.p);
                        if (fs.existsSync(abs)) return;
                        try {
                            fs.mkdirSync(path.dirname(abs), { recursive: true });
                            fs.writeFileSync(abs, r.d);
                            restored++;
                        } catch (e) { /* disk read-only? middleware will retry */ }
                    });
                }
                if (++done === jobs.length) {
                    if (restored) console.log(`Pack 20: rebuilt ${restored} uploaded image(s) from the database.`);
                    conn.end();
                }
            });
        });
    });
}

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
    connection.query(
        "SELECT * FROM students ORDER BY class_name, full_name",
        (err, rows) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            res.json(rows || []);
        }
    );
});

/* ---------------- Announcements (notice board) ---------------- */

// NEW (pack 22): whitelisted values shared by the announcement routes.
const ANN_AUDIENCES = ["teacher", "student", "parent", "general"];
// CHANGED (pack 21/22): audience + kind + event_date come along; older
// client pages that only read title/body are unaffected.
app.get("/api/announcements", requireLogin, (req, res) => {
    connection.query(
        `SELECT id, title, body, audience, kind, event_date, created_at
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
    /* NEW (pack 22 - owner: "let me decide if it will be for teacher or
       student or parents or general and also event"): audience + kind are
       whitelisted; an EVENT with a date also lands on the school events
       list, so it shows in Upcoming Events and calendars automatically. */
    const audience = ANN_AUDIENCES.includes(req.body.audience) ? req.body.audience : "general";
    const kind = req.body.kind === "event" ? "event" : "announcement";
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(req.body.event_date || "") ? req.body.event_date : null;

    if (!title) {
        return res.status(400).json({ message: "Announcement title is required." });
    }
    if (kind === "event" && !eventDate) {
        return res.status(400).json({ message: "Pick the event date (or choose \"Announcement\" instead)." });
    }

    connection.query(
        `INSERT INTO announcements (title, body, audience, kind, event_date) VALUES (?, ?, ?, ?, ?)`,
        [title, body, audience, kind, eventDate],
        (err, result) => {
            if (err) {
                if (err.code === "ER_BAD_FIELD_ERROR") {
                    // first-boot window: pack-22 columns still migrating -
                    // fall back to the legacy columns so posting never fails.
                    return connection.query(
                        `INSERT INTO announcements (title, body) VALUES (?, ?)`,
                        [title, body],
                        () => res.json({ message: "Announcement posted (audience options unlock in one minute)." })
                    );
                }
                console.log(err);
                const handled = addonTableMissing(res, err, "save the announcement");
                if (handled) return handled;
                return res.status(500).json({ message: "Could not save announcement." });
            }
            if (kind === "event" && eventDate) {
                connection.query(
                    `INSERT INTO school_events (title, event_date, description) VALUES (?, ?, ?)`,
                    [title, eventDate, body || "Announcement event"],
                    () => {}
                );
            }
            /* NEW (pack 32): alert the audience's phones straight away.
               parent/student/general -> portal users; teacher/general ->
               staff. The bell already showed it inside the app; now the
               phone itself rings. */
            if (["parent", "student", "general"].indexOf(audience) !== -1) {
                amsPushAll("portal", {
                    title: "\u{1F4E2} " + title.slice(0, 60),
                    body: (body || title).slice(0, 100),
                    url: "/portal.html", tag: "ann-" + result.insertId
                });
            }
            if (["teacher", "general"].indexOf(audience) !== -1) {
                amsPushAll("staff", {
                    title: "\u{1F4E2} " + title.slice(0, 60),
                    body: (body || title).slice(0, 100),
                    url: "/teacher-dashboard.html", tag: "ann-" + result.insertId
                });
            }
            res.json({ message: kind === "event" ? "Event announced - it also appears in Upcoming Events." : "Announcement posted.", id: result.insertId });
        }
    );
});

// NEW (pack 22 - owner: "let me control what we were doing also"):
// EDIT an existing announcement/event (delete already existed).
app.put("/api/announcements/:id", requireLogin, (req, res) => {
    const title = (req.body.title || "").trim();
    const body = (req.body.body || "").trim();
    const audience = ANN_AUDIENCES.includes(req.body.audience) ? req.body.audience : "general";
    const kind = req.body.kind === "event" ? "event" : "announcement";
    const eventDate = kind === "event" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.event_date || "") ? req.body.event_date : null;
    if (!title) return res.status(400).json({ message: "Announcement title is required." });
    connection.query(
        `UPDATE announcements SET title = ?, body = ?, audience = ?, kind = ?, event_date = ? WHERE id = ?`,
        [title, body, audience, kind, eventDate, req.params.id],
        (err, result) => {
            if (err) {
                if (err.code === "ER_BAD_FIELD_ERROR") return res.status(503).json({ message: "Announcements are warming up - try again in one minute." });
                console.log(err);
                return res.status(500).json({ message: "Could not update announcement." });
            }
            if (!result.affectedRows) return res.status(404).json({ message: "Announcement not found." });
            res.json({ message: "Announcement updated." });
        }
    );
});

// NEW (pack 22): the PORTAL's own notice board - everything for parents
// and students plus general news. Teacher-only items stay staff-only.
app.get("/portal/announcements", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    connection.query(
        `SELECT id, title, body, audience, kind, event_date, created_at
         FROM announcements
         WHERE audience IN ('general', 'student', 'parent')
         ORDER BY created_at DESC LIMIT 20`,
        (err, rows) => {
            if (err) {
                if (err.code === "ER_BAD_FIELD_ERROR") return res.json([]);
                console.log(err);
                return res.status(500).json({ message: "Database error" });
            }
            res.json(rows);
        }
    );
});

// NEW (pack 22 - owner: "I can't see messages... in the website"): the
// PUBLIC notice board for the school website - general announcements +
// upcoming events only, nothing internal ever leaves this gate.
app.get("/api/announcements-public", (req, res) => {
    const out = { announcements: [], events: [] };
    connection.query(
        `SELECT id, title, body, created_at FROM announcements
         WHERE audience = 'general' AND kind = 'announcement'
         ORDER BY created_at DESC LIMIT 10`,
        (err, rows) => {
            if (!err && rows) out.announcements = rows;
            connection.query(
                `SELECT id, title, event_date, description FROM school_events
                 WHERE event_date >= CURDATE() ORDER BY event_date ASC LIMIT 10`,
                (err2, evs) => {
                    if (!err2 && evs) out.events = evs;
                    res.json(out);
                }
            );
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

const storeDir = path.join(__dirname, "uploads", "store");
try { fs.mkdirSync(storeDir, { recursive: true }); } catch (e) { /* exists */ }

const storeStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, storeDir),
    filename: (req, file, cb) => {
        const cleanName = typeof fixUtf8 === "function" ? fixUtf8(file.originalname || "file") : (file.originalname || "file");
        const safe = cleanName.replace(/[^a-zA-Z0-9.\-_؀-ۿ]/g, "_");
        cb(null, "store_" + Date.now() + "_" + safe);
    }
});
const uploadStore = multer({
    storage: storeStorage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max per file
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

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
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

    const studentId = String(req.params.studentId || "").trim();

    const sql = "SELECT * FROM students WHERE TRIM(student_id) = ? OR LOWER(TRIM(student_id)) = LOWER(?) LIMIT 1";

    connection.query(sql, [studentId, studentId], (err, results) => {

        if (err) {
            console.log(err);
            res.status(500).send("Database Error");
        } else {
            res.json(results || []);
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
    // NEW (pack 17 - owner: "add all user space for signature"): every
    // login user's own slot is also accepted (staff_<username>, letters/
    // numbers/underscore only, so no path tricks are possible).
    const isStaffSlot = /^staff_[a-z0-9_]{1,40}$/.test(role || "");
    if (!role || (!ALLOWED_SIGNATURE_ROLES.includes(role) && !isStaffSlot)) {
        return res.status(400).json({ message: "Role must be one of: " + ALLOWED_SIGNATURE_ROLES.join(", ") + " (or a staff_ user slot)." });
    }

    if (!req.file) {
        return res.status(400).json({ message: "No signature image received." });
    }

    const signaturePath = `images/signatures/${req.file.filename}`;
    // FIX (pack 20): also store the image bytes in the database so the
    // signature survives the host wiping its disk (auto-rebuilt on request).
    const sigData = fs.readFileSync(req.file.path);

    queryImageSave(
        `INSERT INTO signatures (role, signature_path, signature_data) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE signature_path = VALUES(signature_path), signature_data = VALUES(signature_data), updated_at = CURRENT_TIMESTAMP`,
        [role, signaturePath, sigData],
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
    // FIX (pack 20): database copy, same as /save-signature.
    const sigData = fs.readFileSync(req.file.path);

    queryImageSave(
        `INSERT INTO class_teacher_signatures (class_name, signature_path, signature_data) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE signature_path = VALUES(signature_path), signature_data = VALUES(signature_data), updated_at = CURRENT_TIMESTAMP`,
        [className, signaturePath, sigData],
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

function autoStoreExamToVault(title, class_name, subject, term, session, duration, instructions, body_html) {
    const vaultDir = path.join(__dirname, "uploads", "store");
    try { fs.mkdirSync(vaultDir, { recursive: true }); } catch (e) {}

    connection.query(
        "SELECT id FROM school_file_store WHERE folder_path = '/' AND file_name = 'Saved Exams' AND is_folder = 1",
        (err, rows) => {
            if (err) return;
            if (!rows || !rows.length) {
                connection.query("INSERT INTO school_file_store (folder_path, file_name, original_name, is_folder) VALUES ('/', 'Saved Exams', 'Saved Exams', 1)", () => {});
            }
        }
    );

    const safeName = `${class_name}_${subject}_${title}`.replace(/[^a-zA-Z0-9\-_]/g, "_");
    const timestamp = Date.now();

    const wordContent = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>${title}</title>
<style>body { font-family: 'Arial', sans-serif; }</style>
</head>
<body>
<h2 style="text-align:center;">AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES</h2>
<h3 style="text-align:center;">${title} (${class_name} - ${subject} - ${term} ${session})</h3>
${duration ? `<p><b>Duration:</b> ${duration}</p>` : ""}
${instructions ? `<p><b>Instructions:</b> ${instructions}</p>` : ""}
<hr/>
${body_html}
</body></html>`;

    const wordFilename = `store_exam_${timestamp}_${safeName}.doc`;
    const wordPath = path.join(vaultDir, wordFilename);
    const wordOriginalName = `${class_name} - ${subject} - ${title}.doc`;

    fs.writeFile(wordPath, wordContent, "utf8", (err) => {
        if (!err) {
            connection.query(
                "INSERT INTO school_file_store (folder_path, file_name, original_name, file_size, file_type, file_path, is_folder) VALUES (?, ?, ?, ?, ?, ?, 0)",
                ["/Saved Exams", wordOriginalName, wordOriginalName, Buffer.byteLength(wordContent, "utf8"), "application/msword", wordFilename],
                () => {}
            );
        }
    });

    const printFilename = `store_exam_${timestamp}_${safeName}_sheet.html`;
    const printPath = path.join(vaultDir, printFilename);
    const printOriginalName = `${class_name} - ${subject} - ${title} (Printable Sheet).html`;

    fs.writeFile(printPath, wordContent, "utf8", (err) => {
        if (!err) {
            connection.query(
                "INSERT INTO school_file_store (folder_path, file_name, original_name, file_size, file_type, file_path, is_folder) VALUES (?, ?, ?, ?, ?, ?, 0)",
                ["/Saved Exams", printOriginalName, printOriginalName, Buffer.byteLength(wordContent, "utf8"), "text/html", printFilename],
                () => {}
            );
        }
    });
}

app.post("/save-exam", requireLogin, (req, res) => {
    const { id, title, class_name, subject, term, session, duration, instructions, body_html } = req.body;
    const examDate = /^\d{4}-\d{2}-\d{2}$/.test(req.body.exam_date || "") ? req.body.exam_date : null;

    if (!title || !class_name || !subject || !term || !session || !body_html) {
        return res.status(400).json({ message: "Title, class, subject, term, session, and content are all required." });
    }

    autoStoreExamToVault(title, class_name, subject, term, session, duration, instructions, body_html);

    if (id) {
        // Update an existing exam
        connection.query(
            `UPDATE exams SET title=?, class_name=?, subject=?, term=?, session=?, duration=?, instructions=?, body_html=?, exam_date=? WHERE id=?`,
            [title, class_name, subject, term, session, duration || null, instructions || null, body_html, examDate, id],
            (err) => {
                if (err && err.code === "ER_BAD_FIELD_ERROR") {
                    return connection.query(
                        `UPDATE exams SET title=?, class_name=?, subject=?, term=?, session=?, duration=?, instructions=?, body_html=? WHERE id=?`,
                        [title, class_name, subject, term, session, duration || null, instructions || null, body_html, id],
                        (err2) => {
                            if (err2) { console.log(err2); return res.status(500).json({ message: "Error updating exam." }); }
                            res.json({ message: "Exam updated successfully.", id });
                        }
                    );
                }
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
            `INSERT INTO exams (title, class_name, subject, term, session, duration, instructions, body_html, created_by, exam_date)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [title, class_name, subject, term, session, duration || null, instructions || null, body_html, req.session.username, examDate],
            (err, result) => {
                if (err && err.code === "ER_BAD_FIELD_ERROR") {
                    return connection.query(
                        `INSERT INTO exams (title, class_name, subject, term, session, duration, instructions, body_html, created_by)
                         VALUES (?,?,?,?,?,?,?,?,?)`,
                        [title, class_name, subject, term, session, duration || null, instructions || null, body_html, req.session.username],
                        (err2, result2) => {
                            if (err2) { console.log(err2); return res.status(500).json({ message: "Error saving exam." }); }
                            res.json({ message: "Exam saved successfully.", id: result2.insertId });
                        }
                    );
                }
                if (err) {
                    console.log(err);
                    return res.status(500).json({ message: "Error saving exam." });
                }
                res.json({ message: "Exam saved successfully.", id: result.insertId });
            }
        );
    }
});

// NEW (pack 22 - owner: exam timetable visible to parents/students):
// the pupil's OWN class papers only, newest dated first. Nothing about
// the exam content ever leaves this route - just the schedule.
app.get("/portal/exams", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    connection.query(
        "SELECT class_name FROM students WHERE student_id = ? LIMIT 1",
        [sid],
        (err, stu) => {
            if (err || !stu.length) return res.json([]);
            connection.query(
                `SELECT id, title, subject, term, session, duration, exam_date
                 FROM exams WHERE class_name = ?
                 ORDER BY exam_date IS NULL, exam_date DESC, updated_at DESC LIMIT 40`,
                [stu[0].class_name],
                (err2, rows) => {
                    if (err2) {
                        if (err2.code === "ER_BAD_FIELD_ERROR") return res.json([]);
                        console.log(err2);
                        return res.status(500).json({ message: "Database error" });
                    }
                    res.json(rows);
                }
            );
        }
    );
});

/* =====================================================================
   NEW (pack 23): PORTAL SETTINGS - change password + contact details.
===================================================================== */
app.post("/portal/change-password", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    const current = String(req.body.current || "");
    const nextPw  = String(req.body.newPassword || "");
    if (!current || nextPw.length < 4) {
        return res.status(400).json({ message: "New password must be at least 4 characters." });
    }
    connection.query("SELECT * FROM students WHERE student_id = ? LIMIT 1", [sid], (err, rows) => {
        if (err || !rows.length) return res.status(500).json({ message: "Database error" });
        const st = rows[0];
        const setNew = () => {
            bcrypt.hash(nextPw, 10, (hErr, hash) => {
                if (hErr) return res.status(500).json({ message: "Could not set password" });
                connection.query(
                    "UPDATE students SET portal_password = ? WHERE student_id = ?",
                    [hash, sid],
                    (uErr) => {
                        if (uErr) return res.status(500).json({ message: "Database error" });
                        res.json({ message: "Password changed. Use it next time you log in." });
                    }
                );
            });
        };
        // Verify the CURRENT one first: custom hash if set, else legacy surname rule.
        if (st.portal_password) {
            return bcrypt.compare(current, st.portal_password, (cErr, match) => {
                if (cErr || !match) return res.status(401).json({ message: "Current password is wrong." });
                setNew();
            });
        }
        const fullName = (st.full_name || "").trim();
        const surname  = fullName ? fullName.split(/\s+/).pop() : "";
        const ok = current.toLowerCase() === surname.toLowerCase()
                || current.toLowerCase() === fullName.toLowerCase();
        if (!ok) return res.status(401).json({ message: "Current password (surname) is wrong." });
        setNew();
    });
});

app.post("/portal/profile", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    // Only the contact fields a parent may correct - nothing academic.
    connection.query(
        "UPDATE students SET parent_name = ?, parent_phone = ?, address = ? WHERE student_id = ?",
        [String(req.body.parent_name || "").slice(0, 160), String(req.body.parent_phone || "").slice(0, 40), String(req.body.address || "").slice(0, 255), sid],
        (err) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json({ message: "Details saved." });
        }
    );
});

/* =====================================================================
   NEW (pack 23 - owner: "View takes me to a blank page - fix that"):
   friendly receipt viewer for school-recorded payments. If the file or
   its database copy is missing, the parent sees a clear message instead
   of a blank tab.
===================================================================== */
app.get("/portal/receipt/:id", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).send("Not logged in");
    const friendly = (title, msg) => res.status(200).send(
        "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
        "<title>Receipt</title><style>body{font-family:Arial,sans-serif;background:#f4f7f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}" +
        ".card{background:#fff;border-radius:14px;padding:28px 24px;max-width:340px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.08);}" +
        "h2{color:#14532d;margin:0 0 8px;font-size:18px;}p{color:#5B6B62;font-size:14px;line-height:1.5;margin:0;}</style></head>" +
        "<body><div class='card'><h2>" + title + "</h2><p>" + msg + "</p></div></body></html>"
    );
    connection.query("SELECT receipt_path, receipt_data FROM fee_payments WHERE id = ? AND student_id = ? LIMIT 1", [req.params.id, sid], (err, rows) => {
        if (err) return res.status(500).send("Database error");
        if (!rows.length) return friendly("Not found", "This payment does not belong to your child.");
        const pay = rows[0];
        if (!pay.receipt_path) return friendly("No receipt yet", "The school has not snapped the receipt for this payment yet. Please check back later or ask at the office.");
        const rel = String(pay.receipt_path).replace(/^\/+/, "");
        const abs = path.join(__dirname, rel);
        if (fs.existsSync(abs)) return res.sendFile(abs);
        // File wiped by the host? Rebuild it from the pack-20 database copy.
        if (pay.receipt_data) {
            try {
                fs.mkdirSync(path.dirname(abs), { recursive: true });
                fs.writeFileSync(abs, pay.receipt_data);
                return res.sendFile(abs);
            } catch (e) { /* fall through to friendly note */ }
        }
        return friendly("Receipt unavailable", "This receipt was recorded before photo-backup started, so the picture is no longer on the server. The PAYMENT itself is safely recorded - the school can re-snap the receipt at the office if you need the image.");
    });
});

/* =====================================================================
   NEW (pack 23): MESSAGING + NOTIFICATIONS
   Parent/Student <-> Class Teacher, Parent/Student <-> Administration.
   read_at = NULL drives the unread badges (the "notifications").
===================================================================== */

// ---- PORTAL side ----
app.get("/portal/messages", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    connection.query(
        `SELECT id, sender_type, sender_ref, sender_name, recipient_type, recipient_ref, recipient_class, body, created_at, read_at,
                thread, kind, duration
         FROM messages
         WHERE (sender_type = 'portal' AND sender_ref = ?)
            OR (recipient_type = 'parent' AND recipient_ref = ?)
         ORDER BY created_at ASC LIMIT 300`,
        [sid, sid],
        (err, rows) => {
            if (err) { if (err.code === "ER_NO_SUCH_TABLE") return res.json([]); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

app.get("/portal/messages/unread", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    connection.query(
        "SELECT COUNT(*) AS c FROM messages WHERE recipient_type = 'parent' AND recipient_ref = ? AND read_at IS NULL",
        [sid],
        (err, rows) => {
            if (err) { if (err.code === "ER_NO_SUCH_TABLE") return res.json({ count: 0 }); return res.status(500).json({ message: "Database error" }); }
            res.json({ count: rows[0].c });
        }
    );
});

app.post("/portal/messages", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    const to = req.body.to === "teacher" ? "teacher" : "admin";
    const body = String(req.body.body || "").trim().slice(0, 2000);
    if (!body) return res.status(400).json({ message: "Write a message first." });
    connection.query("SELECT full_name, class_name FROM students WHERE student_id = ? LIMIT 1", [sid], (err, stu) => {
        if (err || !stu.length) return res.status(500).json({ message: "Database error" });
        const student = stu[0];
        // CHANGED (pack 28): thread = who the parent wrote to, so the two
        // conversations (office / class teacher) stay separate.
        connection.query(
            `INSERT INTO messages (sender_type, sender_ref, sender_name, recipient_type, recipient_ref, recipient_class, body, thread)
             VALUES ('portal', ?, ?, ?, '', ?, ?, ?)`,
            [sid, (student.full_name || sid) + " (parent)", to, to === "teacher" ? (student.class_name || "") : "", body, to],
            (iErr) => {
                if (iErr) return res.status(500).json({ message: "Database error" });
                /* NEW (pack 32): ping the right staff phones. office mail
                   rings the admins; class-teacher mail rings the teachers
                   mapped to that class (confidentiality rules kept). */
                const payload = {
                    title: "\u{1F4AC} New message from " + (student.full_name || "a parent") + "'s parent",
                    body: body.slice(0, 90),
                    url: "/chat.html", tag: "chat-" + sid + "-" + to
                };
                if (to === "admin") {
                    connection.query("SELECT username FROM users WHERE role = 'admin'", [], (aErr, adm) => {
                        if (!aErr && adm) amsPushSend("staff", adm.map(r => r.username), payload);
                    });
                } else if (student.class_name) {
                    connection.query("SELECT username FROM teacher_classes WHERE class_name = ?", [student.class_name], (tErr, tch) => {
                        if (!tErr && tch) amsPushSend("staff", tch.map(r => r.username), payload);
                    });
                }
                res.json({ message: "Message sent to the " + (to === "teacher" ? "class teacher" : "school office") + "." });
            }
        );
    });
});

app.post("/portal/messages/read", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    connection.query(
        "UPDATE messages SET read_at = NOW() WHERE recipient_type = 'parent' AND recipient_ref = ? AND read_at IS NULL",
        [sid],
        () => res.json({ message: "ok" })
    );
});

// ---- STAFF side ----
// Which messages may this staff member see?
// CHANGED (pack 25 - owner: "Build confidentiality in the project -
// teacher can't be seeing chat between admin and parents and at others
// also"): teachers ONLY ever see parent->teacher mail for THEIR OWN
// assigned classes. No more "no classes = see everything" fallback
// (that leaked other classes' chats). Admin->parent replies stay
// invisible to teachers; admins keep full oversight.
function staffMessageFilter(req, cb) {
    const me = req.session.username;
    const isAdmin = req.session.role === "admin";
    if (isAdmin) return cb(null, null); // admins see everything school-bound
    connection.query("SELECT class_name FROM teacher_classes WHERE username = ?", [me], (err, rows) => {
        if (err) return cb(null, false); // treat as no mapping
        cb(null, (rows || []).map(r => r.class_name));
    });
}

app.get("/api/messages", requireLogin, (req, res) => {
    const me = req.session.username;
    const isAdmin = req.session.role === "admin";
    staffMessageFilter(req, (fErr, myClasses) => {
        connection.query(
            `SELECT id, sender_type, sender_ref, sender_name, recipient_type, recipient_ref, recipient_class, body, created_at, read_at,
                    thread, kind, duration
             FROM messages ORDER BY created_at DESC LIMIT 400`,
            (err, rows) => {
                if (err) { if (err.code === "ER_NO_SUCH_TABLE") return res.json([]); return res.status(500).json({ message: "Database error" }); }
                const mine = (rows || []).filter(m => {
                    if (m.sender_type === "staff" && m.sender_ref === me) return true; // my own replies
                    if (m.recipient_type === "staff" && m.recipient_ref === me) return true; // messages sent to me!
                    if (m.sender_type !== "portal") return false;                      // other staff's threads
                    if (isAdmin) return true;                                          // admin sees all parent mail
                    // teacher: parent mail bound for teachers; honour class mapping,
                    // empty mapping = see NOTHING (pack 25 - confidentiality).
                    if (m.recipient_type === "teacher") {
                        if (!myClasses || !myClasses.length) return false; // pack 25: no fallback - confidentiality
                        return myClasses.indexOf(m.recipient_class) !== -1;
                    }
                    return false;
                });
                res.json(mine);
            }
        );
    });
});

app.get("/api/messages/unread", requireLogin, (req, res) => {
    const me = req.session.username;
    const isAdmin = req.session.role === "admin";
    staffMessageFilter(req, (fErr, myClasses) => {
        connection.query(
            `SELECT recipient_type, recipient_class FROM messages
             WHERE sender_type = 'portal' AND read_at IS NULL`, // only unread INCOMING parent mail
            (err, rows) => {
                if (err) { if (err.code === "ER_NO_SUCH_TABLE") return res.json({ count: 0 }); return res.status(500).json({ message: "Database error" }); }
                const count = (rows || []).filter(m => {
                    if (isAdmin) return true;
                    if (m.recipient_type === "teacher") {
                        if (!myClasses || !myClasses.length) return false; // pack 25: no fallback - confidentiality
                        return myClasses.indexOf(m.recipient_class) !== -1;
                    }
                    return false;
                }).length;
                res.json({ count });
            }
        );
    });
});

app.post("/api/messages", requireLogin, (req, res) => {
    const me = req.session.username;
    const studentId = String(req.body.student_id || "").trim();
    const body = String(req.body.body || "").trim().slice(0, 2000);
    if (!studentId || !body) return res.status(400).json({ message: "Recipient and message are required." });
    const thread = req.body.thread === "teacher" ? "teacher" : "admin";
    connection.query("SELECT full_name FROM students WHERE student_id = ? LIMIT 1", [studentId], (err, stu) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (!stu.length) {
            // Check if recipient is a teacher/admin user
            connection.query("SELECT username AS full_name, role FROM users WHERE username = ? LIMIT 1", [studentId], (err2, uRows) => {
                if (err2 || !uRows || !uRows.length) {
                    return res.status(404).json({ message: "No recipient with that ID - check it and try again." });
                }
                const rec = uRows[0];
                connection.query(
                    `INSERT INTO messages (sender_type, sender_ref, sender_name, recipient_type, recipient_ref, recipient_class, body, thread)
                     VALUES ('staff', ?, ?, 'staff', ?, '', ?, ?)`,
                    [me, me + " (" + req.session.role + ")", studentId, body, thread],
                    (iErr) => {
                        if (iErr) return res.status(500).json({ message: "Database error" });
                        res.json({ message: "Message sent to staff member." });
                    }
                );
            });
            return;
        }
        connection.query(
            `INSERT INTO messages (sender_type, sender_ref, sender_name, recipient_type, recipient_ref, recipient_class, body, thread)
             VALUES ('staff', ?, ?, 'parent', ?, '', ?, ?)`,
            [me, me + " (" + req.session.role + ")", studentId, body, thread],
            (iErr) => {
                if (iErr) return res.status(500).json({ message: "Database error" });
                amsPushSend("portal", [studentId], {
                    title: "\u{1F4AC} New message from " + (thread === "teacher" ? "your class teacher" : "the school office"),
                    body: body.slice(0, 90),
                    url: "/portal.html", tag: "chat-" + studentId + "-" + thread
                });
                res.json({ message: "Reply sent to the parent." });
            }
        );
    });
});

app.post("/api/messages/read", requireLogin, (req, res) => {
    const me = req.session.username;
    const isAdmin = req.session.role === "admin";
    staffMessageFilter(req, (fErr, myClasses) => {
        connection.query(
            `SELECT id, recipient_type, recipient_class FROM messages WHERE sender_type = 'portal' AND read_at IS NULL`,
            (err, rows) => {
                if (err) return res.json({ message: "ok" });
                const ids = (rows || []).filter(m => {
                    if (isAdmin) return true;
                    if (m.recipient_type === "teacher") {
                        if (!myClasses || !myClasses.length) return false; // pack 25: no fallback - confidentiality
                        return myClasses.indexOf(m.recipient_class) !== -1;
                    }
                    return false;
                }).map(m => m.id);
                if (!ids.length) return res.json({ message: "ok" });
                connection.query("UPDATE messages SET read_at = NOW() WHERE id IN (" + ids.join(",") + ")", () => res.json({ message: "ok" }));
            }
        );
    });
});

/* ==========================================================================
   NEW (pack 28 - owner requests): CHAT EXTRAS.
   1) /api/chat-students  - staff searches for a parent to START a chat
      with ("select who I want to chat with"). Teachers are limited to
      their mapped classes (pack-25 confidentiality, same rule as mail).
   2) /api/messages/voice + /portal/messages/voice - voice notes. The
      audio is stored IN the messages table (voice_data) - never on the
      ephemeral server disk, so it survives every Render deploy.
   3) GET /voice/:id - streams one voice note, only to people allowed to
      see that conversation.
   ========================================================================== */
// NEW (Pack 50): Delete a single chat message
app.delete("/api/messages/:id", requireLogin, (req, res) => {
    const id = req.params.id;
    connection.query("DELETE FROM messages WHERE id = ?", [id], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: "Database Error" });
        }
        res.json({ message: "Message deleted.", count: result.affectedRows });
    });
});

// NEW (Pack 50/53): Clear an entire conversation with a student/parent
app.delete("/api/messages/thread/:sid", requireLogin, (req, res) => {
    const sid = req.params.sid;
    connection.query(
        "DELETE FROM messages WHERE (sender_type = 'portal' AND sender_ref = ?) OR (recipient_type = 'parent' AND recipient_ref = ?) OR sender_ref = ? OR recipient_ref = ?",
        [sid, sid, sid, sid],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Database Error" });
            }
            res.json({ message: "Conversation cleared.", count: result.affectedRows });
        }
    );
});

app.get("/api/chat-students", requireLogin, (req, res) => {
    const q = String(req.query.q || "").trim();
    const isAdmin = req.session.role === "admin";
    staffMessageFilter(req, (fErr, myClasses) => {
        let sql = "SELECT student_id, full_name, class_name, gender, 'student' AS account_type FROM students";
        const params = [];
        const where = [];
        if (q) {
            where.push("(full_name LIKE ? OR student_id LIKE ?)");
            params.push("%" + q + "%", "%" + q + "%");
        }
        if (!isAdmin) {
            if (!myClasses || !myClasses.length) {
                where.push("1 = 0");
            } else {
                where.push("class_name IN (" + myClasses.map(() => "?").join(",") + ")");
                params.push.apply(params, myClasses);
            }
        }
        if (where.length) sql += " WHERE " + where.join(" AND ");
        sql += " ORDER BY full_name LIMIT 100";

        connection.query(sql, params, (err, students) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            let userSql = "SELECT username AS student_id, username AS full_name, role AS class_name, 'user' AS account_type FROM users";
            const userParams = [];
            if (q) {
                userSql += " WHERE username LIKE ? OR role LIKE ?";
                userParams.push("%" + q + "%", "%" + q + "%");
            }
            userSql += " ORDER BY username LIMIT 50";
            connection.query(userSql, userParams, (uErr, users) => {
                const combined = (students || []).concat(users || []);
                res.json(combined);
            });
        });
    });
});

// multer keeps the audio in memory only (it goes straight to the DB)
const uploadVoice = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 6 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = /^(audio|video)\/(webm|ogg|mpeg|mp3|mp4|x-m4a|m4a|aac|wav)/.test(file.mimetype || "");
        cb(ok ? null : new Error("Only audio recordings are allowed."), ok);
    }
});

app.post("/api/messages/voice", requireLogin, (req, res) => {
    uploadVoice.single("voice")(req, res, (upErr) => {
        if (upErr || !req.file) return res.status(400).json({ message: (upErr && upErr.message) || "No recording received." });
        const me = req.session.username;
        const studentId = String(req.body.student_id || "").trim();
        const thread = req.body.thread === "teacher" ? "teacher" : "admin";
        const duration = Math.max(1, Math.min(600, parseInt(req.body.duration, 10) || 0)) || null;
        if (!studentId) return res.status(400).json({ message: "Student is required." });
        connection.query("SELECT full_name FROM students WHERE student_id = ? LIMIT 1", [studentId], (err, stu) => {
            if (err) return res.status(500).json({ message: "Database error" });
            if (!stu.length) return res.status(404).json({ message: "No student with that ID." });
            connection.query(
                `INSERT INTO messages (sender_type, sender_ref, sender_name, recipient_type, recipient_ref, recipient_class, body, thread, kind, duration, voice_data, voice_mime)
                 VALUES ('staff', ?, ?, 'parent', ?, '', ?, ?, 'voice', ?, ?, ?)`,
                [me, me + " (" + req.session.role + ")", studentId, "\u{1F3D9} Voice note", thread, duration, req.file.buffer, req.file.mimetype],
                (iErr) => {
                    if (iErr) { console.log(iErr); return res.status(500).json({ message: "Database error" }); }
                    res.json({ message: "Voice note sent." });
                }
            );
        });
    });
});

app.post("/portal/messages/voice", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    uploadVoice.single("voice")(req, res, (upErr) => {
        if (upErr || !req.file) return res.status(400).json({ message: (upErr && upErr.message) || "No recording received." });
        const to = req.body.to === "teacher" ? "teacher" : "admin";
        const duration = Math.max(1, Math.min(600, parseInt(req.body.duration, 10) || 0)) || null;
        connection.query("SELECT full_name, class_name FROM students WHERE student_id = ? LIMIT 1", [sid], (err, stu) => {
            if (err || !stu.length) return res.status(500).json({ message: "Database error" });
            const student = stu[0];
            connection.query(
                `INSERT INTO messages (sender_type, sender_ref, sender_name, recipient_type, recipient_ref, recipient_class, body, thread, kind, duration, voice_data, voice_mime)
                 VALUES ('portal', ?, ?, ?, '', ?, ?, ?, 'voice', ?, ?, ?)`,
                [sid, (student.full_name || sid) + " (parent)", to, to === "teacher" ? (student.class_name || "") : "",
                 "\u{1F3D9} Voice note", to, duration, req.file.buffer, req.file.mimetype],
                (iErr) => {
                    if (iErr) { console.log(iErr); return res.status(500).json({ message: "Database error" }); }
                    res.json({ message: "Voice note sent to the " + (to === "teacher" ? "class teacher" : "school office") + "." });
                }
            );
        });
    });
});

// stream ONE voice note; only people who may see the conversation
app.get("/voice/:id", (req, res) => {
    const id = Number(req.params.id) || 0;
    const sid = req.session && req.session.portalStudentId;
    const staffUser = req.session && req.session.userId;
    if (!sid && !staffUser) return res.status(401).send("Not logged in");
    connection.query(
        "SELECT id, sender_type, sender_ref, recipient_ref, recipient_class, voice_data, voice_mime, kind FROM messages WHERE id = ? LIMIT 1",
        [id],
        (err, rows) => {
            if (err) return res.status(500).send("Database error");
            const m = rows && rows[0];
            if (!m || m.kind !== "voice" || !m.voice_data) return res.status(404).send("Voice note not found");
            const serve = () => {
                res.setHeader("Content-Type", m.voice_mime || "audio/webm");
                res.setHeader("Content-Length", m.voice_data.length);
                res.setHeader("Cache-Control", "private, max-age=86400");
                res.send(m.voice_data);
            };
            if (sid) {
                // parent may only open their own conversation's audio
                if (m.sender_ref === sid || m.recipient_ref === sid) return serve();
                return res.status(403).send("Not your conversation");
            }
            if (req.session.role === "admin") return serve();
            if (m.sender_type === "staff" && m.sender_ref === req.session.username) return serve(); // my own note
            staffMessageFilter(req, (fErr, myClasses) => {
                if (m.sender_type === "portal" && myClasses && myClasses.indexOf(m.recipient_class) !== -1) return serve();
                return res.status(403).send("Not your conversation");
            });
        }
    );
});

/* ==========================================================================
   NEW (pack 27 - owner: "Can we build ai inside the project"): AI CORE.
   --------------------------------------------------------------------------
   The AI brain lives OUTSIDE this server. It speaks the standard OpenAI
   chat-completions format, so it works out of the box with a FREE Google
   Gemini key and also with Groq/OpenRouter/OpenAI - just set environment
   values (Render dashboard -> Environment):
     AI_API_KEY  = the secret key (free one: aistudio.google.com -> Get API key)
     AI_BASE_URL = default https://generativelanguage.googleapis.com/v1beta/openai
     AI_MODEL    = default gemini-2.5-flash (Google retired 2.0-flash June 2026)
   With no key set, every AI endpoint answers a friendly "not switched on
   yet" message and the rest of the system is completely unaffected.
   Privacy: only the prompt text (e.g. a topic, or an average score) is
   ever sent to the AI service - never passwords or whole databases.
   ========================================================================== */
/* CHANGED (pack 29): the AI key can now come from TWO places -
     1) the ai_config row the admin saves inside the app (wins), or
     2) the classic environment variables (still work exactly as before).
   aiConfig() resolves them with a 10-second cache so chats stay fast. */
const AI_ENV = {
    key:  String(process.env.AI_API_KEY || "").trim(),
    base: String(process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").trim().replace(/\/+$/, ""),
    model:String(process.env.AI_MODEL || "gemini-2.5-flash").trim()
};
let aiCfgCache = { at: 0, cfg: null };
function aiConfig() {
    if (aiCfgCache.cfg && Date.now() - aiCfgCache.at < 10000) return Promise.resolve(aiCfgCache.cfg);
    return new Promise(function (resolve) {
        connection.query("SELECT * FROM ai_config WHERE id = 1", function (err, rows) {
            let cfg;
            if (err) { // table not created yet (or db hiccup) - env still works
                cfg = { key: AI_ENV.key, base: AI_ENV.base, model: AI_ENV.model, source: AI_ENV.key ? "env" : "" };
            } else {
                const db = rows && rows.length ? rows[0] : {};
                const dbKey = String(db.api_key || "").trim();
                cfg = {
                    key:  dbKey || AI_ENV.key,
                    base: String(db.base_url || "").trim().replace(/\/+$/, "") || AI_ENV.base,
                    model:String(db.model || "").trim() || AI_ENV.model,
                    source: dbKey ? "app" : (AI_ENV.key ? "env" : ""),
                    updatedBy: db.updated_by || "", updatedAt: db.updated_at || null
                };
            }
            aiCfgCache = { at: Date.now(), cfg: cfg };
            resolve(cfg);
        });
    });
}
function aiBustCache() { aiCfgCache = { at: 0, cfg: null }; }
function aiNotReady(res) {
    return res.status(503).json({
        error: "The AI is not switched on yet. The admin can switch it on in one minute from the AI Chat page (the switch-on card). Nothing else is affected."
    });
}

/* One small POST to the AI service (OpenAI chat-completions shape), built on
   node's own http/https so NO new packages are needed. 30s hard timeout. */
function aiChat(messages, opts, cfg) {
    cfg = cfg || AI_ENV; // safety net - callers always pass it
    opts = opts || {};
    return new Promise(function (resolve, reject) {
        const body = JSON.stringify({
            model: cfg.model,
            messages: messages,
            temperature: typeof opts.temperature === "number" ? opts.temperature : 0.5,
            max_tokens: opts.maxTokens || 900
        });
        let u;
        try { u = new URL(cfg.base + "/chat/completions"); }
        catch (e) { return reject(new Error("AI_BASE_URL is not a valid address")); }
        const lib = u.protocol === "http:" ? require("http") : require("https");
        const req = lib.request({
            method: "POST",
            hostname: u.hostname,
            port: u.port || (u.protocol === "http:" ? 80 : 443),
            path: u.pathname + u.search,
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + cfg.key,
                "Content-Length": Buffer.byteLength(body)
            }
        }, function (aiRes) {
            let raw = "";
            aiRes.on("data", function (c) {
                raw += c;
                if (raw.length > 200000) req.destroy(new Error("AI reply too large")); // safety cap
            });
            aiRes.on("end", function () {
                let data = null;
                try { data = JSON.parse(raw); } catch (e) { return reject(new Error("AI reply was not JSON")); }
                if (aiRes.statusCode >= 400) {
                    const m = data && data.error && data.error.message ? data.error.message : ("AI service error " + aiRes.statusCode);
                    return reject(new Error(m));
                }
                const choice = data && data.choices && data.choices[0];
                const text = choice && choice.message ? (choice.message.content || "") : "";
                if (!text.trim()) return reject(new Error("AI sent an empty reply"));
                /* CHANGED (pack 31 - owner: "the ai is giving incomplete
                   message"): also surface finish_reason so the caller can
                   see when the model ran out of room and ask it to
                   continue instead of showing a half answer. */
                resolve({ text: text, finishReason: (choice.finish_reason || "") });
            });
        });
        req.setTimeout(30000, function () { req.destroy(new Error("The AI took too long - please try again")); });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

/* FIX (pack 30 - owner: "ai keeps saying The AI stumbled"): Google retired
   gemini-2.0-flash, which was the old default, so every call failed. Now
   the caller's model is tried first, then these current FREE models in
   order - whichever answers becomes the working one. Only "model problem"
   errors move on to the next model; real errors (bad key, quota, network)
   are reported immediately. */
const AI_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];
function aiModelErr(e) {
    const m = String(e && e.message || e || "");
    /* CHANGED (pack 31 - owner: "can it handle much task"): free-tier
       quota/rate errors now also move on to the next model - each Gemini
       model has its OWN free quota, so the fallback chain multiplies how
       many chats a day the school can do before anyone is told 'slow down'. */
    return /model|retired|deprecated|not found|404|unsupported|invalid|quota|rate.?limit|429|resource.?exhausted|too many/i.test(m);
}
function aiChatSmart(messages, opts, cfg) {
    opts = opts || {};
    const chain = [cfg.model].concat(AI_FALLBACK_MODELS).filter(function (v, i, a) {
        return v && a.indexOf(v) === i;
    });
    let attempt = 0;
    function tryNext(msgs) {
        if (attempt >= chain.length) return Promise.reject(new Error("no usable AI model - or today's free quota is finished (it resets daily)"));
        const model = chain[attempt++];
        const sub = Object.assign({}, cfg, { model: model });
        return aiChat(msgs, opts, sub).then(function (got) {
            /* FIX (pack 31 - owner: "the ai is giving incomplete message"):
               when the model says it stopped because it ran out of room
               (finish_reason 'length'), ask it ONCE to continue exactly
               where it stopped and stitch the two halves together - the
               teacher sees one complete answer. */
            if (got.finishReason === "length" && !opts._continued) {
                const cont = msgs.concat([
                    { role: "assistant", content: got.text },
                    { role: "user", content: "Continue exactly where you stopped. Do not repeat anything you already wrote - just carry on." }
                ]);
                const opts2 = Object.assign({}, opts, { _continued: true });
                return aiChat(cont, opts2, sub).then(function (more) {
                    return { text: got.text.replace(/\s+$/, "") + " " + more.text.replace(/^\s+/, ""), model: model, finishReason: more.finishReason };
                }, function () {
                    return { text: got.text, model: model, finishReason: got.finishReason }; // second half failed - still better than an error
                });
            }
            return { text: got.text, model: model, finishReason: got.finishReason };
        }, function (err) {
            if (attempt < chain.length && aiModelErr(err)) return tryNext(msgs);
            throw err;
        });
    }
    return tryNext(messages);
}

/* Tolerant JSON extractor - AI models sometimes wrap JSON in code fences. */
function aiParseJson(text) {
    let t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    try { return JSON.parse(t); } catch (e) { /* fall through */ }
    const m = t.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m) return JSON.parse(m[1]);
    throw new Error("AI reply was not valid JSON");
}

/* Public status ping - the three AI UIs use it to show "AI ready" vs a
   gentle "coming soon" note. Reveals nothing secret. */
app.get("/api/ai/status", (req, res) => {
    // CHANGED (pack 29): key may live in the app now - check both places
    aiConfig().then(function (cfg) { res.json({ enabled: !!cfg.key }); });
});

/* ---------- AI FEATURE 1: exam question generator (staff) ---------------
   Teacher gives class + subject + topic; AI drafts numbered questions the
   teacher can still edit before printing (AI proposes, teacher disposes). */
app.post("/api/ai/exam-questions", requireLogin, async (req, res) => {
    const cfg = await aiConfig(); // CHANGED (pack 29): in-app key counts too
    if (!cfg.key) return aiNotReady(res);
    const f = k => String(req.body[k] == null ? "" : req.body[k]).trim();
    const className = f("className").slice(0, 80);
    const subject   = f("subject").slice(0, 80);
    const topic     = f("topic").slice(0, 200);
    const qtype     = ["objective", "theory", "mixed"].indexOf(f("qtype")) !== -1 ? f("qtype") : "theory";
    const count     = Math.max(1, Math.min(20, parseInt(f("count"), 10) || 5));
    const marks     = f("marks").slice(0, 12);
    if (!topic) return res.status(400).json({ error: "Please type a topic first." });

    const sys =
        "You are an expert exam setter for Ameenullah School of Arabic and Islamic Studies " +
        "in Lagos, Nigeria - an Arabic/Islamic school that also teaches general subjects. " +
        "You write clear, correct, age-appropriate exam questions. Use English or Arabic " +
        "to suit the subject. Reply with JSON only - no commentary, no markdown fences.";
    const usr =
        "Write " + count + " " + qtype + " exam question(s) for class \"" + (className || "secondary") +
        "\" in the subject \"" + (subject || "general") + "\" on this topic: \"" + topic + "\"." +
        (marks ? " Each question carries " + marks + "." : "") +
        (qtype !== "theory" ? " Every objective question must have exactly 4 options labelled A, B, C, D." : "") +
        " JSON shape: {\"questions\":[{\"question\":\"text\",\"options\":[\"A. ...\",\"B. ...\",\"C. ...\",\"D. ...\"] or null}]}";

    try {
        const got = await aiChatSmart([{ role: "system", content: sys }, { role: "user", content: usr }], { maxTokens: 4000, temperature: 0.65 }, cfg); // CHANGED (pack 31): room for full question sets
        const text = got.text;
        const data = aiParseJson(text);
        const list = Array.isArray(data) ? data : (data && data.questions);
        if (!Array.isArray(list)) throw new Error("AI sent no questions");
        const cleaned = list.slice(0, count).map(function (q) {
            const obj = { question: String(q && q.question || "").trim().slice(0, 700) };
            if (Array.isArray(q && q.options)) {
                const opts = q.options.map(o => String(o || "").trim().slice(0, 140)).filter(Boolean).slice(0, 6);
                if (opts.length >= 2) obj.options = opts;
            }
            return obj;
        }).filter(q => q.question);
        if (!cleaned.length) throw new Error("AI sent no usable questions");
        res.json({ questions: cleaned });
    } catch (e) {
        console.log("AI exam-questions error:", e && e.message);
        res.status(502).json({ error: "The AI stumbled - please try again in a moment." });
    }
});

/* ---------- REMOVED (pack 29 - owner: "I don't need the ai remark,
   remove it and turn it to chat"): the one-note AI Remarks page and its
   /api/ai/remark route are GONE. Teachers now chat with the AI fluently
   on the AI Chat page (ai-remarks.html) - they can still ask the chat to
   draft a remark for any student whenever they want. ------------------- */

/* ---------- AI FEATURE 2: STAFF AI CHAT (pack 29) ---------------------
   Free-flowing, multi-turn conversation for logged-in staff. The page
   keeps the conversation and sends it here each time; the school voice
   (system prompt) is added server-side so the AI always stays the
   "school AI". Per-staff hourly limit keeps the free AI quota safe. */
const aiStaffHits = Object.create(null); // username -> { count, resetAt }
setInterval(function () { // sweep expired buckets (memory hygiene)
    const now = Date.now();
    Object.keys(aiStaffHits).forEach(function (k) { if (aiStaffHits[k].resetAt < now) delete aiStaffHits[k]; });
}, 600000).unref();

app.post("/api/ai/chat", requireLogin, async (req, res) => {
    const cfg = await aiConfig();
    if (!cfg.key) return aiNotReady(res);
    const who = req.session.username || "?";
    const now = Date.now();
    let bucket = aiStaffHits[who];
    if (!bucket || bucket.resetAt < now) bucket = aiStaffHits[who] = { count: 0, resetAt: now + 3600000 };
    if (++bucket.count > 40) {
        return res.status(429).json({ error: "You have chatted a lot this hour - take a short break and continue in a little while." });
    }
    const hist = (Array.isArray(req.body.messages) ? req.body.messages : [])
        .slice(-24).map(function (m) {
            const role = m && m.role === "assistant" ? "assistant" : "user";
            return { role: role, content: String(m && m.content || "").slice(0, 4000) };
        }).filter(function (m) { return m.content; });
    if (!hist.length) return res.status(400).json({ error: "Type something first." });

    const sys =
        "You are AMSAIS AI, the clever, warm assistant built into the school result system used by the staff of " +
        "Ameenullah School of Arabic and Islamic Studies (AMSAIS), Lagos, Nigeria. The person chatting with you is a teacher or school administrator. " +
        "Chat naturally and fluently, like a helpful colleague sitting next to them. You can help with: writing report-card remarks, exam questions, " +
        "letters and messages to parents, teaching ideas and lesson tips, simple English-Arabic translation, Islamic knowledge to support lessons, " +
        "and general school-office writing. " +
        "Style: simple friendly English; short paragraphs; lists or numbered points when helpful; **bold** the key words; keep answers focused and " +
        "offer to go deeper at the end if it is a big topic. A short Islamic greeting is fine when greeted. " +
        "You CANNOT look up private student records, fee balances or results, and you CANNOT perform actions inside the app - if asked, kindly " +
        "point them to the right page in the menu. Never invent school fees, dates or policies.";

    try {
        const got = await aiChatSmart([{ role: "system", content: sys }].concat(hist), { maxTokens: 2048, temperature: 0.7 }, cfg); // CHANGED (pack 31): thinking models spend tokens on reasoning - 800 starved the visible answer
        res.json({ reply: got.text.trim().slice(0, 4000) });
    } catch (e) {
        console.log("AI chat error:", e && e.message);
        const out = { error: "The AI stumbled - please try again in a moment." };
        if (req.session && req.session.role === "admin") {
            out.detail = String(e && e.message || "unknown").slice(0, 200); // FIX (pack 30): the office can see WHY
        }
        res.status(502).json(out);
    }
});

/* ---------- ADMIN AI SWITCH-ON (pack 29) ------------------------------
   The admin pastes the free key once on the AI Chat page -> it lands in
   ai_config -> EVERY AI feature (chat, exam questions, website assistant)
   wakes up at once. GET never returns the full key (only the last 4
   characters) so it is safe to draw the "connected" state. */
app.get("/api/ai/config", requireAdmin, async (req, res) => {
    const cfg = await aiConfig();
    res.json({
        enabled: !!cfg.key,
        source: cfg.source || "",
        keyTail: cfg.key ? "\u2026" + cfg.key.slice(-4) : "",
        baseUrl: cfg.base,
        model: cfg.model,
        updatedBy: cfg.source === "app" ? (cfg.updatedBy || "") : ""
    });
});

app.post("/api/ai/config", requireAdmin, async (req, res) => {
    const apiKey  = String(req.body.apiKey  || "").trim().slice(0, 400);
    const baseUrl = String(req.body.baseUrl || "").trim().slice(0, 200);
    const model   = String(req.body.model   || "").trim().slice(0, 80);
    if (apiKey && !/^[\x20-\x7E]+$/.test(apiKey)) {
        return res.status(400).json({ error: "That key has odd characters - copy and paste it again carefully." });
    }
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
        return res.status(400).json({ error: "The service address must start with https:// - or leave it empty to use the default." });
    }
    const doSave = function (done) {
        if (!apiKey) { // empty key = REMOVE the in-app key (env key is untouched)
            connection.query("DELETE FROM ai_config WHERE id = 1", function (dErr) {
                if (dErr) return res.status(500).json({ error: "Could not remove the key - database error." });
                aiBustCache();
                res.json({ saved: true, cleared: true });
            });
            return;
        }
        const sql =
            "INSERT INTO ai_config (id, api_key, base_url, model, updated_by) VALUES (1, ?, ?, ?, ?) " +
            "ON DUPLICATE KEY UPDATE api_key = VALUES(api_key), base_url = VALUES(base_url), " +
            "model = VALUES(model), updated_by = VALUES(updated_by)";
        connection.query(sql, [apiKey, baseUrl || null, model || null, req.session.username || "admin"], function (err) {
            if (err) return res.status(500).json({ error: "Could not save the key - database error." });
            aiBustCache();
            done();
        });
    };
    doSave(async function () {
        try { /* one tiny test ping - the admin knows instantly it truly works.
                 FIX (pack 30): roomier token budget (newer "thinking" models
                 spend tokens on reasoning) and the fallback chain; when a
                 backup model is the one that answers, we save ITS name so
                 future chats don't waste time retrying the dead one. */
            const fresh = await aiConfig();
            const got = await aiChatSmart([{ role: "user", content: "Reply with the single word: OK" }], { maxTokens: 64, temperature: 0 }, fresh);
            if (got.model !== fresh.model) {
                connection.query("UPDATE ai_config SET model = ? WHERE id = 1", [got.model], function () {});
                aiBustCache();
            }
            res.json({ saved: true, cleared: false, verified: true, model: got.model });
        } catch (e) {
            res.json({
                saved: true, cleared: false, verified: false,
                note: "Saved, but the test call failed: " + (e && e.message || "service error") + ". Check the key and press Save again."
            });
        }
    });
});

/* ---------- AI FEATURE 3: website school assistant (public) -------------
   A receptionist-style chat bubble on the public website. Answers only
   school/website questions. Rate-limited per visitor to keep it polite. */
const aiAssistantHits = Object.create(null); // ip -> { count, resetAt }
setInterval(function () { // sweep expired buckets every 10 min (memory hygiene)
    const now = Date.now();
    Object.keys(aiAssistantHits).forEach(function (k) { if (aiAssistantHits[k].resetAt < now) delete aiAssistantHits[k]; });
}, 600000).unref();

app.post("/api/ai/assistant", async (req, res) => {
    const cfg = await aiConfig(); // CHANGED (pack 29): in-app key counts too
    if (!cfg.key) return aiNotReady(res);
    const ip = req.ip || req.connection.remoteAddress || "?";
    const now = Date.now();
    let bucket = aiAssistantHits[ip];
    if (!bucket || bucket.resetAt < now) bucket = aiAssistantHits[ip] = { count: 0, resetAt: now + 3600000 };
    if (++bucket.count > 20) {
        return res.status(429).json({ error: "You have asked a lot this hour - please chat with the office directly, or come back a little later." });
    }
    const message = String(req.body.message || "").trim().slice(0, 600);
    if (!message) return res.status(400).json({ error: "Type a question first." });
    const history = (Array.isArray(req.body.history) ? req.body.history : [])
        .slice(-8).map(function (h) {
            const role = h && h.role === "assistant" ? "assistant" : "user";
            return { role: role, content: String(h && h.content || "").slice(0, 300) };
        }).filter(h => h.content);

    // Live school facts (name, address, phone...) keep answers accurate.
    connection.query("SELECT * FROM school_settings WHERE id = 1", async (sErr, srows) => {
        const st = (!sErr && srows && srows.length) ? srows[0] : {};
        const facts =
            "School: Ameenullah School of Arabic and Islamic Studies (AMSAIS), Lagos, Nigeria. " +
            "Motto: Knowledge and Worship. " +
            (st.address ? "Address: " + st.address + ". " : "") +
            (st.phone ? "Phone: " + st.phone + ". " : "") +
            (st.email ? "Email: " + st.email + ". " : "") +
            // CHANGED (pack 36 - owner: "ai did not know that tahdiri is in our program"): added the Preparatory (Tahdiri) stage.
            "Programs: Preparatory (Tahdiri), Foundation (Ibtida'i), Middle (I'dadi), Advanced (Thanawi) Arabic/Islamic classes, " +
            "and Tahfeedhul-Qur'an evening memorisation (Thursday-Saturday, 4PM till sunset). " +
            "Website features: parents check results in the Parent Portal (student ID + surname as password), " +
            "chat with the school, see notices, timetables and calendars, upload payment evidence, and apply " +
            "for admission with the website form.";
        const sys =
            "You are the friendly front-desk assistant of Ameenullah School. Use ONLY these facts: " + facts +
            " Rules: answer in 1-4 short sentences, warm and simple English (parents may not be technical). " +
            "NEVER invent fees, dates, results or policies - if unsure, say the school office will confirm " +
            "and share the contact details if known. If a question is not about the school or this website, " +
            "politely say you only answer school questions. A short Islamic greeting is fine when greeted.";
        try {
            const got = await aiChatSmart(
                [{ role: "system", content: sys }].concat(history, [{ role: "user", content: message }]),
                { maxTokens: 1200, temperature: 0.6 }, // CHANGED (pack 31): was 320 - short answers got visibly cut
                cfg
            );
            res.json({ reply: got.text.trim().slice(0, 1200) });
        } catch (e) {
            console.log("AI assistant error:", e && e.message);
            res.status(502).json({ error: "The assistant is taking a short break - please try again in a moment." });
        }
    });
});

/* ==========================================================================
   NEW (pack 32): WEB PUSH - subscribe, unsubscribe, stats and the sender
   used by the four "golden triggers" below (results published, fee
   received, announcement posted, chat reply). Everything degrades
   silently: if a phone's subscription dies, it is pruned; if push is not
   ready yet, the rest of the system never notices.
   ========================================================================== */
const webpush = require("web-push");
let PUSH_VAPID = null;
function pushReady() { return !!PUSH_VAPID; }
function pushUseKeys(pub, priv, from) {
    try {
        webpush.setVapidDetails("mailto:madrasatuameenillah22@gmail.com", pub, priv);
        PUSH_VAPID = { publicKey: pub, privateKey: priv };
        console.log("Web push ready (" + from + ").");
    } catch (e) { console.log("Web push key problem:", e && e.message); }
}
function pushInit(attempt) {
    const ep = String(process.env.VAPID_PUBLIC_KEY || "").trim();
    const es = String(process.env.VAPID_PRIVATE_KEY || "").trim();
    if (ep && es) return pushUseKeys(ep, es, "environment");
    connection.query("SELECT * FROM push_keys WHERE id = 1", (err, rows) => {
        if (err) {
            if (attempt < 6) return setTimeout(() => pushInit(attempt + 1), 4000); // table still migrating
            return console.log("Web push key warning:", err.code || err.message);
        }
        if (rows && rows.length) return pushUseKeys(rows[0].public_key, rows[0].private_key, "saved keys");
        try {
            const k = webpush.generateVAPIDKeys(); // first ever boot - create + keep our own identity
            connection.query("INSERT INTO push_keys (id, public_key, private_key) VALUES (1, ?, ?)", [k.publicKey, k.privateKey], (iErr) => {
                if (iErr) console.log("Web push key save warning:", iErr.code || iErr.message);
            });
            pushUseKeys(k.publicKey, k.privateKey, "new keys generated");
        } catch (e) { console.log("Web push key warning:", e && e.message); }
    });
}

/* fire-and-forget send to specific users; dead phones prune themselves */
function amsPushSend(userType, userRefs, payload) {
    if (!pushReady() || !Array.isArray(userRefs) || !userRefs.length) return;
    const uniq = Array.from(new Set(userRefs.filter(Boolean)));
    if (!uniq.length) return;
    connection.query(
        "SELECT * FROM push_subscriptions WHERE user_type = ? AND user_ref IN (" + uniq.map(() => "?").join(",") + ")",
        [userType].concat(uniq),
        (err, subs) => {
            if (err || !subs || !subs.length) return;
            const data = JSON.stringify(payload);
            subs.forEach((sub) => {
                webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
                    data, { TTL: 86400 }
                ).catch((e) => {
                    if (e && (e.statusCode === 404 || e.statusCode === 410)) {
                        connection.query("DELETE FROM push_subscriptions WHERE id = ?", [sub.id], () => {});
                    } else if (e) {
                        console.log("push send notice:", e.statusCode || "", String(e.body || e.message || "").slice(0, 100));
                    }
                });
            });
        }
    );
}
function amsPushAll(userType, payload) {
    if (!pushReady()) return;
    connection.query("SELECT DISTINCT user_ref FROM push_subscriptions WHERE user_type = ?", [userType], (err, rows) => {
        if (err || !rows || !rows.length) return;
        amsPushSend(userType, rows.map(r => r.user_ref), payload);
    });
}

app.get("/api/push/public-key", (req, res) => {
    if (!pushReady()) return res.status(503).json({ error: "Alerts are warming up - try again in a moment." });
    res.json({ key: PUSH_VAPID.publicKey });
});

function pushSubscribe(req, res, userType, userRef) {
    const sub = req.body && req.body.subscription;
    const endpoint = sub && String(sub.endpoint || "").slice(0, 500);
    const p256dh = sub && sub.keys && String(sub.keys.p256dh || "").slice(0, 128);
    const auth   = sub && sub.keys && String(sub.keys.auth || "").slice(0, 64);
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ message: "That subscription looks broken - close the app and try again." });
    connection.query(
        "INSERT INTO push_subscriptions (endpoint, user_type, user_ref, keys_p256dh, keys_auth, last_seen_at) VALUES (?,?,?,?,?, NOW()) " +
        "ON DUPLICATE KEY UPDATE user_type = VALUES(user_type), user_ref = VALUES(user_ref), " +
        "keys_p256dh = VALUES(keys_p256dh), keys_auth = VALUES(keys_auth), last_seen_at = NOW()",
        [endpoint, userType, userRef, p256dh, auth],
        (err) => {
            if (err) { console.log("push subscribe notice:", err.code || err.message); return res.status(500).json({ message: "Could not save the alert subscription." }); }
            res.json({ message: "Alerts on." });
        }
    );
}
app.post("/api/push-subscribe", requireLogin, (req, res) => pushSubscribe(req, res, "staff", req.session.username));
app.post("/portal/push-subscribe", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    pushSubscribe(req, res, "portal", sid);
});
app.post("/api/push-unsubscribe", requireLogin, (req, res) => {
    const endpoint = String((req.body || {}).endpoint || "").slice(0, 500);
    connection.query("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint], () => res.json({ message: "Alerts off." }));
});
app.post("/portal/push-unsubscribe", (req, res) => {
    const endpoint = String((req.body || {}).endpoint || "").slice(0, 500);
    connection.query("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint], () => res.json({ message: "Alerts off." }));
});
app.get("/api/push/stats", requireAdmin, (req, res) => {
    connection.query(
        "SELECT user_type, COUNT(DISTINCT user_ref) users, COUNT(*) devices FROM push_subscriptions GROUP BY user_type",
        (err, rows) => {
            if (err) return res.status(500).json({ message: "Database error" });
            const out = { ready: pushReady(), portal: { users: 0, devices: 0 }, staff: { users: 0, devices: 0 } };
            (rows || []).forEach(r => { if (out[r.user_type]) out[r.user_type] = { users: r.users, devices: r.devices }; });
            res.json(out);
        });
});

/* NEW (pack 23): STAFF SETTINGS - change own password (teachers too). */
app.post("/api/change-password", requireLogin, (req, res) => {
    const current = String(req.body.current || "");
    const nextPw  = String(req.body.newPassword || "");
    if (!current || nextPw.length < 4) {
        return res.status(400).json({ message: "New password must be at least 4 characters." });
    }
    connection.query("SELECT * FROM users WHERE username = ?", [req.session.username], (err, rows) => {
        if (err || !rows.length) return res.status(500).json({ message: "Database error" });
        bcrypt.compare(current, rows[0].password_hash, (cErr, match) => {
            if (cErr || !match) return res.status(401).json({ message: "Current password is wrong." });
            bcrypt.hash(nextPw, 10, (hErr, hash) => {
                if (hErr) return res.status(500).json({ message: "Could not set password" });
                connection.query("UPDATE users SET password_hash = ? WHERE username = ?", [hash, req.session.username], (uErr) => {
                    if (uErr) return res.status(500).json({ message: "Database error" });
                    res.json({ message: "Password changed. Use it next time you log in." });
                });
            });
        });
    });
});

/* NEW (pack 23): teacher -> class assignment (admin, for Messages routing). */
app.get("/api/teacher-classes", requireLogin, requireAdmin, (req, res) => {
    connection.query("SELECT id, username, class_name FROM teacher_classes ORDER BY username, class_name", (err, rows) => {
        if (err) { if (err.code === "ER_NO_SUCH_TABLE") return res.json([]); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.post("/api/teacher-classes", requireLogin, requireAdmin, (req, res) => {
    const username = String(req.body.username || "").trim();
    const className = String(req.body.class_name || "").trim();
    if (!username || !className) return res.status(400).json({ message: "Teacher and class are required." });
    connection.query(
        "INSERT IGNORE INTO teacher_classes (username, class_name) VALUES (?, ?)",
        [username, className],
        (err) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json({ message: "Assigned." });
        }
    );
});

app.delete("/api/teacher-classes/:id", requireLogin, requireAdmin, (req, res) => {
    connection.query("DELETE FROM teacher_classes WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json({ message: "Removed." });
    });
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
        `SELECT r.student_id, COALESCE(s.full_name, r.student_name) AS student_name, r.class_name, r.subject, r.total, r.grade
         FROM results r
         INNER JOIN students s ON r.student_id = s.student_id
         WHERE r.class_name = ? AND r.term = ? AND r.session = ?
         ORDER BY s.full_name, r.subject`,
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

        let dobValue = (date_of_birth || "").trim();
        if (dobValue && !/^\d{4}-\d{2}-\d{2}$/.test(dobValue)) {
            dobValue = null;
        }
        if (!dobValue) dobValue = null;

        const photoPath = req.file
            ? `images/students/${req.file.filename}`
            : null;

        const parentName  = (req.body.parent_name  || "").trim();
        const parentPhone = (req.body.parent_phone || "").trim();
        const address     = (req.body.address      || "").trim();
        const hasParentData = studentProfileColsReady && (parentName || parentPhone || address);

        if (hasParentData) {
            connection.query(
                `INSERT INTO students
                 (student_id, full_name, gender, class_name, date_of_birth, photo_path,
                  parent_name, parent_phone, address)
                 VALUES (?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE
                   full_name = VALUES(full_name),
                   gender = VALUES(gender),
                   class_name = VALUES(class_name),
                   date_of_birth = VALUES(date_of_birth),
                   photo_path = COALESCE(VALUES(photo_path), photo_path),
                   parent_name = COALESCE(VALUES(parent_name), parent_name),
                   parent_phone = COALESCE(VALUES(parent_phone), parent_phone),
                   address = COALESCE(VALUES(address), address)`,
                [student_id, full_name, gender, class_name, dobValue, photoPath,
                 parentName || null, parentPhone || null, address || null],
                (err) => {
                    if (err) {
                        if (err.code === "ER_BAD_FIELD_ERROR") {
                            return insertStudentOriginal();
                        }
                        console.log(err);
                        return res.status(500).send("Database Error: " + (err.sqlMessage || err.message || "Could not save student"));
                    }
                    if (photoPath) backupStudentPhoto(student_id, req.file && req.file.path);
                    res.send("Student saved successfully");
                }
            );
            return;
        }

        insertStudentOriginal();

        function insertStudentOriginal() {
            const sql =`
            INSERT INTO students
            (student_id, full_name, gender, class_name, date_of_birth, photo_path)
            VALUES (?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE
              full_name = VALUES(full_name),
              gender = VALUES(gender),
              class_name = VALUES(class_name),
              date_of_birth = VALUES(date_of_birth),
              photo_path = COALESCE(VALUES(photo_path), photo_path)
            `;

            connection.query(
                sql,
                [
                    student_id,
                    full_name,
                    gender,
                    class_name,
                    dobValue,
                    photoPath
                ],
                (err, result) => {
                    if(err) {
                        console.log(err);
                        res.status(500).send("Database Error: " + (err.sqlMessage || err.message || "Could not save student"));
                    } else {
                        if (photoPath) backupStudentPhoto(student_id, req.file && req.file.path);
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
                    // FIX (pack 20): database copy of the photo (survives disk wipes)
                    if (photoPath) backupStudentPhoto(newId, req.file && req.file.path);
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
                // FIX (pack 20): database copy of the photo (survives disk wipes)
                backupStudentPhoto(studentId, req.file.path);
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

                // CHANGED (pack 20 - owner request): Class is NO LONGER
                // required - some pupils are not yet assigned to a class,
                // some dropped out or were transferred. Rows with a blank
                // Class now upload fine (blank class, assignable later);
                // only misspelt/non-empty class names are still refused.
                if (!studentId || !fullName || !gender) {
                    results.errors.push(`Row ${rowNum}: Missing required field(s) (Student ID, Full Name, and Gender are required; Class may be left blank).`);
                    return processNextRow();
                }

                if (gender !== "Male" && gender !== "Female") {
                    results.errors.push(`Row ${rowNum}: Gender must be exactly "Male" or "Female" (got "${gender}").`);
                    return processNextRow();
                }

                // CHANGED (pack 20): an EMPTY class is allowed (stored blank);
                // only a NON-empty class must exist in the class list.
                if (className && !validClasses.has(className)) {
                    results.errors.push(`Row ${rowNum}: "${className}" is not a recognized class. Check the "Valid Classes" sheet in the template (or leave Class blank to assign the pupil later).`);
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

    const { currentClass, nextClass: reqNextClass, mode } = req.body;
    let nextClass = reqNextClass && reqNextClass.trim() ? reqNextClass.trim() : "";

    if (!nextClass) {
        const promoteMap = {
            // Arabic classes
            "الأوّل التّحضيريّ": "الثّاني التّحضيريّ",
            "الثّاني التّحضيريّ": "الثّالث التّحضيريّ",
            "الثّالث التّحضيريّ": "الأوّل الابتدائيّ",
            "الأوّل الابتدائيّ": "الثّاني الابتدائيّ",
            "الثّاني الابتدائيّ": "الثّالث الابتدائيّ",
            "الثّالث الابتدائيّ": "الرّابع الابتدائيّ",
            "الرّابع الابتدائيّ": "الأوّل الإعداديّ",
            "الأوّل الإعداديّ": "الثّاني الإعداديّ",
            "الثّاني الإعداديّ": "الثّالث الإعداديّ",
            "الثّالث الإعداديّ": "الأوّل الثّانويّ",
            "الأوّل الثّانويّ": "الثّاني الثّانويّ",
            "الثّاني الثّانويّ": "الثّالث الثّانويّ",
            // English classes (JSS, SSS, Primary, Preliminary, Quranic)
            "Primary 1": "Primary 2",
            "Primary 2": "Primary 3",
            "Primary 3": "Primary 4",
            "Primary 4": "Primary 5",
            "Primary 5": "JSS 1",
            "JSS 1": "JSS 2",
            "JSS 2": "JSS 3",
            "JSS 3": "SSS 1",
            "SSS 1": "SSS 2",
            "SSS 2": "SSS 3",
            "Preliminary 1": "Preliminary 2",
            "Preliminary 2": "Preliminary 3",
            "Preliminary 3": "Primary 1"
        };
        nextClass = promoteMap[currentClass] || "";
    }

    if (!nextClass) {
        return res.status(400).send("No target class found. Please select a valid current class or specify Target Next Class.");
    }

    if (mode === "all") {
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
            res.send(`🚀 Unconditional Promotion Complete: ${result.affectedRows} student(s) promoted from ${currentClass} to ${nextClass}.`);
        });
        return;
    }

    // ⭐ Smart Merit-Based Promotion: check 3rd Term / session averages
    connection.query(
        "SELECT student_id, full_name FROM students WHERE class_name = ?",
        [currentClass],
        (err, students) => {
            if (err || !students || !students.length) {
                return res.send(`0 student(s) found in class ${currentClass}.`);
            }
            connection.query(
                "SELECT student_id, ROUND(AVG(total), 1) AS avg_total FROM results WHERE class_name = ? GROUP BY student_id",
                [currentClass],
                (err2, avgs) => {
                    const avgMap = {};
                    (avgs || []).forEach(row => { avgMap[row.student_id] = Number(row.avg_total); });

                    const promotedIds = [];
                    const promotedNames = [];
                    const repeatNames = [];

                    students.forEach(st => {
                        const score = avgMap[st.student_id];
                        if (score === undefined || isNaN(score) || score >= 50) {
                            promotedIds.push(st.student_id);
                            promotedNames.push(st.full_name || st.student_id);
                        } else {
                            repeatNames.push(`${st.full_name || st.student_id} (${score}%)`);
                        }
                    });

                    if (!promotedIds.length) {
                        return res.send(`⚠️ Smart Merit-Based Summary for ${currentClass}:\n• 0 students promoted.\n• Held Back to Repeat (${repeatNames.length}): ${repeatNames.join(", ")}`);
                    }

                    const placeholders = promotedIds.map(() => "?").join(",");
                    connection.query(
                        `UPDATE students SET class_name = ? WHERE student_id IN (${placeholders})`,
                        [nextClass].concat(promotedIds),
                        (uErr, uRes) => {
                            if (uErr) {
                                console.log(uErr);
                                return res.status(500).send("Database Error during promotion update");
                            }
                            let summary = `✅ Smart Merit-Based Promotion Summary for ${currentClass}:\n` +
                                `• Promoted to ${nextClass}: ${promotedIds.length} student(s)\n`;
                            if (repeatNames.length > 0) {
                                summary += `• Held Back to Repeat ${currentClass} (<50% average): ${repeatNames.length} student(s)\n  [${repeatNames.join(", ")}]`;
                            } else {
                                summary += `• Repeaters (<50% average): 0 student(s) (100% promotion rate!)`;
                            }
                            res.send(summary);
                        }
                    );
                }
            );
        }
    );
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
            // Cascade delete any orphan scores, attendance, tahfeedh, or chat records for this student
            connection.query("DELETE FROM results WHERE student_id = ?", [studentId], () => {});
            connection.query("DELETE FROM attendance WHERE student_id = ?", [studentId], () => {});
            connection.query("DELETE FROM tahfeedh WHERE student_id = ?", [studentId], () => {});
            connection.query("DELETE FROM messages WHERE (sender_type = 'portal' AND sender_ref = ?) OR (recipient_type = 'parent' AND recipient_ref = ?) OR sender_ref = ? OR recipient_ref = ?", [studentId, studentId, studentId, studentId], () => {});

            res.json({
                message: "Student deleted successfully",
            });
        }
    );
});

// NEW (Pack 45): automatic orphan cleanup - removes any ghost scores in results
// where the student_id no longer exists in the students database table.
app.delete("/api/clean-orphan-results", requireLogin, (req, res) => {
    const sql = `
        DELETE r FROM results r
        LEFT JOIN students s ON r.student_id = s.student_id
        WHERE s.student_id IS NULL
    `;
    connection.query(sql, (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: "Database Error while cleaning orphan results" });
        }
        res.json({
            message: `Purged ${result.affectedRows} ghost/orphan score(s) from database.`,
            removed: result.affectedRows
        });
    });
});

// NEW (Pack 45): one-click score deletion for a specific student in a term+session
// directly from the Class Results broadsheet page.
app.delete("/api/delete-student-term-results", requireLogin, (req, res) => {
    const { student_id, term, session } = req.body;
    if (!student_id || !term || !session) {
        return res.status(400).json({ message: "Student ID, Term and Session are required." });
    }
    connection.query(
        "DELETE FROM results WHERE student_id = ? AND term = ? AND session = ?",
        [student_id, term, session],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Database Error" });
            }
            res.json({
                message: `Deleted ${result.affectedRows} result row(s) for student.`,
                count: result.affectedRows
            });
        }
    );
});

// NEW (Pack 45): clear all results for an entire class in a specific term+session.
app.delete("/api/clear-class-term-results", requireLogin, (req, res) => {
    const { class_name, term, session } = req.body;
    if (!class_name || !term || !session) {
        return res.status(400).json({ message: "Class, Term and Session are required." });
    }
    connection.query(
        "DELETE FROM results WHERE class_name = ? AND term = ? AND session = ?",
        [class_name, term, session],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Database Error" });
            }
            res.json({
                message: `Cleared ${result.affectedRows} score row(s) for ${class_name}.`,
                count: result.affectedRows
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
        const sendOk = () => {
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
        };
        // NEW (pack 23): if the family set their own password in portal
        // Settings, it REPLACES the surname rule. Legacy login unchanged
        // for everyone who has not set one yet.
        if (st.portal_password) {
            return bcrypt.compare(password, st.portal_password, (err, match) => {
                if (err || !match) return res.status(401).json({ message: "Invalid Student ID or password" });
                sendOk();
            });
        }
        const ok = password.toLowerCase() === surname.toLowerCase()
                || password.toLowerCase() === fullName.toLowerCase();
        if (!ok) return res.status(401).json({ message: "Invalid Student ID or surname" });
        sendOk();
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
            /* NEW (pack 32): the moment results go live, every subscribed
               parent's phone rings - "results are out!" (fire-and-forget;
               the save answer itself never waits). */
            if (published) {
                const qs = className
                    ? ["SELECT student_id FROM students WHERE class_name = ?", [className]]
                    : ["SELECT student_id FROM students", []];
                connection.query(qs[0], qs[1], (sErr, studs) => {
                    if (sErr || !studs || !studs.length) return;
                    amsPushSend("portal", studs.map(r => r.student_id), {
                        title: "\u{1F4CA} Results are out!",
                        body: (className ? className + " \u2022 " : "") + term + ", " + session + " - open your portal to see the scores.",
                        url: "/portal.html",
                        tag: "result-" + term + "-" + session
                    });
                });
            }
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
        // CHANGED (pack 38 - owner: "some of the student information is not
        // displaying" on the admission letter): also return the pack-37
        // pipeline columns so the board + letter can show Admission No,
        // gender and date of birth (additive - old clients ignore extras).
        "SELECT id, child_name, parent_name, phone, class_applied, message, status, created_at, gender, date_of_birth, admitted_student_id, admitted_at FROM admission_enquiries ORDER BY created_at DESC LIMIT 500",
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

app.put("/admission-enquiry/:id", requireLogin, requireAdmin, (req, res) => {
    const status = (req.body.status || "").trim();
    // CHANGED (pack 37): 'declined' added - the enquiry board is now a
    // full little pipeline (new -> contacted -> admitted / declined).
    if (!["new", "contacted", "admitted", "declined"].includes(status)) {
        return res.status(400).json({ message: "Invalid status." });
    }
    connection.query("UPDATE admission_enquiries SET status = ? WHERE id = ?", [status, req.params.id], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "Updated" });
    });
});

/* NEW (pack 37 - admission pipeline): suggested next Student ID.
   Real IDs look like AM/26/143 (AM / admission year / running serial)
   - this takes the biggest serial on record and adds one. */
function amsNextStudentId(cb) {
    connection.query("SELECT student_id FROM students WHERE student_id LIKE 'AM/%/%'", (err, rows) => {
        if (err) return cb(err);
        let max = 0;
        (rows || []).forEach((r) => {
            const m = /^AM\/\d{2}\/(\d+)$/.exec(r.student_id || "");
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        const yy = String(new Date().getFullYear()).slice(-2);
        cb(null, "AM/" + yy + "/" + String(max + 1).padStart(3, "0"));
    });
}

app.get("/admission-next-id", requireLogin, requireAdmin, (req, res) => {
    amsNextStudentId((err, sid) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ student_id: sid });
    });
});

/* NEW (pack 37 - admission pipeline): one-tap ADMIT straight from an
   enquiry. Creates the REAL student record (same columns as Add
   Student, photo left blank - it can be added later from Students) so
   the Student/Parent portal login starts working immediately (surname
   = password, until the family changes it), then marks the enquiry
   admitted and stamps the new ID onto it. Never admits twice. */
app.post("/admission-enquiry/:id/admit", requireLogin, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ message: "Invalid enquiry id." });

    const fullName    = (req.body.full_name || "").trim();
    const gender      = (req.body.gender || "").trim();
    const className   = (req.body.class_name || "").trim();
    let   dob         = (req.body.date_of_birth || "").trim();
    const parentName  = (req.body.parent_name || "").trim();
    const parentPhone = (req.body.parent_phone || "").trim();
    let   studentId   = (req.body.student_id || "").trim();

    if (!fullName) return res.status(400).json({ message: "Child's full name is required." });
    if (gender !== "Male" && gender !== "Female") {
        return res.status(400).json({ message: 'Gender must be exactly "Male" or "Female".' }); // same rule as the uploader
    }
    if (!className) return res.status(400).json({ message: "Class is required for admission." });
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        return res.status(400).json({ message: "Date of birth must be YYYY-MM-DD." });
    }

    connection.query("SELECT * FROM admission_enquiries WHERE id = ?", [id], (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        if (!rows.length) return res.status(404).json({ message: "Enquiry not found." });
        const enq = rows[0];
        if (enq.status === "admitted" && enq.admitted_student_id) {
            return res.status(409).json({
                message: "Already admitted as " + enq.admitted_student_id + ".",
                student_id: enq.admitted_student_id
            });
        }

        connection.query("SELECT class_name FROM classes", (cErr, cls) => {
            if (cErr) { console.log(cErr); return res.status(500).json({ message: "Database error" }); }
            if (!(cls || []).some((c) => c.class_name === className)) {
                return res.status(400).json({ message: '"' + className + '" is not a recognized class.' }); // same rule as the uploader
            }

            const insertAndMark = (sid) => {
                const finish = () => {
                    // Stamp the pipeline fields back onto the enquiry. If a
                    // column is somehow missing yet (fresh boot race), the
                    // student is still admitted - we just log the notice.
                    connection.query(
                        `UPDATE admission_enquiries
                         SET status = 'admitted',
                             admitted_student_id = ?,
                             admitted_at = COALESCE(admitted_at, NOW()),
                             parent_name = COALESCE(NULLIF(?, ''), parent_name),
                             phone = COALESCE(NULLIF(?, ''), phone),
                             gender = COALESCE(NULLIF(?, ''), gender),
                             class_applied = ?,
                             date_of_birth = COALESCE(?, date_of_birth)
                         WHERE id = ?`,
                        [sid, parentName, parentPhone, gender, className, dob || null, id],
                        (uErr) => { if (uErr) console.log("Pack 37 admit-stamp notice:", uErr.code || uErr.message); }
                    );
                    res.json({
                        message: fullName + " admitted into " + className +
                                 ". Student/Parent portal login is now ACTIVE (password = child's surname).",
                        student_id: sid
                    });
                };
                const onInsert = (iErr) => {
                    if (iErr && iErr.code === "ER_DUP_ENTRY") {
                        return res.status(409).json({ message: 'Student ID "' + sid + '" already exists.' });
                    }
                    if (iErr) { console.log(iErr); return res.status(500).json({ message: "Error saving student" }); }
                    finish();
                };
                // Same shape as /save-student: parent columns when the
                // profile columns exist, otherwise the ORIGINAL insert -
                // backward compatible, no photo (added later if wanted).
                if (studentProfileColsReady) {
                    connection.query(
                        `INSERT INTO students
                         (student_id, full_name, gender, class_name, date_of_birth, photo_path,
                          parent_name, parent_phone, address)
                         VALUES (?,?,?,?,?,NULL,?,?,NULL)`,
                        [sid, fullName, gender, className, dob || null, parentName || null, parentPhone || null],
                        (iErr) => {
                            if (iErr && iErr.code === "ER_BAD_FIELD_ERROR") return insertOriginal();
                            onInsert(iErr);
                        }
                    );
                } else {
                    insertOriginal();
                }
                function insertOriginal() {
                    connection.query(
                        "INSERT INTO students (student_id, full_name, gender, class_name, date_of_birth, photo_path) VALUES (?,?,?,?,?,NULL)",
                        [sid, fullName, gender, className, dob || null],
                        onInsert
                    );
                }
            };

            const go = (sid) => {
                connection.query("SELECT 1 FROM students WHERE student_id = ? LIMIT 1", [sid], (dErr, dup) => {
                    if (dErr) { console.log(dErr); return res.status(500).json({ message: "Database error" }); }
                    if ((dup || []).length) {
                        return res.status(409).json({ message: 'Student ID "' + sid + '" already exists.' });
                    }
                    insertAndMark(sid);
                });
            };

            if (studentId) return go(studentId);
            amsNextStudentId((nErr, sid) => {
                if (nErr) { console.log(nErr); return res.status(500).json({ message: "Database error" }); }
                go(sid);
            });
        });
    });
});

/* NEW (pack 37): remove spam / mistakenly-sent enquiries (admin only). */
app.delete("/admission-enquiry/:id", requireLogin, requireAdmin, (req, res) => {
    connection.query("DELETE FROM admission_enquiries WHERE id = ?", [req.params.id], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "Deleted" });
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
    // CHANGED (pack 15): payments are tagged with a FEE TYPE (School Fee,
    // Developmental Fee, Exam Fee, custom). Falls back to the original
    // insert if the column is somehow missing (backward compatible).
    const feeType = (req.body.fee_type || "School Fee").trim() || "School Fee";
    connection.query(
        `INSERT INTO fee_payments (student_id, term, session, fee_type, amount, method, note, received_by)
         VALUES (?,?,?,?,?,?,?,?)`,
        [studentId, term, session, feeType, amount, method, note, req.session.username || null],
        (err) => {
            if (err && err.code === "ER_BAD_FIELD_ERROR") {
                return connection.query(
                    `INSERT INTO fee_payments (student_id, term, session, amount, method, note, received_by)
                     VALUES (?,?,?,?,?,?,?)`,
                    [studentId, term, session, amount, method, note, req.session.username || null],
                    (err2) => {
                        if (err2) { console.log(err2); return res.status(500).json({ message: "Database error" }); }
                        amsPushSend("portal", [studentId], { // NEW (pack 32)
                            title: "\u2705 Payment received",
                            body: "\u20A6" + amount.toLocaleString("en-US") + " (" + feeType + ") for " + term + " has been recorded. Thank you!",
                            url: "/portal.html", tag: "fee-" + studentId
                        });
                        res.json({ message: "Payment recorded", amount });
                    }
                );
            }
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            /* NEW (pack 32): parent's phone confirms instantly - no more
               "did the school see my money?" */
            amsPushSend("portal", [studentId], {
                title: "\u2705 Payment received",
                body: "\u20A6" + amount.toLocaleString("en-US") + " (" + feeType + ") for " + term + ", " + session + " has been recorded. Thank you!",
                url: "/portal.html", tag: "fee-" + studentId
            });
            res.json({ message: "Payment recorded", amount, fee_type: feeType });
        }
    );
});

app.get("/fee-payments", requireLogin, requireAdmin, (req, res) => {
    // CHANGED (pack 15): SELECT * so the new fee_type column comes along.
    let sql = "SELECT * FROM fee_payments";
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
    // CHANGED (pack 15): expected = all fee TYPES x class sizes (v2 table).
    const expectedSql = `
        SELECT COALESCE(SUM(fs.amount * c.cnt), 0) AS expected
        FROM fee_structure2 fs
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
    // CHANGED (pack 15): also stores due_day (late-fee alert day of the
    // month) and current_term (used by the dashboard alert). Legacy
    // fallback keeps the pack-14 columns if the v2 columns are absent.
    const dueDay = parseInt(req.body.due_day, 10);
    const currentTerm = f("current_term");
    const fullSql = `INSERT INTO school_settings
         (id, school_name, school_name_ar, motto, motto_ar, address, phone1, phone2, email, due_day, current_term)
         VALUES (1,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           school_name = VALUES(school_name), school_name_ar = VALUES(school_name_ar),
           motto = VALUES(motto), motto_ar = VALUES(motto_ar), address = VALUES(address),
           phone1 = VALUES(phone1), phone2 = VALUES(phone2), email = VALUES(email),
           due_day = VALUES(due_day), current_term = VALUES(current_term)`;
    const fullVals = [f("school_name"), f("school_name_ar"), f("motto"), f("motto_ar"), f("address"), f("phone1"), f("phone2"), f("email"),
                      (dueDay >= 1 && dueDay <= 28) ? dueDay : 10, currentTerm || "1st Term"];
    connection.query(fullSql, fullVals, (err) => {
        if (err && err.code === "ER_BAD_FIELD_ERROR") {
            return connection.query(
                `INSERT INTO school_settings
                 (id, school_name, school_name_ar, motto, motto_ar, address, phone1, phone2, email)
                 VALUES (1,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE
                   school_name = VALUES(school_name), school_name_ar = VALUES(school_name_ar),
                   motto = VALUES(motto), motto_ar = VALUES(motto_ar), address = VALUES(address),
                   phone1 = VALUES(phone1), phone2 = VALUES(phone2), email = VALUES(email)`,
                [f("school_name"), f("school_name_ar"), f("motto"), f("motto_ar"), f("address"), f("phone1"), f("phone2"), f("email")],
                (err2) => {
                    if (err2) { console.log(err2); return res.status(500).json({ message: "Database error" }); }
                    res.json({ message: "School settings saved" });
                }
            );
        }
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "School settings saved" });
    });
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


/* =====================================================================
   NEW (pack 15) - fee types, structure v2, parent payment proofs,
   bank accounts, portal fees, madrasah calendar. All additive.
   ===================================================================== */

/* ---------- Fee TYPES (School Fee / Developmental / Exam / custom) -- */
app.get("/fee-types", requireLogin, (req, res) => {
    connection.query("SELECT id, name FROM fee_types ORDER BY id", (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.post("/fee-type", requireLogin, requireAdmin, (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Fee type name is required." });
    connection.query("INSERT IGNORE INTO fee_types (name) VALUES (?)", [name], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "Fee type saved", name });
    });
});

app.delete("/fee-type/:id", requireLogin, requireAdmin, (req, res) => {
    connection.query("DELETE FROM fee_types WHERE id = ?", [req.params.id], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "Fee type removed" });
    });
});

/* ---------- Fee STRUCTURE v2 (per fee type per class) --------------- */
app.get("/fee-structure2", requireLogin, requireAdmin, (req, res) => {
    let sql = "SELECT fee_type, class_name, term, session, amount FROM fee_structure2";
    const params = [], wh = [];
    if (req.query.term)     { wh.push("term = ?");      params.push(req.query.term); }
    if (req.query.session)  { wh.push("session = ?");   params.push(req.query.session); }
    if (req.query.fee_type) { wh.push("fee_type = ?");  params.push(req.query.fee_type); }
    if (wh.length) sql += " WHERE " + wh.join(" AND ");
    sql += " ORDER BY fee_type, class_name";
    connection.query(sql, params, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.post("/fee-structure2", requireLogin, requireAdmin, (req, res) => {
    const feeType = (req.body.fee_type || "School Fee").trim() || "School Fee";
    const className = (req.body.class_name || "").trim();
    const term = (req.body.term || "").trim();
    const session = (req.body.session || "").trim();
    const amount = Number(req.body.amount);
    if (!className || !term || !session || !(amount >= 0)) {
        return res.status(400).json({ message: "fee_type, class_name, term, session and a valid amount are required." });
    }
    connection.query(
        `INSERT INTO fee_structure2 (fee_type, class_name, term, session, amount)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
        [feeType, className, term, session, amount],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Fee saved", fee_type: feeType, class_name: className, amount });
        }
    );
});

/* NEW (pack 28 - finance tidy-up): remove ONE charge (e.g. a mistaken
   "Uniform Fee") from ONE class for a term/session. The other classes and
   fee types are untouched. Payments already recorded stay on record. */
app.delete("/fee-structure2", requireLogin, requireAdmin, (req, res) => {
    const feeType = (req.body.fee_type || "").trim();
    const className = (req.body.class_name || "").trim();
    const term = (req.body.term || "").trim();
    const session = (req.body.session || "").trim();
    if (!feeType || !className || !term || !session) {
        return res.status(400).json({ message: "fee_type, class_name, term and session are all required." });
    }
    if (feeType === "School Fee") {
        return res.status(400).json({ message: "The School Fee row cannot be deleted - set it to 0 instead." });
    }
    connection.query(
        "DELETE FROM fee_structure2 WHERE fee_type = ? AND class_name = ? AND term = ? AND session = ?",
        [feeType, className, term, session],
        (err, out) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Charge removed", deleted: out.affectedRows || 0 });
        }
    );
});

/* ---------- Balance v2: per student, per fee TYPE (admin) ----------- */
app.get("/fee-balance-v2", requireLogin, requireAdmin, (req, res) => {
    const term = (req.query.term || "").trim();
    const session = (req.query.session || "").trim();
    const className = (req.query.class_name || "").trim();
    const studentId = (req.query.student_id || "").trim(); // NEW (pack 21): dashboard quick card asks for ONE student
    if (!term || !session) return res.status(400).json({ message: "term and session are required." });
    let sql = `
        SELECT s.student_id, s.full_name, s.class_name,
               fs.fee_type, fs.amount AS fee,
               COALESCE(p.paid, 0) AS paid,
               (fs.amount - COALESCE(p.paid, 0)) AS balance
        FROM students s
        JOIN fee_structure2 fs
          ON fs.class_name = s.class_name AND fs.term = ? AND fs.session = ?
        LEFT JOIN (SELECT student_id, fee_type, SUM(amount) AS paid
                     FROM fee_payments WHERE term = ? AND session = ?
                    GROUP BY student_id, fee_type) p
               ON p.student_id = s.student_id AND p.fee_type = fs.fee_type
    `;
    const params = [term, session, term, session];
    const wh2 = [];
    if (className) { wh2.push("s.class_name = ?"); params.push(className); }
    if (studentId) { wh2.push("s.student_id = ?"); params.push(studentId); } // NEW (pack 21)
    if (wh2.length) sql += " WHERE " + wh2.join(" AND ");
    sql += " ORDER BY s.class_name, s.full_name, fs.fee_type";
    connection.query(sql, params, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

/* ---------- Late-fee ALERTS for the dashboard (admin) ---------------
   Students whose unpaid balance > 0 for the fee type (default
   'School Fee') - flagged late once the day of month passes due_day. */
app.get("/fee-alerts", requireLogin, requireAdmin, (req, res) => {
    const term = (req.query.term || "").trim();
    const session = (req.query.session || "").trim();
    const feeType = (req.query.fee_type || "School Fee").trim() || "School Fee";
    if (!term || !session) return res.status(400).json({ message: "term and session are required." });
    connection.query(
        `SELECT s.student_id, s.full_name, s.class_name,
                fs.amount AS fee, COALESCE(p.paid, 0) AS paid,
                (fs.amount - COALESCE(p.paid, 0)) AS balance
         FROM students s
         JOIN fee_structure2 fs
           ON fs.class_name = s.class_name AND fs.term = ? AND fs.session = ? AND fs.fee_type = ?
         LEFT JOIN (SELECT student_id, SUM(amount) AS paid
                      FROM fee_payments WHERE term = ? AND session = ? AND fee_type = ?
                     GROUP BY student_id) p ON p.student_id = s.student_id
         HAVING balance > 0
         ORDER BY s.class_name, s.full_name`,
        [term, session, feeType, term, session, feeType],
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            connection.query("SELECT due_day FROM school_settings WHERE id = 1", (e2, srows) => {
                const dueDay = (!e2 && srows && srows.length && srows[0].due_day) ? Number(srows[0].due_day) : 10;
                const today = new Date().getDate();
                const late = today > dueDay;
                res.json({
                    due_day: dueDay, today, is_late: late, fee_type: feeType, term, session,
                    alerts: late ? rows : []   // nobody is "late" before the due day
                });
            });
        }
    );
});

/* ================= NEW (pack 33): DEBTORS BOARD =================
   One admin screen: every student still owing for a term & session,
   summed across ALL fee types, biggest debt first, with one-tap
   reminders (portal chat message + phone push). This is READ-ONLY
   with respect to the existing fee logic: it runs the exact same
   joins as /fee-balance-v2 and only aggregates the rows. */
// NEW (pack 33): shared fee-rows helper - EXACT copy of /fee-balance-v2's
// query so the debtors board always agrees with the Finance numbers.
function amsFeeBalanceRows(term, session, className, studentIds, cb) {
    let sql = `
        SELECT s.student_id, s.full_name, s.class_name,
               fs.fee_type, fs.amount AS fee,
               COALESCE(p.paid, 0) AS paid,
               (fs.amount - COALESCE(p.paid, 0)) AS balance
        FROM students s
        JOIN fee_structure2 fs
          ON fs.class_name = s.class_name AND fs.term = ? AND fs.session = ?
        LEFT JOIN (SELECT student_id, fee_type, SUM(amount) AS paid
                     FROM fee_payments WHERE term = ? AND session = ?
                    GROUP BY student_id, fee_type) p
               ON p.student_id = s.student_id AND p.fee_type = fs.fee_type
    `;
    const params = [term, session, term, session];
    const wh = [];
    if (className) { wh.push("s.class_name = ?"); params.push(className); }
    if (Array.isArray(studentIds) && studentIds.length) {
        wh.push("s.student_id IN (" + studentIds.map(() => "?").join(",") + ")");
        studentIds.forEach((sid) => params.push(sid));
    }
    if (wh.length) sql += " WHERE " + wh.join(" AND ");
    sql += " ORDER BY s.class_name, s.full_name, fs.fee_type";
    connection.query(sql, params, (err, rows) => cb(err, rows));
}

// NEW (pack 33): fold per-fee-type rows into per-student debt cards.
// Overpaying one fee type never hides a debt on another (owed = sum of
// positive per-type balances only); the overpaid part shows as credit.
function amsDebtorsAggregate(rows) {
    const byStudent = {};
    (rows || []).forEach((r) => {
        const sid = r.student_id;
        if (!byStudent[sid]) byStudent[sid] = {
            student_id: sid, full_name: r.full_name, class_name: r.class_name,
            expected: 0, paid: 0, owed: 0, credit: 0, items: []
        };
        const card = byStudent[sid];
        const fee = Number(r.fee) || 0;
        const paid = Number(r.paid) || 0;
        const bal = fee - paid;
        card.expected += fee;
        card.paid += paid;
        if (bal > 0) { card.owed += bal; card.items.push({ fee_type: r.fee_type, balance: bal }); }
        else if (bal < 0) { card.credit += -bal; }
    });
    const list = Object.keys(byStudent).map((k) => byStudent[k]);
    list.sort((a, b) => (b.owed - a.owed) || (a.full_name < b.full_name ? -1 : 1)); // biggest debt first
    return list;
}

// NEW (pack 33): the board - debtors (owed > 0) with totals & due-day flag.
app.get("/fee-debtors", requireLogin, requireAdmin, (req, res) => {
    const term = (req.query.term || "").trim();
    const session = (req.query.session || "").trim();
    const className = (req.query.class_name || "").trim();
    if (!term || !session) return res.status(400).json({ message: "term and session are required." });
    amsFeeBalanceRows(term, session, className, null, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        connection.query(
            "SELECT student_id, MAX(paid_at) AS last_pay FROM fee_payments WHERE term = ? AND session = ? GROUP BY student_id",
            [term, session],
            (e2, lp) => {
                const lastPay = {};
                if (!e2 && lp) lp.forEach((r) => { lastPay[r.student_id] = r.last_pay; });
                const all = amsDebtorsAggregate(rows);
                const debtors = all.filter((c) => c.owed > 0);
                debtors.forEach((c) => { c.last_pay = lastPay[c.student_id] || null; });
                connection.query("SELECT due_day FROM school_settings WHERE id = 1", (e3, srows) => {
                    const dueDay = (!e3 && srows && srows.length && srows[0].due_day) ? Number(srows[0].due_day) : 10;
                    const today = new Date().getDate();
                    res.json({
                        term, session,
                        due_day: dueDay, today, is_late: today > dueDay,
                        students_total: all.length,
                        owing_count: debtors.length,
                        cleared_count: all.length - debtors.length,
                        expected_total: all.reduce((t, c) => t + c.expected, 0),
                        paid_total: all.reduce((t, c) => t + c.paid, 0),
                        outstanding_total: debtors.reduce((t, c) => t + c.owed, 0),
                        debtors
                    });
                });
            }
        );
    });
});

// NEW (pack 33): one-tap reminder - polite portal chat message + phone push.
// Balance is recomputed live so we never remind a parent who just paid.
app.post("/fee-debtors/remind", requireLogin, requireAdmin, (req, res) => {
    const me = req.session.username;
    const term = String(req.body.term || "").trim();
    const session = String(req.body.session || "").trim();
    let ids = req.body.student_ids;
    if (!term || !session) return res.status(400).json({ message: "term and session are required." });
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: "Pick at least one student to remind." });
    ids = Array.from(new Set(ids.map((s) => String(s || "").trim()).filter(Boolean))).slice(0, 200);
    if (!ids.length) return res.status(400).json({ message: "Pick at least one student to remind." });
    amsFeeBalanceRows(term, session, "", ids, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        const owedBy = {};
        amsDebtorsAggregate(rows).forEach((c) => { owedBy[c.student_id] = c; });
        const results = {};
        const targets = [];
        ids.forEach((sid) => {
            if (!owedBy[sid]) results[sid] = "not-owing";
            else if (owedBy[sid].owed <= 0) results[sid] = "cleared";
            else targets.push(sid);
        });
        if (!targets.length) return res.json({ sent: 0, skipped: ids.length, failed: 0, results });
        let i = 0, failed = 0;
        const fmtN = (n) => "\u20A6" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
        (function next() {
            if (i >= targets.length) return res.json({ sent: targets.length - failed, skipped: ids.length - targets.length, failed, results });
            const sid = targets[i++];
            const c = owedBy[sid];
            const parts = c.items.map((it) => it.fee_type + " " + fmtN(it.balance));
            const body = ("Assalamu 'alaikum. Kind reminder: " + fmtN(c.owed) + " is still outstanding for " +
                c.full_name + " (" + term + ", " + session + ")" +
                (parts.length ? " - " + parts.join(", ") : "") +
                ". Please pay to any of the school bank accounts shown on the portal, or send your receipt there. Jazakumullahu khairan.").slice(0, 2000);
            connection.query(
                `INSERT INTO messages (sender_type, sender_ref, sender_name, recipient_type, recipient_ref, recipient_class, body, thread)
                 VALUES ('staff', ?, ?, 'parent', ?, '', ?, 'admin')`,
                [me, me + " (" + req.session.role + ")", sid, body],
                (iErr) => {
                    if (iErr) { console.log(iErr); failed++; results[sid] = "failed"; }
                    else {
                        results[sid] = "sent";
                        // the parent's phone rings (pack 32 push), tagged so
                        // repeat reminders replace instead of stacking up
                        amsPushSend("portal", [sid], {
                            title: "\u{1F4B3} School fee reminder",
                            body: fmtN(c.owed) + " outstanding for " + term + " - tap to see how to pay.",
                            url: "/portal.html", tag: "debt-" + sid
                        });
                    }
                    next();
                }
            );
        })();
    });
});

/* ---------- BANK ACCOUNTS (many; shown on parent portal) ------------- */
app.get("/bank-accounts", (req, res) => {
    connection.query("SELECT id, bank_name, account_name, account_number FROM bank_accounts ORDER BY id", (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.post("/bank-account", requireLogin, requireAdmin, (req, res) => {
    const bank = (req.body.bank_name || "").trim();
    const accName = (req.body.account_name || "").trim();
    const accNum = (req.body.account_number || "").trim();
    if (!bank || !accNum) return res.status(400).json({ message: "Bank name and account number are required." });
    connection.query(
        "INSERT INTO bank_accounts (bank_name, account_name, account_number) VALUES (?,?,?)",
        [bank, accName, accNum],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Bank account saved" });
        }
    );
});

app.delete("/bank-account/:id", requireLogin, requireAdmin, (req, res) => {
    connection.query("DELETE FROM bank_accounts WHERE id = ?", [req.params.id], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "Bank account deleted" });
    });
});

/* ---------- PORTAL: my fees & balances (per fee type) ---------------- */
app.get("/portal/fees", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    connection.query(
        `SELECT fs.term, fs.session, fs.fee_type, fs.amount AS fee,
                COALESCE(p.paid, 0) AS paid,
                (fs.amount - COALESCE(p.paid, 0)) AS balance
         FROM fee_structure2 fs
         JOIN students st ON st.class_name = fs.class_name AND st.student_id = ?
         LEFT JOIN (SELECT student_id, term, session, fee_type, SUM(amount) AS paid
                      FROM fee_payments WHERE student_id = ?
                     GROUP BY student_id, term, session, fee_type) p
                ON p.term = fs.term AND p.session = fs.session AND p.fee_type = fs.fee_type
         ORDER BY fs.session DESC, fs.term, fs.fee_type`,
        [sid, sid],
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

/* NEW (pack 17 - owner request): the parent's own payment rows incl. the
   receipt photo the admin snapped, so "parent will also see it that admin
   has updated the fees in their portal". Legacy fallback keeps working
   while the receipt column warms up. */
app.get("/portal/payments", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    // FIX (pack 17): the payments table stamps paid_at (not created_at).
    connection.query(
        `SELECT id, fee_type, term, session, amount, method, note, receipt_path, paid_at AS created_at
         FROM fee_payments WHERE student_id = ? ORDER BY paid_at DESC LIMIT 100`,
        [sid],
        (err, rows) => {
            if (err && err.code === "ER_BAD_FIELD_ERROR") {
                return connection.query(
                    `SELECT id, amount, method, note, paid_at AS created_at, 'School Fee' AS fee_type, '' AS term, '' AS session, NULL AS receipt_path
                     FROM fee_payments WHERE student_id = ? ORDER BY paid_at DESC LIMIT 100`,
                    [sid],
                    (err2, rows2) => {
                        if (err2) { console.log(err2); return res.status(500).json({ message: "Database error" }); }
                        res.json(rows2);
                    }
                );
            }
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

/* ---------- PORTAL: parent uploads payment proof (screenshot/PDF) ---- */
const evidenceDir = path.join(__dirname, "uploads", "payment-evidence");
try { fs.mkdirSync(evidenceDir, { recursive: true }); } catch (e) { /* exists */ }

const evidenceStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/payment-evidence/"),
    filename: (req, file, cb) => {
        const safe = (file.originalname || "proof").replace(/[^a-zA-Z0-9.\-_]/g, "_");
        cb(null, "ev_" + Date.now() + "_" + safe);
    }
});
const uploadEvidence = multer({
    storage: evidenceStorage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = /^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype) || file.mimetype === "application/pdf";
        cb(ok ? null : new Error("Only an image (PNG/JPG) or PDF is allowed."), ok);
    }
});

app.post("/portal/payment-submission", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    uploadEvidence.single("evidence")(req, res, (upErr) => {
        if (upErr) {
            return res.status(400).json({ message: upErr.message || "Upload failed" });
        }
        const feeType = (req.body.fee_type || "School Fee").trim() || "School Fee";
        const term = (req.body.term || "").trim();
        const session = (req.body.session || "").trim();
        const amount = Number(req.body.amount);
        const note = (req.body.note || "").trim();
        if (!term || !session || !(amount > 0)) {
            return res.status(400).json({ message: "Fee type, term, session and a valid amount are required." });
        }
        const evidencePath = req.file ? ("uploads/payment-evidence/" + req.file.filename) : null;
        // FIX (pack 20): keep a database copy of the proof so it cannot
        // disappear when the host wipes its disk.
        const evidenceData = req.file ? fs.readFileSync(req.file.path) : null;
        queryImageSave(
            `INSERT INTO payment_submissions
             (student_id, fee_type, term, session, amount, note, evidence_path, evidence_data)
             VALUES (?,?,?,?,?,?,?,?)`,
            [sid, feeType, term, session, amount, note, evidencePath, evidenceData],
            `INSERT INTO payment_submissions
             (student_id, fee_type, term, session, amount, note, evidence_path)
             VALUES (?,?,?,?,?,?,?)`,
            [sid, feeType, term, session, amount, note, evidencePath],
            (err) => {
                if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
                res.json({ message: "Payment proof sent. The school will review it shortly." });
            }
        );
    });
});

app.get("/portal/my-submissions", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    connection.query(
        `SELECT id, fee_type, term, session, amount, note, evidence_path, status, created_at
         FROM payment_submissions WHERE student_id = ? ORDER BY created_at DESC LIMIT 50`,
        [sid],
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

/* ---------- ADMIN: review parent payment proofs ---------------------- */
app.get("/payment-submissions", requireLogin, requireAdmin, (req, res) => {
    let sql = `
        SELECT ps.*, st.full_name, st.class_name
        FROM payment_submissions ps
        LEFT JOIN students st ON st.student_id = ps.student_id
    `;
    const params = [];
    if (req.query.status) { sql += " WHERE ps.status = ?"; params.push(req.query.status); }
    sql += " ORDER BY ps.created_at DESC LIMIT 300";
    connection.query(sql, params, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

function reviewSubmission(req, res, approve) {
    connection.query("SELECT * FROM payment_submissions WHERE id = ?", [req.params.id], (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        if (!rows.length) return res.status(404).json({ message: "Submission not found." });
        const sub = rows[0];
        if (sub.status !== "pending") {
            return res.status(400).json({ message: "Already " + sub.status + "." });
        }
        const finish = () => {
            connection.query(
                "UPDATE payment_submissions SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
                [approve ? "approved" : "rejected", req.session.username || null, req.params.id],
                (err3) => {
                    if (err3) { console.log(err3); return res.status(500).json({ message: "Database error" }); }
                    res.json({ message: approve ? "Approved - added to the student's payments." : "Rejected." });
                }
            );
        };
        if (!approve) return finish();
        // Approved: becomes a REAL payment for the student (tagged by fee type)
        connection.query(
            `INSERT INTO fee_payments (student_id, term, session, fee_type, amount, method, note, received_by)
             VALUES (?,?,?,?,?,?,?,?)`,
            [sub.student_id, sub.term, sub.session, sub.fee_type || "School Fee", sub.amount,
             "Parent upload", "Parent proof #" + sub.id, req.session.username || null],
            (err2) => {
                if (err2 && err2.code === "ER_BAD_FIELD_ERROR") {
                    return connection.query(
                        `INSERT INTO fee_payments (student_id, term, session, amount, method, note, received_by)
                         VALUES (?,?,?,?,?,?,?)`,
                        [sub.student_id, sub.term, sub.session, sub.amount,
                         "Parent upload", "Parent proof #" + sub.id, req.session.username || null],
                        (err2b) => {
                            if (err2b) { console.log(err2b); return res.status(500).json({ message: "Database error" }); }
                            finish();
                        }
                    );
                }
                if (err2) { console.log(err2); return res.status(500).json({ message: "Database error" }); }
                finish();
            }
        );
    });
}

app.post("/payment-submission/:id/approve", requireLogin, requireAdmin, (req, res) => reviewSubmission(req, res, true));
app.post("/payment-submission/:id/reject",  requireLogin, requireAdmin, (req, res) => reviewSubmission(req, res, false));

/* ---------- NEW (pack 17 - owner request): receipt photo on a recorded
   payment. Admin snaps the receipt written in school and attaches it to
   the payment; the parent sees it in their portal (My Fees & Balance);
   admin can remove it if it is not clear. Reuses the image upload
   machinery (uploads/payment-evidence) built for parent proofs. */
app.post("/fee-payment/:id/receipt", requireLogin, requireAdmin, (req, res) => {
    uploadEvidence.single("receipt")(req, res, (upErr) => {
        if (upErr) return res.status(400).json({ message: upErr.message || "Upload failed" });
        if (!req.file) return res.status(400).json({ message: "Choose the receipt photo first." });
        const p = "uploads/payment-evidence/" + req.file.filename;
        // FIX (pack 20): database copy of the receipt photo too.
        const recData = fs.readFileSync(req.file.path);
        queryImageSave(
            "UPDATE fee_payments SET receipt_path = ?, receipt_data = ? WHERE id = ?",
            [p, recData, req.params.id],
            "UPDATE fee_payments SET receipt_path = ? WHERE id = ?",
            [p, req.params.id],
        (err, result) => {
            if (err) {
                // migration still creating the column (first boot after update)
                if (err.code === "ER_BAD_FIELD_ERROR") {
                    return res.status(503).json({ message: "Receipt feature is warming up - wait one minute and try again." });
                }
                console.log(err); return res.status(500).json({ message: "Database error" });
            }
            if (!result.affectedRows) return res.status(404).json({ message: "Payment not found." });
            res.json({ message: "Receipt photo saved - the parent can now see it in their portal.", path: p });
        });
    });
});

// Remove an unclear/wrong receipt photo (file is deleted too).
app.delete("/fee-payment/:id/receipt", requireLogin, requireAdmin, (req, res) => {
    connection.query("SELECT receipt_path FROM fee_payments WHERE id = ?", [req.params.id], (err, rows) => {
        if (err) {
            if (err.code === "ER_BAD_FIELD_ERROR") return res.status(503).json({ message: "Receipt feature is warming up - try again shortly." });
            console.log(err); return res.status(500).json({ message: "Database error" });
        }
        const p = rows && rows[0] && rows[0].receipt_path;
        connection.query("UPDATE fee_payments SET receipt_path = NULL WHERE id = ?", [req.params.id], (err2) => {
            if (err2) { console.log(err2); return res.status(500).json({ message: "Database error" }); }
            if (p && String(p).indexOf("uploads/") === 0) {
                try { fs.unlinkSync(path.join(__dirname, p)); } catch (e) { /* file already gone */ }
            }
            res.json({ message: "Receipt photo removed." });
        });
    });
});

/* NEW (pack 17 - owner request): dashboard reminder - every payment in
   the current term/session that still has NO snapped receipt photo,
   listed WITH the student names so admin knows exactly who is missing. */
app.get("/receipt-alerts", requireLogin, requireAdmin, (req, res) => {
    const term = (req.query.term || "").trim();
    const schoolSession = (req.query.session || "").trim();
    // FIX (pack 17): the payments table stamps paid_at (not created_at).
    let sql = `SELECT fp.id, fp.student_id, st.full_name, fp.fee_type, fp.amount, fp.paid_at AS created_at
               FROM fee_payments fp
               LEFT JOIN students st ON st.student_id = fp.student_id
               WHERE (fp.receipt_path IS NULL OR fp.receipt_path = '')`;
    const params = [];
    if (term) { sql += " AND fp.term = ?"; params.push(term); }
    if (schoolSession) { sql += " AND fp.session = ?"; params.push(schoolSession); }
    sql += " ORDER BY fp.paid_at DESC LIMIT 200";
    connection.query(sql, params, (err, rows) => {
        if (err && err.code === "ER_BAD_FIELD_ERROR") return res.json([]); // column warming up
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

/* NEW (pack 17 - owner request): EVERY day attendance was marked for ONE
   particular student (dates in rows) - powers the attendance page's new
   per-student history card and its PDF download. */
app.get("/attendance/student", requireLogin, (req, res) => {
    const sid = (req.query.student_id || "").trim();
    if (!sid) return res.status(400).json({ message: "student_id is required." });
    connection.query(
        `SELECT a.att_date, a.status, a.class_name, s.full_name
         FROM attendance a
         LEFT JOIN students s ON s.student_id = a.student_id
         WHERE a.student_id = ?
         ORDER BY a.att_date DESC
         LIMIT 366`,
        [sid],
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

/* ---------- MADRASAH CALENDAR (admin) --------------------------------
   publishes ONE at a time: publishing auto-unpublishes the rest so the
   parent portal never shows duplicates from different terms. */
app.get("/calendars", requireLogin, (req, res) => {
    // NEW (pack 16): ?published=1 returns ONLY the live calendar - teachers
    // read this on their dashboard (same rule as the parent portal). The
    // plain list (admin studio) still returns everything, unchanged.
    const onlyLive = String(req.query.published || "") === "1";
    const sql = onlyLive
        ? "SELECT * FROM calendars WHERE published = 1 ORDER BY updated_at DESC LIMIT 5"
        : "SELECT * FROM calendars ORDER BY updated_at DESC";
    connection.query(sql, (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

/* Portal sees ONLY published calendars; unpublish/delete => it is gone. */
app.get("/portal/calendars", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    connection.query("SELECT * FROM calendars WHERE published = 1 ORDER BY updated_at DESC LIMIT 5", (err, rows) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json(rows);
    });
});

app.post("/calendar", requireLogin, requireAdmin, (req, res) => {
    const id = Number(req.body.id) || 0;
    const title = (req.body.title || "").trim();
    const docStr = typeof req.body.doc === "string" ? req.body.doc : JSON.stringify(req.body.doc || {});
    if (!title) return res.status(400).json({ message: "Calendar title is required." });
    if (id) {
        connection.query("UPDATE calendars SET title = ?, doc = ? WHERE id = ?", [title, docStr, id], (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Calendar saved", id });
        });
    } else {
        connection.query("INSERT INTO calendars (title, doc, published) VALUES (?,?,0)", [title, docStr], (err, result) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Calendar saved", id: result.insertId });
        });
    }
});

app.post("/calendar-publish", requireLogin, requireAdmin, (req, res) => {
    const id = Number(req.body.id);
    const publish = Number(req.body.published) ? 1 : 0;
    if (!id) return res.status(400).json({ message: "Calendar is required." });
    const apply = () => connection.query("UPDATE calendars SET published = ? WHERE id = ?", [publish, id], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: publish ? "Published - now visible on the parent portal." : "Unpublished - removed from the parent portal." });
    });
    if (publish) {
        // ONE live calendar at a time - no duplicates from other terms.
        connection.query("UPDATE calendars SET published = 0", (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            apply();
        });
    } else {
        apply();
    }
});

app.delete("/calendar/:id", requireLogin, requireAdmin, (req, res) => {
    connection.query("DELETE FROM calendars WHERE id = ?", [req.params.id], (err) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        res.json({ message: "Calendar deleted" });
    });
});

// ==========================================================================
// NEW (pack 39 - owner chose "One-tap backup" as the new beneficial
// feature): ADMIN-ONLY full JSON backup of the whole school database.
// One tap on the teacher dashboard downloads ameenullah-backup-YYYY-MM-DD.json.
// Student passport photo blobs are replaced with a short note so the file
// stays small enough for a phone to handle; everything else is complete.
// Additive route - nothing else was touched.
// ==========================================================================
app.get("/backup.json", requireLogin, requireAdmin, (req, res) => {
    connection.query("SHOW TABLES", (err, tables) => {
        if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
        const key = Object.keys(tables[0] || {})[0];
        const names = tables.map(r => r[key]);
        const out = {
            app: "Ameenullah School Result System",
            kind: "full-backup",
            version: 1,
            created_at: new Date().toISOString(),
            tables: {}
        };
        let i = 0;
        const nextTable = () => {
            if (i >= names.length) {
                const stamp = new Date().toISOString().slice(0, 10);
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Content-Disposition", 'attachment; filename="ameenullah-backup-' + stamp + '.json"');
                return res.send(JSON.stringify(out));
            }
            const t = names[i++];
            connection.query("SELECT * FROM `" + t + "`", (e2, rows) => {
                if (e2) { console.log(e2); out.tables[t] = { error: "could not read table" }; return nextTable(); }
                if (t === "students") {
                    rows.forEach(r => { if (r.photo_data) r.photo_data = "[passport photo stored on server - not included in backup]"; });
                }
                out.tables[t] = rows;
                nextTable();
            });
        };
        nextTable();
    });
});

// NEW (Pack 72): One-Click Restore from Backup JSON (ameenullah-backup-YYYY-MM-DD.json)
// Re-populates any empty or fresh MySQL database with all saved students, results, fees, classes & settings.
app.post("/api/restore-backup", requireLogin, requireAdmin, uploadStore.single("backup"), (req, res) => {
    if (!req.file && !req.body.json_data) {
        return res.status(400).json({ message: "No backup file uploaded." });
    }
    let data;
    try {
        const raw = req.file ? fs.readFileSync(req.file.path, "utf8") : req.body.json_data;
        data = JSON.parse(raw);
    } catch (e) {
        return res.status(400).json({ message: "Invalid JSON backup file format." });
    }

    const tablesObj = data.tables || data;
    const tableNames = Object.keys(tablesObj);
    if (!tableNames.length) {
        return res.status(400).json({ message: "No table records found in backup file." });
    }

    let restoredTables = 0;
    let totalRows = 0;

    tableNames.forEach((tbl) => {
        const rows = tablesObj[tbl];
        if (!Array.isArray(rows) || !rows.length) return;
        restoredTables++;
        rows.forEach((row) => {
            const cols = Object.keys(row).filter(c => c !== "photo_data" && c !== "id" && row[c] !== undefined);
            if (!cols.length) return;
            const vals = cols.map(c => row[c]);
            const placeholders = cols.map(() => "?").join(",");
            const colNames = cols.map(c => "`" + c + "`").join(",");

            const sql = `INSERT IGNORE INTO \`${tbl}\` (${colNames}) VALUES (${placeholders})`;
            connection.query(sql, vals, () => {});
            totalRows++;
        });
    });

    res.json({
        message: `🎉 Backup Restored Successfully! Processed ${restoredTables} tables and ${totalRows} records. All students & results are back!`,
        restoredTables,
        totalRows
    });
});

/* ==========================================================================
   NEW (pack 40a - owner chose "all" the suggested features):

   1) TAHFEEDH TRACKER: store each student's Qur'an memorisation progress
      (0-30 juz). Table is created here at boot (additive, IF NOT EXISTS).
      GET  /tahfeedh?class_name=...  -> class roster LEFT JOIN progress
      POST /tahfeedh {student_id, juz} -> save (upsert). Login required.

   2) HONOUR ROLL: PUBLIC read-only endpoint for the website - top 3
      students per class by average total in the LATEST term+session on
      record. Nothing is written; only name/avg/photo are exposed.
========================================================================== */
connection.query(
    `CREATE TABLE IF NOT EXISTS tahfeedh (
        student_id VARCHAR(50) NOT NULL PRIMARY KEY,
        juz TINYINT UNSIGNED NOT NULL DEFAULT 0,
        note VARCHAR(200) NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        updated_by VARCHAR(64) NULL
    )`,
    (e) => { if (e) console.log("Pack 40 tahfeedh table notice:", e.code || e.message); else console.log("Pack 40 setup ready (tahfeedh)."); }
);
// FIX (pack 40): a tahfeedh table may already exist WITHOUT updated_by -
// add it in that case (guarded; never alters anything else).
connection.query("ALTER TABLE tahfeedh ADD COLUMN updated_by VARCHAR(64) NULL", (e2) => {
    if (e2 && e2.code !== "ER_DUP_FIELDNAME") console.log("Pack 40 tahfeedh upgrade notice:", e2.code || e2.message);
});

app.get("/tahfeedh", requireLogin, (req, res) => {
    const className = (req.query.class_name || "").trim();
    if (!className) return res.status(400).json({ message: "class_name is required." });
    connection.query(
        `SELECT s.student_id, s.full_name, s.gender, s.photo_path,
                COALESCE(t.juz, 0) AS juz, t.note, t.updated_at
         FROM students s
         LEFT JOIN tahfeedh t ON t.student_id = s.student_id
         WHERE s.class_name = ?
         ORDER BY s.full_name`,
        [className],
        (err, rows) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json(rows);
        }
    );
});

app.post("/tahfeedh", requireLogin, (req, res) => {
    const sid = String(req.body.student_id || "").trim();
    const juz = Math.max(0, Math.min(30, parseInt(req.body.juz, 10) || 0));
    const note = String(req.body.note || "").trim().slice(0, 200) || null;
    if (!sid) return res.status(400).json({ message: "student_id is required." });
    connection.query(
        `INSERT INTO tahfeedh (student_id, juz, note, updated_by)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE juz = VALUES(juz), note = VALUES(note), updated_by = VALUES(updated_by)`,
        [sid, juz, note, req.session.username || null],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
            res.json({ message: "Saved", student_id: sid, juz: juz });
        }
    );
});

/* NEW (pack 40b): PUBLIC honour roll for the website. Read-only, tiny
   in-memory cache (60s) so the busy homepage never hammers the DB. */
let amsHonourCache = { at: 0, data: null };
app.get("/honour-roll", (req, res) => {
    if (amsHonourCache.data && Date.now() - amsHonourCache.at < 60000) {
        return res.json(amsHonourCache.data);
    }
    connection.query(
        `SELECT session, term FROM results
         ORDER BY session DESC, FIELD(term,'3rd Term','2nd Term','1st Term') LIMIT 1`,
        (e0, latest) => {
            if (e0) { console.log(e0); return res.status(500).json({ message: "Database error" }); }
            if (!latest || !latest.length) return res.json({ session: null, term: null, classes: [] });
            const session = latest[0].session, term = latest[0].term;
            connection.query(
                `SELECT r.class_name, r.student_id, MAX(r.student_name) AS full_name,
                        ROUND(AVG(r.total), 1) AS avg_total, COUNT(*) AS subjects
                 FROM results r
                 WHERE r.session = ? AND r.term = ?
                 GROUP BY r.class_name, r.student_id
                 ORDER BY r.class_name, avg_total DESC`,
                [session, term],
                (err, rows) => {
                    if (err) { console.log(err); return res.status(500).json({ message: "Database error" }); }
                    const byClass = {};
                    (rows || []).forEach((r) => {
                        (byClass[r.class_name] = byClass[r.class_name] || []).push(r);
                    });
                    const classes = Object.keys(byClass).map((c) => ({
                        class_name: c,
                        students: byClass[c].slice(0, 3)
                    }));
                    const data = { session, term, classes };
                    amsHonourCache = { at: Date.now(), data };
                    res.json(data);
                }
            );
        }
    );
});

/* =====================================================================
   NEW (Pack 47/49): SCHOOL FILE STORE / DIGITAL VAULT ENDPOINTS
   Allows teachers/admins to create folders, upload any files, preview, and download.
===================================================================== */
function fixUtf8(str) {
    if (!str) return str;
    try {
        const buf = Buffer.from(str, "latin1");
        if (buf.toString("utf8").length < str.length || /[\u0600-\u06FF]/.test(buf.toString("utf8"))) {
            return buf.toString("utf8");
        }
    } catch (e) {}
    return str;
}

function syncExamsToVault(cb) {
    connection.query(
        "SELECT id FROM school_file_store WHERE folder_path = '/' AND file_name = 'Saved Exams' AND is_folder = 1",
        (err, rows) => {
            if (!rows || !rows.length) {
                connection.query("INSERT INTO school_file_store (folder_path, file_name, original_name, is_folder) VALUES ('/', 'Saved Exams', 'Saved Exams', 1)", () => {});
            }
            connection.query("SELECT * FROM exams", (err2, exams) => {
                if (err2 || !exams || !exams.length) { if (cb) cb(); return; }
                exams.forEach((ex) => {
                    const wordOriginalName = `${ex.class_name} - ${ex.subject} - ${ex.title}.doc`;
                    connection.query(
                        "SELECT id FROM school_file_store WHERE folder_path = '/Saved Exams' AND original_name = ?",
                        [wordOriginalName],
                        (err3, exist) => {
                            if (!exist || !exist.length) {
                                autoStoreExamToVault(ex.title, ex.class_name, ex.subject, ex.term, ex.session, ex.duration, ex.instructions, ex.body_html);
                            }
                        }
                    );
                });
                if (cb) cb();
            });
        }
    );
}

app.get("/api/store/list", requireLogin, (req, res) => {
    let folder = (req.query.folder || "/").trim();
    let p1 = folder;
    let p2 = folder.endsWith("/") && folder !== "/" ? folder.slice(0, -1) : (folder === "/" ? "/" : folder + "/");
    let p3 = folder.replace(/^\//, "");
    let p4 = p3.endsWith("/") && p3 !== "" ? p3.slice(0, -1) : p3 + "/";
    if (!p3) p3 = "/";
    if (!p4) p4 = "/";

    syncExamsToVault(() => {
        connection.query(
            "SELECT * FROM school_file_store WHERE (folder_path = ? OR folder_path = ? OR folder_path = ? OR folder_path = ?) ORDER BY is_folder DESC, file_name ASC",
            [p1, p2, p3, p4],
            (err, rows) => {
                if (err) {
                    console.log(err);
                    return res.status(500).json({ message: "Database Error" });
                }
                const cleaned = (rows || []).map((r) => ({
                    ...r,
                    file_name: fixUtf8(r.file_name),
                    original_name: fixUtf8(r.original_name)
                }));
                res.json(cleaned);
            }
        );
    });
});

app.post("/api/store/create-folder", requireLogin, (req, res) => {
    const { folder_path, folder_name } = req.body;
    if (!folder_name || !folder_name.trim()) {
        return res.status(400).json({ message: "Folder name is required." });
    }
    const pathVal = folder_path || "/";
    connection.query(
        "INSERT INTO school_file_store (folder_path, file_name, original_name, is_folder) VALUES (?, ?, ?, 1)",
        [pathVal, folder_name.trim(), folder_name.trim()],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Database Error" });
            }
            res.json({ message: "Folder created successfully.", id: result.insertId });
        }
    );
});

app.post("/api/store/upload", requireLogin, uploadStore.array("files", 20), (req, res) => {
    let files = req.files || [];
    if (!files.length && req.file) files = [req.file];
    if (!files.length) {
        return res.status(400).json({ message: "No file(s) uploaded." });
    }
    const folder = req.body.folder_path || "/";
    let saved = 0;
    files.forEach((file) => {
        const cleanOriginalName = fixUtf8(file.originalname || "file");
        connection.query(
            "INSERT INTO school_file_store (folder_path, file_name, original_name, file_size, file_type, file_path, is_folder) VALUES (?, ?, ?, ?, ?, ?, 0)",
            [
                folder,
                cleanOriginalName,
                cleanOriginalName,
                file.size,
                file.mimetype || "application/octet-stream",
                file.filename
            ],
            () => {}
        );
        saved++;
    });
    res.json({ message: `Uploaded ${saved} file(s) successfully.`, count: saved });
});

app.delete("/api/store/delete/:id", requireLogin, (req, res) => {
    const id = req.params.id;
    connection.query("SELECT * FROM school_file_store WHERE id = ?", [id], (err, rows) => {
        if (err || !rows || !rows.length) {
            return res.status(404).json({ message: "Item not found." });
        }
        const item = rows[0];
        connection.query("DELETE FROM school_file_store WHERE id = ?", [id], (err2) => {
            if (err2) return res.status(500).json({ message: "Database Error" });
            if (item.is_folder === 0 && item.file_path) {
                const fp1 = path.join(storeDir, path.basename(item.file_path));
                const fp2 = path.join(__dirname, item.file_path);
                try { if (fs.existsSync(fp1)) fs.unlinkSync(fp1); else if (fs.existsSync(fp2)) fs.unlinkSync(fp2); } catch (e) {}
            }
            res.json({ message: "Deleted successfully." });
        });
    });
});

function resolveStoreFilePath(item) {
    if (!item) return null;
    const candidates = [
        item.file_path,
        item.file_name,
        item.original_name
    ].filter(Boolean);

    for (const cand of candidates) {
        const base = path.basename(cand);
        const paths = [
            path.join(storeDir, base),
            path.join(__dirname, "uploads", base),
            path.join(__dirname, "uploads", "payment-evidence", base),
            path.join(__dirname, "uploads", "store", base),
            path.join(__dirname, "images", base),
            path.join(__dirname, "images", "students", base),
            path.join(__dirname, "images", "signatures", base),
            path.join(__dirname, cand),
            path.join(__dirname, "uploads", cand),
            cand
        ];
        for (const p of paths) {
            try {
                if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                    return p;
                }
            } catch (e) {}
        }
    }
    return null;
}

app.get("/api/store/download/:id", requireLogin, (req, res) => {
    const id = req.params.id;
    connection.query("SELECT * FROM school_file_store WHERE id = ?", [id], (err, rows) => {
        if (err || !rows || !rows.length || rows[0].is_folder === 1) {
            return res.status(404).send("File not found.");
        }
        const item = rows[0];
        const fp = resolveStoreFilePath(item);
        if (!fp) {
            return res.status(404).send("File missing on server storage: " + (item.file_name || item.original_name));
        }
        const cleanName = fixUtf8(item.original_name || item.file_name || "download");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(cleanName)}`);
        res.setHeader("Content-Type", item.file_type || "application/octet-stream");
        res.sendFile(fp);
    });
});

app.get("/api/store/view/:id", requireLogin, (req, res) => {
    const id = req.params.id;
    connection.query("SELECT * FROM school_file_store WHERE id = ?", [id], (err, rows) => {
        if (err || !rows || !rows.length || rows[0].is_folder === 1) {
            return res.status(404).send("File not found.");
        }
        const item = rows[0];
        const fp = resolveStoreFilePath(item);
        if (!fp) {
            return res.status(404).send("File missing on server storage: " + (item.file_name || item.original_name));
        }
        const cleanName = fixUtf8(item.original_name || item.file_name || "view");
        res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(cleanName)}`);
        res.setHeader("Content-Type", item.file_type || "application/octet-stream");
        res.sendFile(fp);
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

// NEW (Pack 64): Render 502 Bad Gateway compliance - bind explicitly to 0.0.0.0
// and increase keepAliveTimeout/headersTimeout to 120s as advised in Render docs.
const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT} bound to 0.0.0.0`);
});
server.keepAliveTimeout = 120000; // 120 seconds (Render official recommendation)
server.headersTimeout = 120000;   // 120 seconds