/* ==========================================================================
   test/report-attendance-test.js  (NEW - report-sheet attendance)

   Verifies GET /report-attendance/:studentId - the figures that now
   print on the report sheet - against the REAL express app in server.js,
   with the same fake-MySQL harness style as test/attendance-500-test.js:
     * ask for a table the scenario does not have  -> ER_NO_SUCH_TABLE
     * ask for a column the scenario does not have -> ER_BAD_FIELD_ERROR
   so a route that forgets the legacy-schema guards fails here, not in
   production.

   Data story (session 2025/2026, standard Nigerian term windows):
     1st Term = 2025-09-01..2025-12-31, 2nd = 2026-01-01..2026-04-30,
     3rd = 2026-05-01..2026-08-31.
   Class "SS 1" register days (via AM102, present every day):
     1st: Sep 15,16,17,18, Dec 10, Dec 31  -> school opened 6
     2nd: Jan 12, Apr 30                   -> school opened 2
     3rd: May 4, May 5, Aug 31             -> school opened 3
   AM101: 1st = present x3 (15,16,31), late (17), absent (Dec 10),
          NOT marked Sep 18 -> attended 4 of 6 = 67%
          2nd = present, absent -> 1 of 2 = 50%
          3rd = present x3 -> 100%
   Plus out-of-window traps: 2025-08-29 (belongs to 2024/2025 3rd Term),
   2026-09-14 (belongs to 2026/2027 1st Term) and a JSS 3 mark on
   2025-10-01 that must not inflate SS 1's "school opened" - except in
   the legacy scenario (no class_name column), where school-wide days
   are the only honest answer and it DOES count (4 of 7 = 57%).

     node test/report-attendance-test.js
   ========================================================================== */
"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const PW = "test1234";
const CLASS = "SS 1";

function marksFor(scenario) {
  const cls = scenario.sloppyClass ? "SS  1" : CLASS; // double space, as typed by hand
  const M = [];
  const add = (id, date, status, c) => M.push({ student_id: id, class_name: c || cls, att_date: date, status: status });
  // AM102 carries the register: present every SS 1 school day.
  ["2025-09-15", "2025-09-16", "2025-09-17", "2025-09-18", "2025-12-10", "2025-12-31",
   "2026-01-12", "2026-04-30", "2026-05-04", "2026-05-05", "2026-08-31",
   "2025-08-29", "2026-09-14"].forEach(function (d) { add("AM102", d, "present"); });
  // AM101 - the pupil on the report.
  add("AM101", "2025-09-15", "present");
  add("AM101", "2025-09-16", "present");
  add("AM101", "2025-09-17", "late");
  add("AM101", "2025-12-10", "absent");
  add("AM101", "2025-12-31", "present"); // last day of the 1st-Term window
  add("AM101", "2026-01-12", "present");
  add("AM101", "2026-04-30", "absent");  // last day of the 2nd-Term window
  add("AM101", "2026-05-04", "present");
  add("AM101", "2026-05-05", "present");
  add("AM101", "2026-08-31", "present"); // last day of the 3rd-Term window
  add("AM101", "2025-08-29", "absent");  // previous session (2024/2025 3rd Term)
  add("AM101", "2026-09-14", "present"); // next session (2026/2027 1st Term)
  // Another class entirely - must not count as an SS 1 school day.
  add("BJ201", "2025-10-01", "present", "JSS 3");
  return M;
}

const FULL_ATT = ["id", "student_id", "class_name", "att_date", "status", "marked_by", "created_at"];
const BASE_COLS = {
  users: ["id", "username", "password_hash", "role"],
  students: ["student_id", "full_name", "gender", "class_name", "status"],
  classes: ["id", "class_name"]
};
const SCENARIOS = {
  ok: { label: "healthy database", cols: Object.assign({}, BASE_COLS, { attendance: FULL_ATT }) },
  sloppy: { label: "attendance stored under a double-spaced class name", cols: Object.assign({}, BASE_COLS, { attendance: FULL_ATT }), sloppyClass: true },
  legacy: { label: "pre-pack-13 attendance table (no class_name)", cols: Object.assign({}, BASE_COLS, { attendance: ["id", "student_id", "att_date", "status"] }) },
  none: { label: "attendance table missing entirely", cols: Object.assign({}, BASE_COLS, { attendance: null }) }
};

/* ============================= the child ==================================
   node test/report-attendance-test.js --serve <port> <scenario>
   ========================================================================== */
if (process.argv[2] === "--serve") return serve();

function serve() {
  const port = Number(process.argv[3]);
  const scenario = SCENARIOS[process.argv[4]];
  process.env.PORT = String(port);
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "harness-secret";
  process.env.DB_PASSWORD = "harness";
  process.env.ADMIN_DEFAULT_PASSWORD = PW;

  const connection = makeConnection(scenario);
  // Serve the fake db.js to whatever server.js requires ("./db").
  const dbPath = fs.realpathSync(path.join(REPO, "db.js"));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: connection };
  require(path.join(REPO, "server.js"));
  setTimeout(function () { console.log("READY " + port); }, 800);
}

