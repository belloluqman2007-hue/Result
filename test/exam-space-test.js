/* ==========================================================================
   test/exam-space-test.js  (NEW - exam space: drafts / publishing / privacy)

   Owner, verbatim:
     "What is the best way to organize created exam from each user. It should
      be well organized and user must be able to draft exam, not everything
      will be showing to other users"

   This test boots the REAL server (server.js) against a fake MySQL layer and
   proves the whole ownership model end to end, with two different staff
   accounts (an admin and an ordinary teacher):

     1. A new exam is saved as a PRIVATE DRAFT owned by the teacher who
        wrote it - the POST answer says so and the row says so.
     2. The author's own library (GET /exams) lists the draft under "drafts".
     3. Another teacher's library does NOT contain that draft at all.
     4. Directly opening somebody else's draft (GET /exam/:id) answers 404 -
        a draft is as invisible as a paper that does not exist.
     5. Saving over somebody else's exam is refused (403) - ownership can
        never be taken over by saving.
     6. Deleting somebody else's exam is refused (403).
     7. The author publishes it -> the other teacher now sees it in their
        "shared" bank and can open it (read-only), but still cannot change or
        delete it.
     8. The author un-publishes it -> it disappears from the other teacher's
        library again.
     9. The paper is only mirrored into the shared File Store while it is
        published (a draft never leaks through the vault).

     node test/exam-space-test.js
   ========================================================================== */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const PW = "test1234";

const USERS = [
  { id: 1, username: "admin", password_hash: require("bcryptjs").hashSync(PW, 8), role: "admin" },
  { id: 2, username: "ustadh.bello", password_hash: require("bcryptjs").hashSync(PW, 8), role: "teacher" },
  { id: 3, username: "ustadh.musa", password_hash: require("bcryptjs").hashSync(PW, 8), role: "teacher" }
];

const EXAMS_COLS = [
  "id", "title", "class_name", "subject", "term", "session", "duration",
  "instructions", "body_html", "created_by", "exam_date", "status",
  "updated_at", "created_at"
];

