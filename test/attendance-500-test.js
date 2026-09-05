/* ==========================================================================
   test/attendance-500-test.js  (NEW - pack 108)

   Reproduces the owner's report — "students still not displaying after I
   select a class; the page says the server answered with status 500" —
   against the REAL express app in server.js, with a fake MySQL layer that
   behaves like MySQL about SCHEMA:
     * ask for a table the scenario does not have  -> ER_NO_SUCH_TABLE
     * ask for a column the scenario does not have -> ER_BAD_FIELD_ERROR
     * compare/UNION class_name across two tables with different default
       collations                                  -> ER_CANT_AGGREGATE_2COLLATIONS
   and nothing else: it answers with the school's own shape of data.

   Every scenario runs twice — against `git show HEAD:server.js` (the code the
   owner is running) and against the working copy — so the difference is
   measured, not claimed.

     node test/attendance-500-test.js          # all scenarios
     node test/attendance-500-test.js legacy-attendance
   ========================================================================== */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { execFileSync, spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const CLASS = "SS 1";          // what the dropdown holds (from the classes table)
const SLOPPY = "SS  1";        // what a typing hand left in students.class_name
const DATE = "2026-09-05";
const PW = "test1234";

function studentsFor(scenario) {
  const cls = scenario.sloppyClass ? SLOPPY : CLASS;
  return [
    { student_id: "A101", full_name: "Aisha Bello", gender: "Female", class_name: cls, status: "active" },
    { student_id: "A102", full_name: "Bilal Yusuf", gender: "Male", class_name: cls, status: "active" },
    { student_id: "A103", full_name: "Maryam Sanni", gender: "Female", class_name: cls, status: "active" },
    { student_id: "A104", full_name: "Idris Farouk", gender: "Male", class_name: cls, status: "withdrawn" },
    { student_id: "B201", full_name: "Yakubu Musa", gender: "Male", class_name: "JSS 3", status: "active" }
  ];
}
function marksFor(scenario) {
  const cls = scenario.sloppyClass ? SLOPPY : CLASS;
  return [
    { id: 1, student_id: "A101", class_name: cls, att_date: DATE, status: "absent", marked_by: "admin", created_at: "2026-09-05 08:00:00" },
    { id: 2, student_id: "A102", class_name: cls, att_date: DATE, status: "present", marked_by: "admin", created_at: "2026-09-05 08:00:00" }
  ];
}

const FULL_ATT = ["id", "student_id", "class_name", "att_date", "status", "marked_by", "created_at"];
const SCENARIOS = {
  "ok": {
    label: "healthy database - the normal path must not change",
    cols: { users: ["id", "username", "password_hash", "role"], students: ["student_id", "full_name", "gender", "class_name", "status"], classes: ["id", "class_name"], attendance: FULL_ATT },
    uniqueDayKey: true, expectRows: 3, expectMarks: { A101: "absent", A102: "present", A103: null }, expectHistoryDays: 1, expectSummary: { taken: true, total: 2 }, expectReport: [{ id: "A101", present: 0, absent: 1, late: 0, marked: 1 }, { id: "A102", present: 1, absent: 0, late: 0, marked: 1 }]
  },
  "no-attendance-table": {
    label: "attendance table missing (fresh Railway/Render DB, add-on boot never finished)",
    cols: { users: ["id", "username", "password_hash", "role"], students: ["student_id", "full_name", "gender", "class_name", "status"], classes: ["id", "class_name"], attendance: null },
    uniqueDayKey: false, expectRows: 3, expectNotice: true, expectSaveStatus: 503, expectReport: [], expectHistoryDays: 0, expectSummary: { taken: false, total: 0 }
  },
  "legacy-attendance": {
    label: "attendance table predates pack 13 - no class_name, no marked_by, no unique key",
    cols: { users: ["id", "username", "password_hash", "role"], students: ["student_id", "full_name", "gender", "class_name", "status"], classes: ["id", "class_name"],
      attendance: ["id", "student_id", "att_date", "status"] },
    uniqueDayKey: false, expectRows: 3, expectMarks: { A101: "absent", A102: "present", A103: null }, expectNoClassInInsert: true, expectHistoryDays: 1, expectSummary: { taken: true, total: 2 }, expectReport: [{ id: "A101", present: 0, absent: 1, late: 0, marked: 1 }, { id: "A102", present: 1, absent: 0, late: 0, marked: 1 }]
  },
  "no-student-status": {
    label: "students table predates the status column (this is what also broke the class dropdown)",
    cols: { users: ["id", "username", "password_hash", "role"], students: ["student_id", "full_name", "gender", "class_name"], classes: ["id", "class_name"], attendance: FULL_ATT },
    /* with no status column at all nobody can be filtered out as withdrawn -
       the honest reading of a database that never had one. */
    uniqueDayKey: true, expectRows: 4, expectMarks: { A101: "absent", A102: "present", A104: null }, expectHistoryDays: 1, expectSummary: { taken: true, total: 2 }, expectReport: [{ id: "A101", present: 0, absent: 1, late: 0, marked: 1 }, { id: "A102", present: 1, absent: 0, late: 0, marked: 1 }]
  },
  "mixed-collation": {
    label: "tables built with different default collations - illegal mix on cross-table class_name work",
    cols: { users: ["id", "username", "password_hash", "role"], students: ["student_id", "full_name", "gender", "class_name", "status"], classes: ["id", "class_name"], attendance: FULL_ATT },
    uniqueDayKey: true, illegalMix: true, expectRows: 3, expectMarks: { A101: "absent", A102: "present", A103: null }, expectHistoryDays: 1, expectSummary: { taken: true, total: 2 }, expectReport: [{ id: "A101", present: 0, absent: 1, late: 0, marked: 1 }, { id: "A102", present: 1, absent: 0, late: 0, marked: 1 }]
  },
  "sloppy-class-name": {
    label: "pupils saved as \"SS  1\" (double space) while the dropdown says \"SS 1\" - the 'no students' report",
    cols: { users: ["id", "username", "password_hash", "role"], students: ["student_id", "full_name", "gender", "class_name", "status"], classes: ["id", "class_name"], attendance: FULL_ATT },
    uniqueDayKey: true, sloppyClass: true, expectRows: 3, expectMarks: { A101: "absent", A102: "present", A103: null }, expectHistoryDays: 1, expectSummary: { taken: true, total: 2 }, expectReport: [{ id: "A101", present: 0, absent: 1, late: 0, marked: 1 }, { id: "A102", present: 1, absent: 0, late: 0, marked: 1 }]
  }
};

/* ============================= the child ==================================
   node test/attendance-500-test.js --serve <dir> <port> <scenario>
   ========================================================================== */
if (process.argv[2] === "--serve") return serve();

function serve() {
  const dir = process.argv[3];
  const port = Number(process.argv[4]);
  const scenario = SCENARIOS[process.argv[5]];
  process.env.PORT = String(port);
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "harness-secret";
  process.env.DB_PASSWORD = "harness";
  process.env.ADMIN_DEFAULT_PASSWORD = PW;

  const trail = path.join(os.tmpdir(), "ams-sql-" + port + ".json");
  try { fs.unlinkSync(trail); } catch (e) {}
  const log = makeLog(trail);
  const connection = makeConnection(scenario, log);
  // Serve the fake db.js to whatever server.js requires ("./db").
  const dbPath = fs.realpathSync(path.join(dir, "db.js"));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: connection };
  require(path.join(dir, "server.js"));
  setTimeout(function () { console.log("READY " + port); }, 800);
}