/* --------------------------- fake MySQL layer ----------------------------- */
function makeConnection(scenario) {
  const sessions = Object.create(null);
  const MARKS = marksFor(scenario);
  const USER = { id: 1, username: "admin", password_hash: require("bcryptjs").hashSync(PW, 8), role: "admin" };

  function colsOf(t) { return scenario.cols[t] ? new Set(scenario.cols[t]) : null; }
  function mkErr(code, sqlMessage) { const e = new Error(sqlMessage); e.code = code; e.sqlMessage = sqlMessage; return e; }

  function run(sqlRaw, params) {
    const sql = String(sqlRaw).replace(/\s+/g, " ").trim();
    params = params == null ? [] : (Array.isArray(params) ? params : [params]);

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
      return { rows: [{ i: "uniq_student_day", cols: "student_id,att_date", non_unique: 0, nu: 0 }] };
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

    /* MySQL-grade schema policing for the attendance table: the route
       must never touch a missing table or a column it does not have. */
    if (/\battendance\b/i.test(sql)) {
      if (!colsOf("attendance")) return { err: mkErr("ER_NO_SUCH_TABLE", "Table 'school.attendance' doesn't exist") };
      if (/\bclass_name\b/i.test(sql) && !colsOf("attendance").has("class_name")) {
        return { err: mkErr("ER_BAD_FIELD_ERROR", "Unknown column 'class_name' in 'field list'") };
      }
    }

    /* --- data -------------------------------------------------------- */
    if (/^SELECT \* FROM users/i.test(sql)) return { rows: params[0] === USER.username ? [USER] : [] };

    const inRange = function (r, lo, hi) { return r.att_date >= lo && r.att_date <= hi; };

    /* the pupil's own marks in the window (tolerant id match) */
    if (/^SELECT status FROM attendance/i.test(sql) && /BETWEEN \? AND \?/i.test(sql)) {
      const sid = String(params[0]).trim().toLowerCase();
      return { rows: MARKS.filter(function (r) {
        return String(r.student_id).trim().toLowerCase() === sid && inRange(r, String(params[2]), String(params[3]));
      }).map(function (r) { return { status: r.status }; }) };
    }
    /* days school opened for ONE class (exact trimmed match, like MySQL) */
    if (/COUNT\(DISTINCT att_date\)/i.test(sql) && /TRIM\(class_name\) = TRIM\(\?\)/i.test(sql)) {
      const want = String(params[2]).trim();
      const set = new Set();
      MARKS.forEach(function (r) {
        if (inRange(r, String(params[0]), String(params[1])) && String(r.class_name).trim() === want) set.add(r.att_date);
      });
      return { rows: [{ days: set.size }] };
    }
    /* folded fallback feed: distinct (date, class) pairs */
    if (/^SELECT DISTINCT att_date, class_name FROM attendance/i.test(sql)) {
      const seen = new Set(); const out = [];
      MARKS.forEach(function (r) {
        if (!inRange(r, String(params[0]), String(params[1]))) return;
        const k = r.att_date + "|" + r.class_name;
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ att_date: r.att_date, class_name: r.class_name });
      });
      return { rows: out };
    }
    /* school-wide register days (legacy table without class_name) */
    if (/COUNT\(DISTINCT att_date\)/i.test(sql)) {
      const set = new Set();
      MARKS.forEach(function (r) { if (inRange(r, String(params[0]), String(params[1]))) set.add(r.att_date); });
      return { rows: [{ days: set.size }] };
    }
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