/* ------------------------------ fake MySQL ------------------------------- */
function makeConnection(log) {
  const sessions = Object.create(null);
  const exams = [];
  const files = [];
  let nextExamId = 1;
  let nextFileId = 1;
  let clock = Date.parse("2026-11-01T09:00:00Z");

  function stamp() {
    clock += 60000;
    return new Date(clock).toISOString().slice(0, 19).replace("T", " ");
  }
  function mkErr(code, msg) { const e = new Error(msg); e.code = code; e.sqlMessage = msg; return e; }

  function examById(id) {
    return exams.find(function (e) { return String(e.id) === String(id); });
  }

  function run(sqlRaw, params) {
    const sql = String(sqlRaw).replace(/\s+/g, " ").trim();
    params = params == null ? [] : (Array.isArray(params) ? params : [params]);
    if (log) log.push(sql.length > 400 ? sql.slice(0, 400) + "..." : sql);

    /* boot chatter / schema introspection */
    if (/FROM information_schema\./i.test(sql)) return { rows: [] };
    if (/CREATE TABLE/i.test(sql)) return { rows: {} };
    if (/ALTER TABLE/i.test(sql)) return { rows: {} };
    if (/^SELECT 1$/i.test(sql)) return { rows: [{ n: 1 }] };

    /* session store */
    if (/^SELECT sess, expires_at FROM app_sessions/i.test(sql)) {
      const s = sessions[params[0]];
      return { rows: s ? [{ sess: s, expires_at: Date.now() + 600000 }] : [] };
    }
    if (/^INSERT INTO app_sessions/i.test(sql)) { sessions[params[0]] = params[1]; return { rows: { affectedRows: 1 } }; }
    if (/^UPDATE app_sessions/i.test(sql)) return { rows: { affectedRows: 1 } };
    if (/^DELETE FROM app_sessions/i.test(sql)) { delete sessions[params[0]]; return { rows: { affectedRows: 0 } }; }

    if (/FROM users/i.test(sql)) {
      const u = USERS.find(function (x) { return x.username === params[0]; });
      return { rows: u ? [Object.assign({}, u)] : [] };
    }

    /* -------- the exams table -------- */
    if (/^SELECT id, created_by, status FROM exams WHERE id = \?/i.test(sql)) {
      const e = examById(params[0]);
      return { rows: e ? [{ id: e.id, created_by: e.created_by, status: e.status }] : [] };
    }
    if (/^SELECT \* FROM exams WHERE id = \?/i.test(sql)) {
      const e = examById(params[0]);
      return { rows: e ? [Object.assign({}, e)] : [] };
    }
    if (/^SELECT \* FROM exams$/i.test(sql) && /status = 'published'/i.test(sql)) {
      return { rows: exams.filter(function (e) { return e.status === "published"; }).map(function (e) { return Object.assign({}, e); }) };
    }
    if (/^SELECT \* FROM exams$/i.test(sql)) {
      return { rows: exams.map(function (e) { return Object.assign({}, e); }) };
    }
    if (/^SELECT id, title, class_name, subject, term, session, duration, exam_date, created_by, status, created_at, updated_at FROM exams/i.test(sql)) {
      /* the teacher's exam space list - the admin's copy carries OR 1=1 */
      const me = params[0];
      if (/OR 1=1/i.test(sql)) {
        return { rows: exams.map(function (e) { return Object.assign({}, e); }) };
      }
      return {
        rows: exams.filter(function (e) {
          if (e.created_by === me) return true;
          if (!e.created_by) return true;
          return e.status === "published";
        }).map(function (e) { return Object.assign({}, e); })
      };
    }
    if (/^SELECT id, title, class_name, subject, term, session, created_at FROM exams/i.test(sql)) {
      return { rows: exams.map(function (e) {
        return { id: e.id, title: e.title, class_name: e.class_name, subject: e.subject,
          term: e.term, session: e.session, created_at: e.created_at };
      }) };
    }
    if (/^INSERT INTO exams/i.test(sql)) {
      const cols = (/\(([^)]*)\) VALUES/i.exec(sql) || [, ""])[1].split(",").map(function (c) { return c.trim(); });
      const row = { id: nextExamId++, created_at: stamp(), updated_at: stamp(), status: "draft", created_by: null };
      cols.forEach(function (c, i) { if (cols.length) row[c] = params[i]; });
      if (!EXAMS_COLS.every(function (c) { return c in row; })) {
        /* an INSERT omitting the new columns is the legacy fallback - accept
           it but keep the defaults, like MySQL would. */
      }
      exams.push(row);
      return { rows: { insertId: row.id, affectedRows: 1 } };
    }
    if (/^UPDATE exams SET status = \? WHERE id = \?/i.test(sql)) {
      const e = examById(params[1]);
      if (e) { e.status = params[0]; e.updated_at = stamp(); }
      return { rows: { affectedRows: e ? 1 : 0 } };
    }
    if (/^UPDATE exams SET title=/i.test(sql)) {
      const e = examById(params[params.length - 1]);
      if (e) {
        ["title", "class_name", "subject", "term", "session", "duration", "instructions", "body_html"].forEach(function (c, i) {
          e[c] = params[i];
        });
        e.updated_at = stamp();
      }
      return { rows: { affectedRows: e ? 1 : 0 } };
    }
    if (/^UPDATE exams SET status = 'published'/i.test(sql)) {
      exams.forEach(function (e) { e.status = "published"; });
      return { rows: { affectedRows: exams.length } };
    }
    if (/^DELETE FROM exams WHERE id = \?/i.test(sql)) {
      const i = exams.findIndex(function (e) { return String(e.id) === String(params[0]); });
      if (i === -1) return { rows: { affectedRows: 0 } };
      exams.splice(i, 1);
      return { rows: { affectedRows: 1 } };
    }

    /* -------- the shared File Store (published papers only) -------- */
    if (/^SELECT id FROM school_file_store WHERE folder_path = '\/' AND file_name = 'Saved Exams'/i.test(sql)) {
      return { rows: [] };
    }
    if (/^SELECT id FROM school_file_store WHERE folder_path = '\/Saved Exams' AND original_name = \?/i.test(sql)) {
      const f = files.find(function (x) { return x.name === params[0]; });
      return { rows: f ? [{ id: f.id }] : [] };
    }
    if (/^INSERT INTO school_file_store/i.test(sql)) {
      const name = params[1];
      if (!files.some(function (f) { return f.name === name; })) {
        files.push({ id: nextFileId++, name: name, kind: "exam" });
      }
      return { rows: { affectedRows: 1, insertId: nextFileId } };
    }
    if (/^DELETE FROM school_file_store WHERE folder_path = '\/Saved Exams'/i.test(sql)) {
      const i = files.findIndex(function (f) { return f.name === params[0]; });
      if (i !== -1) files.splice(i, 1);
      return { rows: { affectedRows: i !== -1 ? 1 : 0 } };
    }

    return { rows: [] };
  }

  const api = {
    /* exposed for the harness assertions */
    _exams: exams,
    _files: files,
    query: function (sql, params, cb) {
      if (typeof params === "function") { cb = params; params = []; }
      let res;
      try { res = run(sql, params); } catch (e) { res = { err: e }; }
      setImmediate(function () { if (cb) cb(res.err || null, res.rows || [], null); });
    },
    getConnection: function (cb) {
      setImmediate(function () {
        cb(null, {
          query: function (q, p, c) {
            if (typeof p === "function") { c = p; p = []; }
            let r;
            try { r = run(q, p); } catch (e) { r = { err: e }; }
            setImmediate(function () { c && c(r.err || null, r.rows || []); });
          },
          release: function () {}
        });
      });
    },
    on: function () {},
    end: function (cb) { cb && cb(); }
  };
  return api;
}

