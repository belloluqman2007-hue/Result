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
                    console.log("Add-on tables ready (announcements, school_events).");
                }
            });
        });
    });
}

setupAddonTables(1);

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
        `SELECT student_id, full_name, gender, class_name, date_of_birth, photo_path
         FROM students
         ORDER BY class_name, full_name`,
        (err, rows) => {
            if (err) {
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

app.get("/search-result/:studentId", (req, res) => {
    const studentId = req.params.studentId;
    const term = req.query.term;
    const session = req.query.session;

    if (!term || !session) {
        return res.status(400).json({ message: "Term and session are required." });
    }

    const sql = "SELECT * FROM results WHERE student_id = ? AND term = ? AND session = ?";

    connection.query(sql, [studentId, term, session], (err, currentTermResults) => {
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

app.get("/student-position/:studentId", (req, res) => {
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



app.get("/student/:studentId", (req, res) => {

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

    if (!role || (role !== "class_teacher" && role !== "principal")) {
        return res.status(400).json({ message: "Role must be 'class_teacher' or 'principal'." });
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

    let sql = "SELECT * FROM subjects";
    let params = [];

    if (className) {
        sql += " WHERE class_name = ?";
        params.push(className);
    }

    sql += " ORDER BY subject_name";

    connection.query(sql, params, (err, results) => {
        if (err) {
            console.log(err);
            res.status(500).send("Database Error");
        } else {
            res.json(results);
        }
    });
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
    connection.query(
        `SELECT student_id, student_name, class_name, term, session, subject,
                first_test, second_test, note_score, attendance_score,
                ca_score, exam_score, total, grade
         FROM results
         ORDER BY session, term, class_name, student_name, subject`,
        (err, rows) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Database Error");
            }
            if (!rows || rows.length === 0) {
                return res.status(404).send("No results to export yet.");
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

            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", "attachment; filename=all-results.xlsx");
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