/* The executed-SQL trail is streamed to a file so the parent can assert on
   exactly which statements the route ran (e.g. "no class_name in the
   INSERT"). Entries starting with ## are markers, not SQL. */
function makeLog(trail) {
  const arr = [];
  arr.push2 = function (v) {
    arr.push(v);
    try { fs.writeFileSync(trail, JSON.stringify(arr)); } catch (e) {}
  };
  return arr;
}

/* --------------------------- fake MySQL layer ----------------------------- */
function makeConnection(scenario, log) {
  const sessions = Object.create(null);
  const STUDENTS = studentsFor(scenario);
  const MARKS = marksFor(scenario);
  const USER = { id: 1, username: "admin", password_hash: require("bcryptjs").hashSync(PW, 8), role: "admin" };
  const SUSPECT = ["class_name", "att_date", "marked_by", "created_at", "student_id", "full_name", "gender", "status"];

  function colsOf(t) { return scenario.cols[t] ? new Set(scenario.cols[t]) : null; }
  function mkErr(code, sqlMessage) { const e = new Error(sqlMessage); e.code = code; e.sqlMessage = sqlMessage; return e; }
  function nameOf(id) { const s = STUDENTS.find(function (x) { return x.student_id === id; }); return s ? s.full_name : id; }

  function run(sqlRaw, params) {
    const sql = String(sqlRaw).replace(/\s+/g, " ").trim();
    params = params == null ? [] : (Array.isArray(params) ? params : [params]);
    if (log) log.push2(sql.length > 160 ? sql.slice(0, 160) + "..." : sql);

    /* schema introspection + boot chatter */
    if (/FROM information_schema\.COLUMNS/i.test(sql)) {
      const m = /TABLE_NAME IN \(([^)]*)\)/i.exec(sql);
      if (m) {
        const rows = [];
        m[1].split(",").map(function (t) { return t.trim().replace(/'/g, "").toLowerCase(); }).forEach(function (t) {
          (scenario.cols[t] || []).forEach(function (c) { rows.push({ t: t, c: c }); });
        });
        return { rows: rows };
      }
      const one = /TABLE_NAME = '([a-z_]+)'/i.exec(sql);
      if (one) return { rows: (scenario.cols[one[1]] || []).map(function (c) { return { c: c }; }) };
      return { rows: [] };
    }
    if (/FROM information_schema\.STATISTICS/i.test(sql)) {
      if (!scenario.cols.attendance) return { rows: [] };
      const rows = [{ i: "PRIMARY", cols: "id", non_unique: 0, nu: 0 }];
      if (scenario.uniqueDayKey) rows.push({ i: "uniq_student_day", cols: "student_id,att_date", non_unique: 0, nu: 0 });
      return { rows: rows };
    }
    if (/CREATE TABLE/i.test(sql)) return { rows: {} };
    if (/^SELECT sess, expires_at FROM app_sessions/i.test(sql)) {
      const s = sessions[params[0]];
      return { rows: s ? [{ sess: s, expires_at: Date.now() + 600000 }] : [] };
    }
    if (/^INSERT INTO app_sessions/i.test(sql)) { sessions[params[0]] = params[1]; return { rows: { affectedRows: 1 } }; }
    if (/^UPDATE app_sessions/i.test(sql)) return { rows: { affectedRows: 1 } };
    if (/^DELETE FROM app_sessions/i.test(sql)) { delete sessions[params[0]]; return { rows: { affectedRows: 0 } }; }
    if (/^SELECT 1$/i.test(sql)) return { rows: [{ n: 1 }] };

    /* --- MySQL-grade schema policing -------------------------------- */
    const known = ["students", "attendance", "classes", "users"];
    const tables = [];
    const alias = {};
    const tre = /(?:FROM|JOIN|INTO|UPDATE)\s+`?([a-z_]+)`?(?:\s+`?([a-z])`?)?/gi;
    let m;
    while ((m = tre.exec(sql))) {
      const t = m[1].toLowerCase();
      if (known.indexOf(t) === -1) continue;
      tables.push(t);
      if (m[2]) alias[m[2].toLowerCase()] = t;
    }
    const uniq = Array.from(new Set(tables));
    for (const t of uniq) {
      if (!colsOf(t)) return { err: mkErr("ER_NO_SUCH_TABLE", "Table 'school." + t + "' doesn't exist") };
    }
    const qre = /`?([a-z])`?\.`?([a-z_]+)`?/gi;
    while ((m = qre.exec(sql))) {
      const t = alias[m[1].toLowerCase()];
      if (!t || !colsOf(t)) continue;
      if (!colsOf(t).has(m[2].toLowerCase())) {
          return { err: mkErr("ER_BAD_FIELD_ERROR", "Unknown column '" + m[1] + "." + m[2] + "' in 'field list'") };
      }
    }
    if (uniq.length === 1 && !/^\s*INSERT/i.test(sql)) {
      /* Drop alias-qualified refs AND the `NULL AS x` output aliases before
         looking for a column the table does not have. `NULL AS marked_by` is a
         literal with a label, not a column reference - MySQL accepts it even
         on a table that has no marked_by, and the summary emits exactly that
         when the column is absent. Flagging it invented an ER_BAD_FIELD_ERROR
         that no real database would ever throw, and read as "banner says not
         taken" on every pre-pack-13 attendance table. */
      const bare = sql
        .replace(/`?([a-z])`?\.`?([a-z_]+)`?/gi, " ")
        .replace(/\bNULL\s+AS\s+[a-z_]+/gi, " ");
      for (const c of SUSPECT) {
        const cre = new RegExp("[^a-z_.]" + c + "[^a-z_]", "i");
        if (cre.test(bare) && !colsOf(uniq[0]).has(c)) {
          return { err: mkErr("ER_BAD_FIELD_ERROR", "Unknown column '" + c + "' in 'field list'") };
        }
      }
    }
    /* Mixed default collations bite on ANY comparison that puts a string
       column of one table next to one of another - not only class_name. The
       rule here used to require the clause to mention class_name, which is
       exactly why this harness reported PASS for the "Load report" 500 the
       owner hit: the statement that died was

         FROM attendance a JOIN students s ON s.student_id = a.student_id

       pinned with COLLATE around the *class_name* test while the JOIN KEY
       itself mixed utf8mb4_0900_ai_ci with utf8mb4_unicode_ci. Real MySQL
       refuses that, so now every ON/WHERE/UNION fragment is inspected on its
       own and a fragment that reaches into two tables without pinning a
       collation is the error MySQL would have thrown. */
    if (scenario.illegalMix) {
      const fragments = sql.split(/\bWHERE\b|\bON\b|\bUNION\b/i).slice(1);
      for (const frag of fragments) {
        const seen = new Set();
        const qre2 = /`?([a-z])`?\s*\.\s*`?([a-z_]+)`?/gi;
        let q;
        while ((q = qre2.exec(frag))) {
          const t = alias[q[1].toLowerCase()];
          if (t) seen.add(t);
        }
        if (seen.size >= 2 && !/COLLATE/i.test(frag)) {
          return { err: mkErr("ER_CANT_AGGREGATE_2COLLATIONS",
            "Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT) and (utf8mb4_0900_ai_ci,IMPLICIT) for operation '='") };
        }
      }
    }

    /* --- data -------------------------------------------------------- */
    if (/^SELECT \* FROM users/i.test(sql)) return { rows: params[0] === USER.username ? [USER] : [] };

    /* the class dropdown: SELECT DISTINCT ... class_name FROM students [UNION ... FROM classes] */
    if (/DISTINCT/i.test(sql) && /class_name/i.test(sql)) {
      const set = new Set();
      if (/FROM students/i.test(sql)) STUDENTS.forEach(function (st) {
        if (!/status/i.test(sql) || !st.status || st.status === "active") set.add(st.class_name.trim());
      });
      if (/FROM classes/i.test(sql)) ["JSS 3", "SS 1", "SS 2"].forEach(function (c) { set.add(c); });
      return { rows: Array.from(set).map(function (c) { return { class_name: c }; }) };
    }

    if (/FROM students/i.test(sql)) {
      let list = STUDENTS.slice();
      const wherePart = (sql.split(/WHERE/i)[1] || "");
      if (/TRIM\(s\.status\)|LOWER\(TRIM\(s\.status\)\)|status/i.test(wherePart)) {
        list = list.filter(function (s) { return !s.status || s.status === "active"; });
      }
      const selStar = /^SELECT \* FROM students/i.test(sql);
      if (!selStar) {
        const want = String(params[params.length - 1] == null ? "" : params[params.length - 1]);
        if (/class_name/i.test(wherePart)) list = list.filter(function (s) { return s.class_name.trim() === want.trim(); });
      }
      return { rows: list.map(function (s) {
        if (selStar) return Object.assign({}, s);
        const out = { student_id: s.student_id, full_name: s.full_name };
        if (/gender/i.test(sql.split(/FROM/i)[0])) out.gender = s.gender;
        /* the pre-pack-108 register joined attendance in SQL: give it the
           same marks MySQL would have returned, so both sides are compared
           on equal data. */
        if (/JOIN attendance/i.test(sql)) {
          const mk = MARKS.find(function (r) { return r.student_id === s.student_id && r.att_date === params[0]; });
          if (mk) out.status = mk.status;
        }
        return out;
      }) };
    }
    if (/FROM attendance/i.test(sql) && /COUNT\(\*\)/i.test(sql)) {
      const dateParam = params.filter(function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v)); })[0];
      let rows = MARKS.filter(function (r) { return r.att_date === dateParam; });
      /* pack 109 counts the day for one class by pupil id instead of joining
         to `students`, so the id list has to be honoured here too. */
      const cWhere = (sql.split(/\bWHERE\b/i)[1] || "");
      const cIds = /student_id IN \(\?\)/i.test(cWhere)
        ? (Array.isArray(params[1]) ? params[1] : []).map(String)
        : null;
      const cCls = /class_name/i.test(cWhere) && !cIds
        /* the class can be either param depending on which branch built the
           statement, so take the one that is not a date */
        ? String(params.filter(function (v) { return !/^\d{4}-\d{2}-\d{2}$/.test(String(v)); })[0])
        : null;
      if (cIds) rows = rows.filter(function (r) { return cIds.indexOf(String(r.student_id)) !== -1; });
      if (cCls != null) rows = rows.filter(function (r) { return String(r.class_name).trim() === cCls.trim(); });
      return { rows: [{
        total: rows.length,
        present: rows.filter(function (r) { return r.status === "present"; }).length,
        absent: rows.filter(function (r) { return r.status === "absent"; }).length,
        late: rows.filter(function (r) { return r.status === "late"; }).length,
        marked_by: rows.length ? rows[0].marked_by : null,
        saved_at: rows.length ? rows[0].created_at : null
      }] };
    }
    if (/FROM attendance/i.test(sql) && /GROUP BY/i.test(sql)) {
      /* The pre-pack-109 report aggregated in SQL. Honour its class filter and
         its date range the way MySQL would have, so the baseline column is a
         fair reading of the old code rather than a gift. */
      const range = /BETWEEN \? AND \?/i.test(sql);
      const lo = range ? String(params[0]) : null;
      const hi = range ? String(params[1]) : null;
      const clsParam = params.filter(function (v) { return !/^\d{4}-\d{2}-\d{2}$/.test(String(v)); })[0];
      const byClass = /class_name/i.test(sql) && clsParam != null;
      const by = {};
      MARKS.forEach(function (r) {
        if (range && !(r.att_date >= lo && r.att_date <= hi)) return;
        if (byClass && r.class_name.trim() !== String(clsParam).trim()) return;
        const e = by[r.student_id] || (by[r.student_id] = {
          student_id: r.student_id, full_name: nameOf(r.student_id), class_name: r.class_name,
          present: 0, absent: 0, late: 0, marked: 0
        });
        e.marked++; e[r.status]++;
      });
      return { rows: Object.keys(by).map(function (k) { return by[k]; }) };
    }
    /* pack 109 report: marks read from the attendance table ALONE (no join),
       either for a class_name or for a list of pupil ids, over a date range.
       NOTE: only the WHERE half may be inspected for class_name - the column
       also appears in the SELECT list of the unfiltered read, and treating
       that as a filter silently empties the report. */
    if (/FROM attendance/i.test(sql) && /att_date BETWEEN \? AND \?/i.test(sql)) {
      const lo = String(params[0]), hi = String(params[1]);
      const wherePart = (sql.split(/\bWHERE\b/i)[1] || "");
      const ids = /student_id IN \(\?\)/i.test(wherePart)
        ? (Array.isArray(params[2]) ? params[2] : []).map(String)
        : null;
      const cls = /class_name/i.test(wherePart) ? String(params[2]) : null;
      return { rows: MARKS.filter(function (r) {
        if (!(r.att_date >= lo && r.att_date <= hi)) return false;
        if (ids && ids.indexOf(String(r.student_id)) === -1) return false;
        if (cls != null && String(r.class_name).trim() !== cls.trim()) return false;
        return true;
      }) };
    }
    /* One pupil's history (pack 109 reads it without the LEFT JOIN). Without
       this the catch-all below hands back EVERY pupil's marks and labels them
       with one name, which is not what MySQL does. */
    if (/FROM attendance/i.test(sql) && /ORDER BY att_date DESC/i.test(sql)) {
      const rows = MARKS.filter(function (r) { return String(r.student_id) === String(params[0]); });
      return { rows: rows.slice().sort(function (a, b) { return a.att_date < b.att_date ? 1 : -1; }) };
    }
    if (/FROM attendance/i.test(sql) && /att_date = \? AND student_id IN/i.test(sql)) {
      const ids = (Array.isArray(params[1]) ? params[1] : []).map(String);
      return { rows: MARKS.filter(function (r) { return r.att_date === params[0] && ids.indexOf(String(r.student_id)) !== -1; }) };
    }
    if (/^INSERT INTO attendance/i.test(sql)) {
      const rows = Array.isArray(params[0]) ? params[0] : [];
      const cols = (/\(([^)]*)\) VALUES/i.exec(sql) || [, ""])[1];
      if (log) log.push2("##INSERT_COLS## " + cols + " ##ROWS## " + rows.length);
      return { rows: { affectedRows: rows.length } };
    }
    if (/^DELETE FROM attendance/i.test(sql)) return { rows: { affectedRows: 0 } };
    if (/FROM attendance/i.test(sql)) return { rows: MARKS.slice() };
    return { rows: [] };
  }

  return {
    query: function (sql, params, cb) {
      if (typeof params === "function") { cb = params; params = []; }
      const res = run(sql, params);
      setImmediate(function () { if (cb) cb(res.err || null, res.rows || [], null); });
    },
    getConnection: function (cb) { setImmediate(function () { cb(null, { query: function (q, p, c) { if (typeof p === "function") return p(null, []); const r = run(q, p); setImmediate(function () { c && c(r.err || null, r.rows || []); }); }, release: function () {} }); }); },
    on: function () {},
    end: function (cb) { cb && cb(); }
  };
}