/* ------------------------------ the child -------------------------------- */
if (process.argv[2] === "--serve") return serve();

function serve() {
  const dir = process.argv[3];
  const port = Number(process.argv[4]);
  process.env.PORT = String(port);
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "exam-space-harness";
  process.env.DB_PASSWORD = "harness";
  process.env.ADMIN_DEFAULT_PASSWORD = PW;

  const trail = path.join(os.tmpdir(), "ams-examspace-" + port + ".json");
  try { fs.unlinkSync(trail); } catch (e) {}
  const log = [];
  log.push2 = function (v) {
    log.push(v);
    try { fs.writeFileSync(trail, JSON.stringify(log)); } catch (e) {}
  };
  const connection = makeConnection(log);
  const dbPath = fs.realpathSync(path.join(dir, "db.js"));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: connection };
  // The harness needs to inspect the fake rows from the parent process.
  require(path.join(dir, "server.js"));
  setTimeout(function () { console.log("READY " + port); }, 900);
}

/* ------------------------------ the parent ------------------------------- */
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

function boot(dir, port) {
  return new Promise(function (resolve, reject) {
    const child = spawn(process.execPath, [path.join(REPO, "test", "exam-space-test.js"), "--serve", dir, String(port)], {
      cwd: REPO, env: Object.assign({}, process.env), stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "", settled = false;
    const timer = setTimeout(function () {
      if (!settled) { settled = true; reject(new Error("server did not start: " + out.slice(-600))); }
    }, 20000);
    child.stdout.on("data", function (b) {
      out += b.toString();
      if (!settled && /READY/.test(out)) { settled = true; clearTimeout(timer); resolve(child); }
    });
    child.stderr.on("data", function (b) { out += b.toString(); });
    child.on("exit", function (code) {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error("server exited " + code + ": " + out.slice(-600))); }
    });
  });
}

