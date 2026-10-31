/* ==========================================================================
   test/search-result-null-class-test.js  (NEW - "Error fetching result" fix)

   Owner report: checking student results said "Error fetching result"
   while old results displayed. Client side is covered by
   test/check-result-search-test.js; THIS test boots the REAL server.js
   (same fake-MySQL harness style as test/report-attendance-test.js) and
   proves the two server halves of the fix:

     1. READ-HEAL: GET /search-result turns a stored NULL class_name
        (written by the spreadsheet import for a pupil whose students
        record has no class) into "" on the way out, so EVERY client -
        including a phone still running a cached older js/result.js
        that calls .includes() on it - reads a string and the result
        displays instead of "erroring" after a perfect fetch.
     2. WRITE-GUARD: POST /save-result with class_name:null stores ""
        (the results table's own default) through amsUpsertScoreResult,
        so no new NULL-class rows are created.

     node test/search-result-null-class-test.js
   ========================================================================== */
"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const PW = "test1234";

const SEEDED = [
  { id: 11, student_id: "AM101", student_name: "Bello Adebayo", class_name: null, term: "1st Term", session: "2026/2027", subject: "Mathematics", first_test: 8, second_test: 9, note_score: 7, attendance_score: 6, ca_score: 30, exam_score: 55, total: 85, grade: "A", created_at: "2026-10-20 09:00:00" },
  { id: 12, student_id: "AM101", student_name: "Bello Adebayo", class_name: "SS 1", term: "1st Term", session: "2026/2027", subject: "English", first_test: 7, second_test: 7, note_score: 6, attendance_score: 5, ca_score: 25, exam_score: 45, total: 70, grade: "B", created_at: "2026-10-20 09:00:00" }
];
const INSERTED = []; // params of every INSERT INTO results the fake sees

/* ============================= the child ==================================
   node test/search-result-null-class-test.js --serve <port>
   ========================================================================== */
if (process.argv[2] === "--serve") return serve();

function serve() {
  const port = Number(process.argv[3]);
  process.env.PORT = String(port);
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "harness-secret";
  process.env.DB_PASSWORD = "harness";
  process.env.ADMIN_DEFAULT_PASSWORD = PW;

  const trail = path.join(require("os").tmpdir(), "ams-nullclass-" + port + ".json");
  try { fs.unlinkSync(trail); } catch (e) {}
  const connection = makeConnection(trail);
  const dbPath = fs.realpathSync(path.join(REPO, "db.js"));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: connection };
  require(path.join(REPO, "server.js"));
  setTimeout(function () { console.log("READY " + port); }, 800);
}