/* ============================== the parent ================================
   Boots the app twice per scenario (HEAD vs working copy), drives the same
   four calls the attendance page makes, and compares.
   ========================================================================== */
function request(port, method, urlPath, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    const body = opts.body == null ? null : JSON.stringify(opts.body);
    const req = http.request({
      host: "127.0.0.1", port: port, path: urlPath, method: method,
      headers: Object.assign({ "Content-Type": "application/json" },
        opts.cookie ? { Cookie: opts.cookie } : {},
        opts.csrf ? { "x-csrf-token": opts.csrf } : {},
        body ? { "Content-Length": Buffer.byteLength(body) } : {})
    }, function (res) {
      let data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json: json });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/* The comparison baseline is `git show HEAD:server.js` - the code the school
   is actually running. Once this pack is merged, HEAD carries the fix too, so
   both columns simply read the same and the PASS lines stay true. Without a
   git checkout the baseline is skipped and only the patched behaviour is
   asserted. */
function prepareOldCopy() {
  const dir = path.join(os.tmpdir(), "ams-before-server");
  let src;
  try {
    src = execFileSync("git", ["show", "HEAD:server.js"], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch (e) {
    console.log("(no git baseline available - comparing against the patched server only)");
    return null;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "server.js"), src);
  ["third-term-parser.js", "package.json", "db.js"].forEach(function (f) {
    const dst = path.join(dir, f);
    if (fs.existsSync(dst) || fs.lstatSync(dst, { throwIfNoEntry: false })) { try { fs.unlinkSync(dst); } catch (e) {} }
    fs.symlinkSync(path.join(REPO, f), dst);
  });
  const nm = path.join(dir, "node_modules");
  try { fs.unlinkSync(nm); } catch (e) {}
  fs.symlinkSync(path.join(REPO, "node_modules"), nm);
  return dir;
}

function boot(dir, port, scenario, readyMs) {
  return new Promise(function (resolve, reject) {
    const child = spawn(process.execPath, [path.join(REPO, "test", "attendance-500-test.js"), "--serve", dir, String(port), scenario], {
      cwd: REPO, env: Object.assign({}, process.env), stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "", settled = false;
    const timer = setTimeout(function () { if (!settled) { settled = true; reject(new Error("server did not start: " + out.slice(-500))); } }, readyMs || 15000);
    child.stdout.on("data", function (b) {
      out += b.toString();
      if (!settled && /READY/.test(out)) { settled = true; clearTimeout(timer); resolve(child); }
    });
    child.stderr.on("data", function () {});
    child.on("exit", function (code) {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error("server exited " + code + ": " + out.slice(-500))); }
    });
  });
}

async function drive(port) {
  const login = await request(port, "POST", "/login", { body: { username: "admin", password: PW } });
  if (login.status !== 200) throw new Error("harness login failed: " + login.status + " " + login.body.slice(0, 160));
  const cookie = (login.headers["set-cookie"] || []).map(function (c) { return c.split(";")[0]; }).join("; ");
  const tok = await request(port, "GET", "/api/csrf-token", { cookie: cookie });
  const csrf = tok.json && tok.json.csrfToken;
  const qs = "class_name=" + encodeURIComponent(CLASS) + "&date=" + DATE;
  const out = {};
  out.register = await request(port, "GET", "/attendance/class?" + qs, { cookie: cookie });
  out.dropdown = await request(port, "GET", "/api/distinct-classes", { cookie: cookie });
  out.summary = await request(port, "GET", "/attendance/summary?" + qs, { cookie: cookie });
  out.report = await request(port, "GET", "/attendance/report?class_name=" + encodeURIComponent(CLASS) + "&from=" + DATE + "&to=" + DATE, { cookie: cookie });
  out.history = await request(port, "GET", "/attendance/student?student_id=A101", { cookie: cookie });
  out.badDate = await request(port, "GET", "/attendance/class?class_name=" + encodeURIComponent(CLASS) + "&date=today", { cookie: cookie });
  out.save = await request(port, "POST", "/attendance/save", {
    cookie: cookie, csrf: csrf,
    body: { class_name: CLASS, date: DATE, records: [{ student_id: "A101", status: "absent" }, { student_id: "A102", status: "late" }, { student_id: "A103", status: "present" }] }
  });
  return out;
}

async function main() {
  const only = process.argv[2];
  const names = Object.keys(SCENARIOS).filter(function (n) { return !only || n === only; });
  const oldDir = prepareOldCopy();
  let failures = 0, port = 4310;

  for (const name of names) {
    const scenario = SCENARIOS[name];
    const results = {};
    for (const which of ["before", "after"]) {
      if (which === "before" && !oldDir) { results.before = { skipped: true }; continue; }
      const dir = which === "before" ? oldDir : REPO;
      const p = ++port;
      let child;
      try {
        child = await boot(dir, p, name);
        results[which] = await drive(p);
      } catch (e) {
        results[which] = { error: String(e.message || e) };
      } finally {
        if (child) child.kill("SIGKILL");
        await new Promise(function (r) { setTimeout(r, 150); });
      }
      try {
        const trail = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "ams-sql-" + p + ".json"), "utf8"));
        if (results[which]) results[which].sql = trail;
      } catch (e) { if (results[which]) results[which].sql = []; }
      try { fs.unlinkSync(path.join(os.tmpdir(), "ams-sql-" + p + ".json")); } catch (e) {}
    }
    failures += report(name, scenario, results);
  }
  console.log("\n" + (failures ? failures + " scenario(s) FAILED" : "ALL SCENARIOS PASS on the patched server"));
  process.exit(failures ? 1 : 0);
}