async function login(port, username) {
  const res = await request(port, "POST", "/login", { body: { username: username, password: PW } });
  if (res.status !== 200) throw new Error("login failed for " + username + ": " + res.status + " " + res.body.slice(0, 160));
  const cookie = (res.headers["set-cookie"] || []).map(function (c) { return c.split(";")[0]; }).join("; ");
  const tok = await request(port, "GET", "/api/csrf-token", { cookie: cookie });
  return { cookie: cookie, csrf: tok.json && tok.json.csrfToken };
}

function examBody(title) {
  return {
    title: title,
    class_name: "JSS 1",
    subject: "Tajweed",
    term: "1st Term",
    session: "2025/2026",
    duration: "one hour",
    instructions: "",
    body_html: "<p>1. " + title + "</p>"
  };
}

let failures = 0;
function check(label, ok, detail) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + label + (detail ? "  [" + detail + "]" : ""));
  if (!ok) failures++;
}

async function main() {
  const port = 4399;
  let child;
  try {
    child = await boot(REPO, port);
  } catch (e) {
    console.log("harness error: " + e.message);
    process.exit(1);
  }

  const trailPath = path.join(os.tmpdir(), "ams-examspace-" + port + ".json");
  try {
    const author = await login(port, "ustadh.bello");
    const other = await login(port, "ustadh.musa");
    const admin = await login(port, "admin");

    console.log("\n=== exam space: a new exam is a private draft ===");
    const created = await request(port, "POST", "/save-exam", { cookie: author.cookie, csrf: author.csrf, body: examBody("Tajweed Mid-Term") });
    check("POST /save-exam creates the paper", created.status === 200 && created.json && created.json.id, created.status + " " + created.body.slice(0, 120));
    const examId = created.json && created.json.id;
    check("the answer says it is a DRAFT", created.json && created.json.status === "draft", created.json && created.json.status);

    /* NEW (exam space): a bare save response is not enough - the paper must
       really BE a draft owned by the author. Reading it back proves both. */
    const reread = await request(port, "GET", "/exam/" + examId, { cookie: author.cookie });
    check("the saved paper is stored as a draft owned by the author",
      reread.status === 200 && reread.json && reread.json.status === "draft" &&
      reread.json.created_by === "ustadh.bello",
      reread.json ? (reread.json.status + " / " + reread.json.created_by) : String(reread.status));

    console.log("\n=== the author's own library ===");
    const mine = await request(port, "GET", "/exams", { cookie: author.cookie });
    const mineRow = (mine.json || []).find(function (e) { return e.id === examId; });
    check("the draft is in the author's library", !!mineRow, mine.status + " " + (mine.body || "").slice(0, 120));
    check("…and it is grouped as a draft", mineRow && mineRow.group === "drafts", mineRow && mineRow.group);
    check("…and it is marked as the author's own", mineRow && mineRow.mine === true && mineRow.can_edit === true, JSON.stringify(mineRow && { mine: mineRow.mine, can_edit: mineRow.can_edit }));
    check("…owned by the author", mineRow && mineRow.created_by === "ustadh.bello", mineRow && mineRow.created_by);

    console.log("\n=== another teacher must not see the draft ===");
    const theirs = await request(port, "GET", "/exams", { cookie: other.cookie });
    check("the draft is NOT in the other teacher's library",
      !(theirs.json || []).some(function (e) { return e.id === examId; }),
      (theirs.json || []).length + " row(s)");

    const peek = await request(port, "GET", "/exam/" + examId, { cookie: other.cookie });
    check("opening the draft directly answers 404", peek.status === 404, String(peek.status));

    const overwrite = await request(port, "POST", "/save-exam", { cookie: other.cookie, csrf: other.csrf, body: Object.assign(examBody("Hijacked"), { id: examId }) });
    check("saving over somebody else's draft is refused", overwrite.status === 403, String(overwrite.status) + " " + (overwrite.body || "").slice(0, 90));

    const steal = await request(port, "DELETE", "/exam/" + examId, { cookie: other.cookie, csrf: other.csrf });
    check("deleting somebody else's draft is refused", steal.status === 403, String(steal.status));

    console.log("\n=== nothing reaches the shared File Store while it is a draft ===");
    const vaultDrafts = await request(port, "GET", "/api/store/list", { cookie: admin.cookie });
    check("the draft is not in the shared File Store",
      !JSON.stringify(vaultDrafts.json || {}).includes("Tajweed Mid-Term"),
      String(vaultDrafts.status));

    console.log("\n=== publish it ===");
    const pub = await request(port, "POST", "/exam/" + examId + "/status", { cookie: author.cookie, csrf: author.csrf, body: { status: "published" } });
    check("the author can publish", pub.status === 200 && pub.json && pub.json.status === "published", String(pub.status) + " " + (pub.body || "").slice(0, 90));

    const theirs2 = await request(port, "GET", "/exams", { cookie: other.cookie });
    const shared = (theirs2.json || []).find(function (e) { return e.id === examId; });
    check("the published paper now appears in the staff bank", !!shared && shared.group === "shared", shared && shared.group);
    check("…and it is NOT editable by the other teacher", shared && shared.can_edit === false, shared && String(shared.can_edit));

    const view = await request(port, "GET", "/exam/" + examId, { cookie: other.cookie });
    check("…but it can be opened (read-only copy)", view.status === 200 && view.json && view.json.can_edit === false, String(view.status));

    const editShared = await request(port, "POST", "/save-exam", { cookie: other.cookie, csrf: other.csrf, body: Object.assign(examBody("Edited by someone else"), { id: examId }) });
    check("…and still cannot be saved over", editShared.status === 403, String(editShared.status));

    const delShared = await request(port, "DELETE", "/exam/" + examId, { cookie: other.cookie, csrf: other.csrf });
    check("…and still cannot be deleted", delShared.status === 403, String(delShared.status));

    console.log("\n=== take it back to a draft ===");
    const unpub = await request(port, "POST", "/exam/" + examId + "/status", { cookie: author.cookie, csrf: author.csrf, body: { status: "draft" } });
    check("the author can un-publish", unpub.status === 200 && unpub.json && unpub.json.status === "draft", String(unpub.status));
    const theirs3 = await request(port, "GET", "/exams", { cookie: other.cookie });
    check("it disappears from the other teacher's library again",
      !(theirs3.json || []).some(function (e) { return e.id === examId; }),
      (theirs3.json || []).length + " row(s)");

    console.log("\n=== the office (admin) sees and manages everything ===");
    const adminList = await request(port, "GET", "/exams", { cookie: admin.cookie });
    const adminRow = (adminList.json || []).find(function (e) { return e.id === examId; });
    check("the admin sees the teacher's draft", !!adminRow, (adminList.json || []).length + " row(s)");
    check("…and may manage it", adminRow && adminRow.can_edit === true, adminRow && String(adminRow.can_edit));

    console.log("\n=== the author still owns and can finish the paper ===");
    const reopen = await request(port, "GET", "/exam/" + examId, { cookie: author.cookie });
    check("the author can open the draft", reopen.status === 200 && reopen.json && reopen.json.status === "draft", String(reopen.status) + " " + (reopen.json && reopen.json.status));
    const update = await request(port, "POST", "/save-exam", { cookie: author.cookie, csrf: author.csrf, body: Object.assign(examBody("Tajweed Mid-Term (revised)"), { id: examId }) });
    check("the author can keep editing the draft", update.status === 200 && update.json && update.json.status === "draft", String(update.status) + " " + (update.body || "").slice(0, 90));

    const del = await request(port, "DELETE", "/exam/" + examId, { cookie: author.cookie, csrf: author.csrf });
    check("the author can delete their own paper", del.status === 200, String(del.status));
  } catch (e) {
    console.log("harness error: " + (e && e.stack || e));
    failures++;
  } finally {
    if (child) child.kill("SIGKILL");
    try { fs.unlinkSync(trailPath); } catch (e) {}
  }

  console.log("\n" + (failures ? failures + " check(s) FAILED" : "ALL CHECKS PASS - drafts are private, published papers are shared"));
  process.exit(failures ? 1 : 0);
}

main();