/* --------------------------- fake MySQL layer ----------------------------- */
function makeConnection(trail) {
  const sessions = Object.create(null);
  const USER = { id: 1, username: "admin", password_hash: require("bcryptjs").hashSync(PW, 8), role: "admin" };
  const COLS = {
    users: ["id", "username", "password_hash", "role"],
    students: ["student_id", "full_name", "gender", "class_name", "status"],
    classes: ["id", "class_name"],
    attendance: ["id", "student_id", "class_name", "att_date", "status", "marked_by", "created_at"],
    results: ["id", "student_id", "student_name", "class_name", "term", "session", "subject", "first_test", "second_test", "note_score", "attendance_score", "ca_score", "exam_score", "total", "grade", "created_at"]
  };

  function recordInsert(params) {
    INSERTED.push(params.slice());
    try { fs.writeFileSync(trail, JSON.stringify(INSERTED)); } catch (e) {}
  }

  function run(sqlRaw, params) {
    const sql = String(sqlRaw).replace(/\s+/g, " ").trim();
    params = params == null ? [] : (Array.isArray(params) ? params : [params]);

    if (/FROM information_schema\.COLUMNS/i.test(sql)) {
      const m = /TABLE_NAME IN \(([^)]*)\)/i.exec(sql);
      if (m) {
        const rows = [];
        m[1].split(",").map(function (t) { return t.trim().replace(/'/g, "").toLowerCase(); }).forEach(function (t) {
          (COLS[t] || []).forEach(function (c) { rows.push({ t: t, c: c }); });
        });
        return { rows: rows };
      }
      const one = /TABLE_NAME = '([a-z_]+)'/i.exec(sql);
      if (one) return { rows: (COLS[one[1]] || []).map(function (c) { return { c: c }; }) };
      return { rows: [] };
    }
    if (/FROM information_schema\.STATISTICS/i.test(sql)) {
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

    if (/^SELECT \* FROM users/i.test(sql)) return { rows: params[0] === USER.username ? [USER] : [] };

    /* /search-result's read (and nothing else in this test selects *) */
    if (/^SELECT \* FROM results/i.test(sql)) {
      const sid = String(params[0]).trim().toLowerCase();
      const term = params.length > 2 ? String(params[2]).trim() : null;
      const session = params.length > 3 ? String(params[3]).trim() : null;
      return { rows: SEEDED.filter(function (r) {
        if (String(r.student_id).trim().toLowerCase() !== sid) return false;
        if (term && r.term !== term) return false;
        if (session && r.session !== session) return false;
        return true;
      }).map(function (r) { return Object.assign({}, r); }) };
    }
    /* amsUpsertScoreResult's "already saved?" probe -> force the INSERT arm */
    if (/^SELECT id, subject FROM results/i.test(sql)) return { rows: [] };
    if (/^INSERT INTO results/i.test(sql)) { recordInsert(params); return { rows: { insertId: 501, affectedRows: 1 } }; }
    if (/^UPDATE results/i.test(sql)) return { rows: { affectedRows: 1 } };
    if (/^DELETE FROM results/i.test(sql)) return { rows: { affectedRows: 0 } };
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

function boot(port) {
  return new Promise(function (resolve, reject) {
    const child = spawn(process.execPath, [path.join(REPO, "test", "search-result-null-class-test.js"), "--serve", String(port)], {
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

async function main() {
  const port = 3493;
  const trail = path.join(require("os").tmpdir(), "ams-nullclass-" + port + ".json");
  const child = await boot(port);
  try {
    const login = await request(port, "POST", "/login", { body: { username: "admin", password: PW } });
    if (login.status !== 200) throw new Error("harness login failed: " + login.status + " " + login.body.slice(0, 160));
    const cookie = (login.headers["set-cookie"] || []).map(function (c) { return c.split(";")[0]; }).join("; ");

    console.log("\n[read-heal: /search-result]");
    const anon = await request(port, "GET", "/search-result/AM101?term=" + encodeURIComponent("1st Term") + "&session=" + encodeURIComponent("2026/2027"));
    ok(anon.status === 403, "anonymous read still refused by the publish gate (got " + anon.status + ")");

    const r = await request(port, "GET",
      "/search-result/AM101?term=" + encodeURIComponent("1st Term") + "&session=" + encodeURIComponent("2026/2027"),
      { cookie: cookie });
    ok(r.status === 200 && Array.isArray(r.json), "staff read answers 200 with a JSON array (got " + r.status + ")");
    const rows = Array.isArray(r.json) ? r.json : [];
    ok(rows.length === 2, "both seeded subjects come back (rows: " + rows.length + ")");
    const math = rows.find(function (x) { return x.subject === "Mathematics"; }) || {};
    const eng = rows.find(function (x) { return x.subject === "English"; }) || {};
    ok(math.class_name === "", "the NULL-class row is healed to '' on read (got " + JSON.stringify(math.class_name) + ")");
    ok(eng.class_name === "SS 1", "a normal class_name is untouched (got " + JSON.stringify(eng.class_name) + ")");
    ok(Number(math.total) === 85 && math.student_name === "Bello Adebayo", "scores and names are untouched by the heal");

    console.log("\n[write-guard: /save-result]");
    const tok = await request(port, "GET", "/api/csrf-token", { cookie: cookie });
    const csrf = tok.json && tok.json.csrfToken;
    const save = await request(port, "POST", "/save-result", {
      cookie: cookie, csrf: csrf,
      body: {
        student_id: "AM101", student_name: "Bello Adebayo", class_name: null,
        term: "1st Term", session: "2026/2027", subject: "Quran",
        first_test: 9, second_test: 9, note_score: 8, attendance_score: 9,
        ca_score: 35, exam_score: 50, total_score: 85, grade: "A"
      }
    });
    ok(save.status === 200 && save.json && save.json.id === 501,
      "saving with class_name:null still succeeds (got " + save.status + " " + save.body.slice(0, 120) + ")");
    let inserted = [];
    try { inserted = JSON.parse(fs.readFileSync(trail, "utf8")); } catch (e) {}
    ok(inserted.length === 1, "exactly one INSERT reached the database (got " + inserted.length + ")");
    ok(inserted.length && inserted[0][2] === "",
      "the INSERT writes class_name '' instead of NULL (got " + JSON.stringify(inserted.length && inserted[0][2]) + ")");
    ok(inserted.length && inserted[0][5] === "Quran" && Number(inserted[0][12]) === 85,
      "the rest of the saved row is unchanged");
  } finally {
    child.kill("SIGKILL");
  }
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error("HARNESS ERROR:", (e && e.stack) || e);
  process.exit(1);
});