function line(x, kind) {
  if (!x) return "  " + kind + ": (not run)";
  if (x.skipped) return "  " + kind + ": (no git baseline - skipped)";
  if (x.error) return "  " + kind + ": harness error - " + x.error;
  const r = x.register, d = x.dropdown, s = x.summary, sv = x.save, rp = x.report, hi = x.history;
  const rows = Array.isArray(r.json) ? r.json : null;
  return "  " + (kind === "BEFORE pack 108" ? "BEFORE (what the school runs today)" : "AFTER  (pack 108)") +
    "\n      GET  /attendance/class      -> " + r.status +
    (rows ? " | " + rows.length + " pupils [" + rows.map(function (p) { return p.student_id + "=" + (p.status || "no mark"); }).join(", ") + "]"
          : " | " + String(r.body).replace(/\s+/g, " ").slice(0, 130)) +
    (r.headers["x-ams-notice"] ? "\n      X-AMS-Notice            -> " + String(r.headers["x-ams-notice"]).slice(0, 170) : "") +
    "\n      GET  /api/distinct-classes  -> " + d.status + (Array.isArray(d.json) ? " | " + d.json.length + " class(es)" : "") +
    "\n      GET  /attendance/summary    -> " + s.status + (s.json && s.json.taken != null ? " | taken=" + s.json.taken + ", total=" + s.json.total : "") +
    "\n      GET  /attendance/report     -> " + rp.status + (Array.isArray(rp.json) ? " | " + rp.json.length + " row(s)" : "") +
    "\n      GET  /attendance/student    -> " + hi.status + (Array.isArray(hi.json) ? " | " + hi.json.length + " day(s)" : "") +
    "\n      GET  /attendance/class (junk date) -> " + x.badDate.status + ((x.badDate.json && x.badDate.json.message) ? " | " + String(x.badDate.json.message).slice(0, 60) : "") +
    "\n      POST /attendance/save       -> " + sv.status + " | " + ((sv.json && sv.json.message) || String(sv.body).slice(0, 90));
}

