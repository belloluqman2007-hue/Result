/* ==========================================================================
   test/check-result-search-test.js  (NEW - "Error fetching result" fix)

   Owner report after the report-attendance pack: "If I try to check
   student results now it is saying error fetching result. But old
   result are displaying."

   "Error fetching result." is the alert in searchResult()'s .catch in
   js/result.js - it fires for ANY throw inside the fetch handler, and
   the previous student's sheet stays on screen ("old result are
   displaying"). This harness runs the REAL searchResult() against a
   DOM whose element set is parsed from the real student-result.html,
   in two variants:
     CURRENT - the shipped page (has #studentAttendance/#studentAbsentLate)
     STALE   - the pre-attendance-pack page a phone may still hold in
               its HTTP/service-worker cache (those two cells missing),
               while js/result.js itself arrives fresh (network-first)
   and with the row shapes the database can really hold (including a
   NULL/empty class_name on rows saved by paths that do not know the
   class). getElementById returns null for missing ids, exactly like
   a browser - that is what turns a stale page into the alert.

     node test/check-result-search-test.js
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(REPO, "student-result.html"), "utf8");
/* \b, not a literal space: id="studentPhoto" sits at a line start in the
   real page (wrapped <img> attributes) and must be picked up too. */
const PAGE_IDS = Array.from(HTML.matchAll(/\bid="([^"]+)"/g)).map(function (m) { return m[1]; });

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log("  ok   - " + label); }
  else { failed++; console.log("  FAIL - " + label); }
}

/* ------------------------------ fake DOM ------------------------------- */
function makeEl(id) {
  const el = {
    id: id || "", value: "", textContent: "", innerHTML: "", className: "",
    src: "", colSpan: 1, style: {},
    children: [],
    appendChild: function (c) { this.children.push(c); return c; },
    addEventListener: function () {},
    insertRow: function () { const r = makeEl(""); this.children.push(r); return r; },
    insertCell: function () { const c = makeEl(""); this.children.push(c); return c; }
  };
  return el;
}

function makeDocument(dropIds) {
  const registry = new Map();
  PAGE_IDS.forEach(function (id) {
    if ((dropIds || []).indexOf(id) !== -1) return; // stale page: element absent
    registry.set(id, makeEl(id));
  });
  return {
    registry: registry,
    getElementById: function (id) { return registry.has(id) ? registry.get(id) : null; },
    createElement: function () { return makeEl(""); }
  };
}

/* ------------------------------ fake server ----------------------------- */
const ROWS_OK = [
  { student_id: "AM101", student_name: "Bello Adebayo", class_name: "SS 1", term: "1st Term", session: "2026/2027", subject: "Mathematics", grade: "A", total: 85, exam_score: 55, ca_score: 30 },
  { student_id: "AM101", student_name: "Bello Adebayo", class_name: "SS 1", term: "1st Term", session: "2026/2027", subject: "English", grade: "B", total: 70, exam_score: 45, ca_score: 25 }
];
const ATT = { available: true, percentage: 94, attended: 58, school_days: 62, absent: 3, late: 1 };

function jsonResp(v) { return { ok: true, status: 200, json: function () { return Promise.resolve(v); } }; }

function makeFetch(searchResult) {
  return function (url) {
    const u = String(url);
    if (u.indexOf("/search-result/") === 0) return Promise.resolve(searchResult());
    if (u.indexOf("/student-position/") === 0) return Promise.resolve(jsonResp({ position: 3 }));
    if (u.indexOf("/report-attendance/") === 0) return Promise.resolve(jsonResp(ATT));
    if (u.indexOf("/student/") === 0) return Promise.resolve(jsonResp([]));
    if (u === "/signatures" || u === "/class-signatures" || u === "/classes") return Promise.resolve(jsonResp([]));
    if (u === "/me") return Promise.resolve(jsonResp({ loggedIn: true, role: "admin" }));
    return Promise.resolve(jsonResp([]));
  };
}

/* ------------------------------- runner --------------------------------- */
const unhandled = [];
process.on("unhandledRejection", function (e) { unhandled.push(String((e && e.message) || e)); });