/* ============================== the parent ================================ */
function request(port, method, urlPath, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    const body = opts.body == null ? null : JSON.stringify(opts.body);
    const req = http.request({
      host: "127.0.0.1", port: port, path: urlPath, method: method,
      headers: Object.assign({ "Content-Type": "application/json" },
        opts.cookie ? { Cookie: opts.cookie } : {},
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

function boot(port, scenario) {
  return new Promise(function (resolve, reject) {
    const child = spawn(process.execPath, [path.join(REPO, "test", "report-attendance-test.js"), "--serve", String(port), scenario], {
      cwd: REPO, env: Object.assign({}, process.env), stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "", settled = false;
    const timer = setTimeout(function () { if (!settled) { settled = true; reject(new Error("server did not start: " + out.slice(-500))); } }, 20000);
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

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log("  ok   - " + label); }
  else { failed++; console.log("  FAIL - " + label); }
}

async function runScenario(name, port) {
  const sc = SCENARIOS[name];
  console.log("\n[" + name + "] " + sc.label);
  const child = await boot(port, name);
  try {
    const login = await request(port, "POST", "/login", { body: { username: "admin", password: PW } });
    if (login.status !== 200) throw new Error("harness login failed: " + login.status + " " + login.body.slice(0, 160));
    const cookie = (login.headers["set-cookie"] || []).map(function (c) { return c.split(";")[0]; }).join("; ");
    const get = function (id, term, session, cls, useCookie) {
      const qs = "?term=" + encodeURIComponent(term) + "&session=" + encodeURIComponent(session) +
        (cls == null ? "" : "&className=" + encodeURIComponent(cls));
      return request(port, "GET", "/report-attendance/" + encodeURIComponent(id) + qs,
        useCookie === false ? {} : { cookie: cookie });
    };

    /* The publish gate: anonymous visitors get nothing. */
    const anon = await get("AM101", "1st Term", "2025/2026", CLASS, false);
    ok(anon.status === 403, "anonymous request is refused by the publish gate (got " + anon.status + ")");

    if (name === "none") {
      const r = await get("AM101", "1st Term", "2025/2026", CLASS);
      ok(r.status === 200 && r.json && r.json.available === false,
        "missing attendance table -> 200 {available:false}, report prints '-' (got " + r.status + " " + JSON.stringify(r.json) + ")");
      return;
    }

    const t1 = await get("AM101", "1st Term", "2025/2026", CLASS);
    ok(t1.status === 200 && t1.json && t1.json.available === true, "1st Term answers available:true (got " + t1.status + ")");
    const a = t1.json || {};
    ok(a.present === 3 && a.late === 1 && a.absent === 1 && a.marked === 5,
      "1st Term counts present/late/absent = 3/1/1 (got " + a.present + "/" + a.late + "/" + a.absent + ")");
    if (name === "legacy") {
      ok(a.school_days === 7 && a.attended === 4 && a.percentage === 57,
        "legacy table: school-wide opened days 7 -> 4/7 = 57% (got " + a.attended + "/" + a.school_days + " = " + a.percentage + "%)");
    } else {
      ok(a.school_days === 6 && a.attended === 4 && a.percentage === 67,
        "1st Term: attended 4 of 6 school days = 67% (got " + a.attended + "/" + a.school_days + " = " + a.percentage + "%)");
    }
    ok(a.from === "2025-09-01" && a.to === "2025-12-31", "1st Term window is 2025-09-01..2025-12-31 (got " + a.from + ".." + a.to + ")");

    const t2 = (await get("AM101", "2nd Term", "2025/2026", CLASS)).json || {};
    ok(t2.present === 1 && t2.absent === 1 && t2.school_days === 2 && t2.percentage === 50,
      "2nd Term: 1 of 2 = 50%, Dec-31 mark stayed in 1st Term (got " + t2.attended + "/" + t2.school_days + " = " + t2.percentage + "%)");

    const t3 = (await get("AM101", "3rd Term", "2025/2026", CLASS)).json || {};
    ok(t3.present === 3 && t3.school_days === 3 && t3.percentage === 100,
      "3rd Term: 3 of 3 = 100%, next-session September mark excluded (got " + t3.attended + "/" + t3.school_days + " = " + t3.percentage + "%)");

    const prev = (await get("AM101", "3rd Term", "2024/2025", CLASS)).json || {};
    ok(prev.available === true && prev.absent === 1 && prev.percentage === 0,
      "previous session's 3rd Term owns the 2025-08-29 absence (0%) (got " + JSON.stringify(prev) + ")");

    const next = (await get("AM101", "1st Term", "2026/2027", CLASS)).json || {};
    ok(next.available === true && next.present === 1 && next.percentage === 100,
      "next session's 1st Term owns the 2026-09-14 mark (got " + JSON.stringify(next) + ")");

    const nobody = (await get("AM999", "1st Term", "2025/2026", CLASS)).json || {};
    ok(nobody.available === false, "a pupil with no register marks reads as no-record, not 0%");

    const odd = (await get("AM101", "1st Term", "2025-2026", CLASS)).json || {};
    ok(odd.available === false, "a session that is not YYYY/YYYY yields no window -> no-record");

    const noCls = (await get("AM101", "1st Term", "2025/2026", null)).json || {};
    if (name !== "legacy") {
      ok(noCls.school_days === 5 && noCls.percentage === 80,
        "without className, opened falls back to the pupil's marked days: 4/5 = 80% (got " + noCls.attended + "/" + noCls.school_days + " = " + noCls.percentage + "%)");
    }
  } finally {
    child.kill("SIGKILL");
  }
}

(async function main() {
  const names = Object.keys(SCENARIOS);
  for (let i = 0; i < names.length; i++) {
    await runScenario(names[i], 3411 + i * 17);
  }
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.error("HARNESS ERROR:", e && e.message || e);
  process.exit(1);
});