function report(name, scenario, r) {
  console.log("\n=== " + name + " ===\n    " + scenario.label);
  console.log(line(r.before, "BEFORE pack 108"));
  console.log(line(r.after, "AFTER"));
  const after = r.after;
  if (!after || after.error || !after.register) { console.log("    RESULT: FAIL (after-run: " + (after && after.error) + ")"); return 1; }
  const rows = Array.isArray(after.register.json) ? after.register.json : null;
  if (after.register.status !== 200) { console.log("    RESULT: FAIL - register still answers " + after.register.status); return 1; }
  if (!rows || rows.length !== scenario.expectRows) {
    console.log("    RESULT: FAIL - expected " + scenario.expectRows + " pupils in the register, got " + (rows ? rows.length : JSON.stringify(after.register.body).slice(0, 100)));
    return 1;
  }
  if (scenario.expectMarks) {
    for (const id in scenario.expectMarks) {
      const row = rows.find(function (x) { return String(x.student_id) === id; });
      const want = scenario.expectMarks[id];
      const got = row ? row.status : "MISSING";
      if ((got || null) !== want) {
        console.log("    RESULT: FAIL - " + id + " should read " + want + " but reads " + got);
        return 1;
      }
    }
  }
  if (scenario.expectNotice && !after.register.headers["x-ams-notice"]) {
    console.log("    RESULT: FAIL - the page got no explanation of the unreadable marks"); return 1;
  }
  if (scenario.expectSaveStatus && after.save.status !== scenario.expectSaveStatus) {
    console.log("    RESULT: FAIL - save should answer " + scenario.expectSaveStatus + " with a sentence, got " + after.save.status); return 1;
  }
  if (scenario.expectNoClassInInsert) {
    const ins = (after.sql || []).filter(function (l) { return l.indexOf("##INSERT_COLS##") !== -1; })[0] || "";
    if (/class_name/.test(ins)) { console.log("    RESULT: FAIL - the insert still writes a column the table does not have: " + ins); return 1; }
    if (!ins) { console.log("    RESULT: FAIL - no INSERT was executed at all"); return 1; }
  }
  if (after.badDate && after.badDate.status !== 400) {
    console.log("    RESULT: FAIL - a junk date should be refused with 400 + a sentence, got " + after.badDate.status); return 1;
  }
  if (after.dropdown.status !== 200) { console.log("    RESULT: FAIL - class dropdown answers " + after.dropdown.status); return 1; }
  if (after.summary.status !== 200) { console.log("    RESULT: FAIL - summary answers " + after.summary.status); return 1; }
  /* NEW (pack 109): the banner must still count THIS CLASS after its join to
     `students` was removed - a total of 0 here means the class was lost, and
     a whole-school total means it was widened. Both are asserted. */
  if (scenario.expectSummary) {
    const sm = after.summary.json || {};
    if (!!sm.taken !== !!scenario.expectSummary.taken || Number(sm.total) !== Number(scenario.expectSummary.total)) {
      console.log("    RESULT: FAIL - banner should read taken=" + scenario.expectSummary.taken +
        ", total=" + scenario.expectSummary.total + " for this class; got taken=" + sm.taken + ", total=" + sm.total);
      return 1;
    }
  }
  if (after.report.status !== 200) { console.log("    RESULT: FAIL - report answers " + after.report.status); return 1; }
  /* NEW (pack 109): the report is the endpoint the owner's "Load report"
     button calls, so assert its CONTENTS, not just its status code. A 200
     with one pupil missing was how this bug hid for so long. */
  if (scenario.expectReport) {
    const rp = Array.isArray(after.report.json) ? after.report.json : null;
    if (!rp) { console.log("    RESULT: FAIL - report did not return a list of pupils"); return 1; }
    if (rp.length !== scenario.expectReport.length) {
      console.log("    RESULT: FAIL - report should list " + scenario.expectReport.length +
        " pupil(s) with marks in the range, got " + rp.length + " [" +
        rp.map(function (x) { return x.student_id; }).join(", ") + "]");
      return 1;
    }
    for (const want of scenario.expectReport) {
      const got = rp.find(function (x) { return String(x.student_id) === want.id; });
      if (!got) { console.log("    RESULT: FAIL - report is missing " + want.id); return 1; }
      if (!got.full_name) { console.log("    RESULT: FAIL - report has no name for " + want.id); return 1; }
      for (const k of ["present", "absent", "late", "marked"]) {
        if (want[k] != null && Number(got[k]) !== want[k]) {
          console.log("    RESULT: FAIL - report " + want.id + "." + k + " should be " + want[k] + ", got " + got[k]);
          return 1;
        }
      }
    }
  }
  if (after.history.status !== 200) { console.log("    RESULT: FAIL - history answers " + after.history.status); return 1; }
  /* NEW (pack 109): the history is one pupil's own days, read without the
     LEFT JOIN - so it must be exactly that pupil's rows, still named. */
  if (scenario.expectHistoryDays != null) {
    const hi2 = Array.isArray(after.history.json) ? after.history.json : null;
    if (!hi2) { console.log("    RESULT: FAIL - history did not return a list"); return 1; }
    if (hi2.length !== scenario.expectHistoryDays) {
      console.log("    RESULT: FAIL - history should hold " + scenario.expectHistoryDays +
        " day(s) for A101, got " + hi2.length);
      return 1;
    }
    if (hi2.length && !hi2[0].full_name) {
      console.log("    RESULT: FAIL - history lost the pupil's name when the JOIN went"); return 1;
    }
    if (hi2.some(function (d) { return String(d.student_id) !== "A101"; })) {
      console.log("    RESULT: FAIL - history returned another pupil's days"); return 1;
    }
  }
  const beforeStatus = r.before && r.before.register ? r.before.register.status : "?";
  console.log("    RESULT: PASS (the same request was " + beforeStatus + " before, " + after.register.status +
    " with the class list now; " + rows.length + " pupils drawn, saved marks honoured)");
  return 0;
}

main();