function flush() { return new Promise(function (r) { setTimeout(r, 60); }); }

async function runSearch(opts) {
  unhandled.length = 0;
  const alerts = [];
  const logs = [];
  const documentStub = makeDocument(opts.stale ? ["studentAttendance", "studentAbsentLate"] : []);
  documentStub.registry.get("searchId").value = "AM101";
  documentStub.registry.get("searchTerm").value = opts.term || "1st Term";
  documentStub.registry.get("searchSession").value = "2026/2027";
  const sandbox = {
    console: {
      log: function (e) { logs.push(String((e && e.stack) || (e && e.message) || e)); },
      warn: function () {}, error: function () {}
    },
    setTimeout: setTimeout,
    fetch: makeFetch(opts.searchResult),
    document: documentStub,
    alert: function (m) { alerts.push(String(m)); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(REPO, "js", "result.js"), "utf8"), sandbox, { filename: "js/result.js" });
  await flush(); // load-time /me probe settles
  sandbox.searchResult();
  await flush(); await flush();
  const reg = documentStub.registry;
  return {
    alerts: alerts,
    logs: logs,
    unhandled: unhandled.slice(),
    table: reg.get("resultTable") ? reg.get("resultTable").innerHTML : "",
    nameCell: reg.get("studentName") ? reg.get("studentName").textContent : "",
    attendanceCell: reg.get("studentAttendance") ? reg.get("studentAttendance").textContent : null
  };
}

async function main() {
  const found = function () { return jsonResp(ROWS_OK); };
  const notFound = function () { return jsonResp([]); };
  const nullClass = function () {
    return jsonResp(ROWS_OK.map(function (r) { return Object.assign({}, r, { class_name: null }); }));
  };
  const emptyClass = function () {
    return jsonResp(ROWS_OK.map(function (r) { return Object.assign({}, r, { class_name: "" }); }));
  };

  console.log("\n[CURRENT page markup]");
  let r = await runSearch({ searchResult: found });
  ok(r.alerts.indexOf("Error fetching result.") === -1, "found result: no 'Error fetching result.' alert (alerts: " + JSON.stringify(r.alerts) + ")");
  ok(r.table.indexOf("Mathematics") !== -1, "found result: score rows are drawn");
  ok(r.attendanceCell === "94% (58 of 62 days)", "found result: attendance cell filled ('" + r.attendanceCell + "')");

  r = await runSearch({ searchResult: notFound });
  ok(r.alerts.indexOf("Error fetching result.") === -1, "no result: no error alert (alerts: " + JSON.stringify(r.alerts) + ", error: " + String((r.logs && r.logs[0]) || "").split("\n").slice(0, 4).join(" | ") + ")");
  ok(r.attendanceCell === "-", "no result: attendance cell reset to '-'");

  r = await runSearch({ searchResult: nullClass });
  ok(r.alerts.indexOf("Error fetching result.") === -1, "rows with NULL class_name: no error alert (alerts: " + JSON.stringify(r.alerts) + ", error: " + String(r.logs[0] || "").split("\n")[0] + ")");
  ok(r.table.indexOf("Mathematics") !== -1, "rows with NULL class_name: scores still drawn");

  r = await runSearch({ searchResult: emptyClass });
  ok(r.alerts.indexOf("Error fetching result.") === -1, "rows with empty class_name: no error alert");

  console.log("\n[STALE page markup - phone cache without the attendance cells]");
  r = await runSearch({ searchResult: notFound, stale: true });
  ok(r.alerts.indexOf("Error fetching result.") === -1,
    "stale page + no result: no error alert, sheet resets cleanly (alerts: " + JSON.stringify(r.alerts) + ")");

  r = await runSearch({ searchResult: found, stale: true });
  ok(r.alerts.indexOf("Error fetching result.") === -1, "stale page + found result: no error alert");
  ok(r.table.indexOf("Mathematics") !== -1, "stale page + found result: scores still drawn");
  ok(r.unhandled.length === 0, "stale page + found result: no unhandled promise rejections (" + JSON.stringify(r.unhandled) + ")");

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error("HARNESS ERROR:", (e && e.stack) || e);
  process.exit(1);
});
