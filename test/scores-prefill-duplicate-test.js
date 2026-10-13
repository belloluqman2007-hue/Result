/* ==========================================================================
   test/scores-prefill-duplicate-test.js  (NEW - pack 112)

   Owner, verbatim:
     "If student is picking in both batch entry and single student score it
      must automatically display scores that as been input before not just
      empty space and to avoid duplicate. Fix and merge now"

   Two halves, both against the REAL files:

   A. BROWSER (scores.html -> js/app.js, js/scores-batch.js) in a VM with a
      fake DOM + fake fetch.
        * picking a student from the Quick-Pick list must put the score that
          was saved before back on the form (First Test ... Exam, CA, Total,
          Grade) and open that row for editing - not leave empty boxes;
        * the "Student Scores" table must list the saved rows (one per
          term/session/subject, newest wins) and the "load results" box must
          follow the pick;
        * pressing Save Score after that pre-fill must send
          PUT /update-result/<id> - NOT another POST /save-result - and the
          table must still hold exactly ONE row for that student (the old code
          could only insert, which is where the duplicates came from);
        * a pick with nothing saved stays a new entry (POST /save-result);
        * changing the term/subject after the pick re-reads the saved score,
          so the right rows appear again without pressing anything;
        * batch entry opens with the remembered class ALREADY filled with the
          previously entered scores, and changing a pick reloads the grid by
          itself instead of leaving the old/empty grid on screen.

   B. SERVER (the real server.js booted with a fake MySQL layer):
        * POST /save-result the first time inserts;
        * POST /save-result again for the same student/term/session/subject
          UPDATES that row (the SQL trail proves it) and merges older copies;
        * GET /search-result lists one row per term/session/subject (newest);
        * the pack-112 boot step deletes only EXACT duplicate rows.

   node test/scores-prefill-duplicate-test.js
   ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  ok   - " + label); }
  else { fail++; console.log("  FAIL - " + label + (extra ? "   [" + extra + "]" : "")); }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ==========================================================================
   A. fake DOM strong enough for the real js/app.js
   ========================================================================== */
function makeEl(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    id: "", className: "", title: "", type: "", value: "", textContent: "", disabled: false,
    children: [], listeners: {}, _html: "", _text: "", parentNode: null,
    style: {
      _props: {},
      setProperty: function (k, v) { this._props[k] = v; this[k] = v; },
      getPropertyValue: function (k) { return this._props[k] || ""; }
    },
    dataset: {},
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    getBoundingClientRect: function () { return { height: 0, bottom: 0, top: 0, width: 0, left: 0, right: 0 }; },
    addEventListener: function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    removeEventListener: function () {},
    dispatch: function (ev, arg) { (this.listeners[ev] || []).slice().forEach(function (f) { f(arg); }); },
    appendChild: function (c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore: function (c) { c.parentNode = this; this.children.unshift(c); return c; },
    insertCell: function () { const c = makeEl("td"); c.children.push({ innerHTML: "" }); this.cells.push(c); return c; },
    cells: [],
    setAttribute: function () {}, removeAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    closest: function () { return null; }, focus: function () { if (this.__doc) this.__doc.activeElement = this; },
    select: function () {}, blur: function () {}, remove: function () {}, scrollIntoView: function () {}
  };
  return el;
}

/* A <select> that behaves like the browser about values + option lists. */
function makeSelect(id) {
  const el = makeEl("select");
  el.id = id;
  el.options = [];
  el._value = "";
  Object.defineProperty(el, "value", {
    get: function () { return this._value; },
    set: function (v) {
      v = v == null ? "" : String(v);
      this._value = this.options.some(function (o) { return o.value === v; }) ? v : "";
    }
  });
  Object.defineProperty(el, "innerHTML", {
    get: function () { return this._html; },
    set: function (v) {
      this._html = String(v);
      this.options = [];
      const re = /<option([^>]*)>([\s\S]*?)<\/option>/g;
      let m;
      while ((m = re.exec(this._html))) {
        const vm2 = /value\s*=\s*"([^"]*)"/.exec(m[1]);
        const text = String(m[2]).replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
        this.options.push({ value: vm2 ? String(vm2[1]).replace(/&amp;/g, "&") : text, text: text, disabled: /\bdisabled\b/.test(m[1]) });
      }
      this._value = this.options.length ? this.options[0].value : "";
    }
  });
  return el;
}

/* A table whose rows can be found by data-id, exactly like the real page
   (loadExistingResults / saveScore look rows up that way). */
function makeTable(id) {
  const t = makeEl("table");
  t.id = id;
  t.rows = [];
  t.insertRow = function () {
    const tr = makeEl("tr");
    tr.cells = [];
    tr.insertCell = function (i) {
      const td = makeEl("td");
      td.cellIndex = i;
      this.cells[i] = td;
      return td;
    };
    t.rows.push(tr);
    return tr;
  };
  t.querySelector = function (sel) {
    const m = /tr\[data-id="([^"]*)"\]/.exec(String(sel));
    if (!m) return null;
    return t.rows.find(function (r) { return String(r.dataset.id) === m[1]; }) || null;
  };
  return t;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: function () { return Promise.resolve(body); },
    text: function () { return Promise.resolve(JSON.stringify(body)); },
    headers: { get: function () { return null; } }
  };
}

function makeSandbox(opts) {
  opts = opts || {};
  const byId = {};
  Object.keys(opts.els || {}).forEach(function (id) { byId[id] = opts.els[id]; });

  const docListeners = {};
  const html = makeEl("html");
  const body = makeEl("body");
  const host = makeEl("form");           // stands in for the .form-group wrapper
  const doc = {
    readyState: "complete",
    activeElement: null,
    documentElement: html,
    body: body,
    head: makeEl("head"),
    getElementById: function (id) {
      if (byId[id]) return byId[id];
      return doc.created.find(function (e) { return e.id === id; }) || null;
    },
    createElement: function (tag) { const e = makeEl(tag); e.__doc = doc; doc.created.push(e); return e; },
    created: [],
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function (ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    removeEventListener: function () {},
    _fire: function (ev) { (docListeners[ev] || []).slice().forEach(function (f) { f(); }); }
  };
  Object.keys(byId).forEach(function (id) {
    byId[id].__doc = doc;
    if (byId[id].tagName === "INPUT") { byId[id].parentNode = host; host.children.push(byId[id]); }
  });

  const win = {
    innerHeight: 800,
    document: doc,
    location: { href: "scores.html", pathname: "/scores.html", search: "" },
    getComputedStyle: function () { return { display: "block", position: "static", visibility: "visible" }; },
    addEventListener: function () {},
    removeEventListener: function () {}
  };

  const storage = {};
  const store = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem: function (k, v) { storage[k] = String(v); },
    removeItem: function (k) { delete storage[k]; }
  };

  const ctx = vm.createContext({
    console: { log: function () {}, warn: function () {}, error: function () {} },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: function () { return 0; }, clearInterval: function () {},
    document: doc, window: win, localStorage: store, sessionStorage: store,
    alert: function (m) { ctx.__alerts.push(String(m)); },
    confirm: function () { return false; },
    prompt: function () { return null; },
    fetch: opts.fetch,
    __alerts: []
  });
  ctx.location = win.location;
  ctx.globalThis = ctx;
  return { ctx: ctx, doc: doc, win: win, host: host, byId: byId, fire: doc._fire };
}

function runFile(ctx, rel) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, { filename: rel });
}

/* js/app.js publishes the picker on `window` (the browser global); in this
   sandbox window is a separate object from the context, so look in both. */
function callGlobal(sb, name) {
  const fn = (sb.ctx && typeof sb.ctx[name] === "function") ? sb.ctx[name] : sb.win[name];
  if (typeof fn !== "function") throw new Error(name + " is not available");
  return fn.apply(sb.ctx, Array.prototype.slice.call(arguments, 2));
}

/* ------------------------- the scores page fixture ------------------------ */
const SAVED_ROWS = [
  {
    id: 12, student_id: "AM/24/001", student_name: "Aisha Bello", class_name: "SS 1",
    term: "1st Term", session: "2025/2026", subject: "Mathematics",
    first_test: "8.00", second_test: "7.00", note_score: "6.00", attendance_score: "9.00",
    ca_score: "30.00", exam_score: "45.00", total: "75.00", grade: "A"
  },
  {
    id: 15, student_id: "AM/24/001", student_name: "Aisha Bello", class_name: "SS 1",
    term: "1st Term", session: "2025/2026", subject: "English",
    first_test: "5.00", second_test: "5.00", note_score: "5.00", attendance_score: "5.00",
    ca_score: "20.00", exam_score: "30.00", total: "50.00", grade: "C"
  }
];

function scoresPageSandbox(rows, options) {
  options = options || {};
  const els = {
    studentSelectDropdown: makeSelect("studentSelectDropdown"),
    studentId: makeEl("input"),
    studentName: makeEl("input"),
    studentClass: makeSelect("studentClass"),
    term: makeSelect("term"),
    session: makeSelect("session"),
    subject: makeSelect("subject"),
    firstTest: makeEl("input"),
    secondTest: makeEl("input"),
    noteScore: makeEl("input"),
    attendanceScore: makeEl("input"),
    examScore: makeEl("input"),
    caScore: makeEl("input"),
    totalScore: makeEl("input"),
    grade: makeEl("input"),
    saveScoreBtn: makeEl("button"),
    cancelEditBtn: makeEl("button"),
    loadStudentId: makeEl("input"),
    scoreTable: makeTable("scoreTable"),
    studentQuickCard: makeEl("div")
  };
  els.studentClass.innerHTML = '<option value="" disabled selected>Select Class</option><option value="SS 1">SS 1</option>';
  els.term.innerHTML = '<option value="" disabled selected>Select Term</option><option>1st Term</option><option>2nd Term</option><option>3rd Term</option>';
  els.term.value = "";
  els.session.innerHTML = '<option value="" disabled selected>Select Session</option><option>2025/2026</option>';
  els.session.value = "";
  els.subject.innerHTML = '<option value="" disabled selected>Select Subject</option>';
  els.subject.value = "";

  const calls = [];
  const sb = makeSandbox({
    els: els,
    fetch: function (url, init) {
      url = String(url);
      const method = (init && init.method) || "GET";
      calls.push(method + " " + url.split("?")[0] + (url.indexOf("?") > -1 ? "?…" : ""));
      if (url.indexOf("/students") === 0) {
        return Promise.resolve(jsonResponse(200, [
          { student_id: "AM/24/001", full_name: "Aisha Bello", class_name: "SS 1" },
          { student_id: "AM/24/002", full_name: "Bilal Yusuf", class_name: "SS 1" }
        ]));
      }
      if (url.indexOf("/student/") === 0) {
        return Promise.resolve(jsonResponse(200, [{ student_id: "AM/24/001", full_name: "Aisha Bello", class_name: "SS 1" }]));
      }
      if (url.indexOf("/subjects") === 0) {
        return Promise.resolve(jsonResponse(200, [{ subject_name: "Mathematics" }, { subject_name: "English" }]));
      }
      if (url.indexOf("/search-result/") === 0) {
        const asked = decodeURIComponent(url.split("/search-result/")[1].split("?")[0]);
        const all = rows == null ? SAVED_ROWS : rows;
        return Promise.resolve(jsonResponse(200, all.filter(function (r) { return String(r.student_id) === asked; })));
      }
      if (url.indexOf("/update-result/") === 0) {
        const id = Number(url.split("/update-result/")[1]);
        return Promise.resolve(jsonResponse(200, { message: "Score updated", id: id, updated: true, merged: 0 }));
      }
      if (url.indexOf("/save-result") === 0) {
        return Promise.resolve(jsonResponse(200, { message: "Result saved successfully", id: 999, updated: false, merged: 0 }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    }
  });
  sb.calls = calls;
  return sb;
}

async function prefillBrowserTests() {
  console.log("\njs/app.js - picking a student shows the score entered before");

  const sb = scoresPageSandbox();
  runFile(sb.ctx, "js/app.js");
  sb.fire("DOMContentLoaded");
  await sleep(40);

  // The teacher picks a student from the Quick-Pick list.
  sb.byId.studentSelectDropdown.value = "AM/24/001";
  callGlobal(sb, "pickStudentFromDropdown", "AM/24/001");
  await sleep(120);

  const els = sb.byId;
  ok(els.studentId.value === "AM/24/001", "the pick fills the Student ID box");
  ok(els.firstTest.value === "5" && els.secondTest.value === "5" &&
    els.noteScore.value === "5" && els.attendanceScore.value === "5" && els.examScore.value === "30",
    "a SAVED score is back on the form instead of empty boxes (newest entry wins when nothing else is picked)",
    [els.firstTest.value, els.secondTest.value, els.noteScore.value, els.attendanceScore.value, els.examScore.value].join("/"));
  ok(String(els.caScore.value) === "20" && String(els.totalScore.value) === "50" && String(els.grade.value) === "C",
    "CA / Total / Grade are recomputed from the loaded marks (" + els.caScore.value + " / " + els.totalScore.value + " / " + els.grade.value + ")");
  ok(els.saveScoreBtn.textContent === "Update Score", "the form is open for EDITING that row (" + els.saveScoreBtn.textContent + ")");
  ok(els.cancelEditBtn.style.display === "inline-block", "Cancel Edit is offered");
  ok(els.loadStudentId.value === "AM/24/001", "the 'load their results' box follows the pick");
  ok(els.scoreTable.rows.length === 2, "every saved row for the student is listed once (rows: " + els.scoreTable.rows.length + ")");
  ok(sb.doc.getElementById("amsPrefillNote").style.display === "block" &&
    /updates this row/i.test(sb.doc.getElementById("amsPrefillNote").innerHTML),
    "the banner tells the teacher the saved score was loaded and that saving updates it");

  // Pressing Save Score must UPDATE row 15 - never add a second one.
  sb.ctx.saveScore();
  await sleep(60);
  ok(sb.calls.some(function (c) { return c.indexOf("PUT /update-result/15") === 0; }),
    "Save Score updates the existing row (PUT /update-result/15)", JSON.stringify(sb.calls.slice(-3)));
  ok(!sb.calls.some(function (c) { return c.indexOf("POST /save-result") === 0; }),
    "and does NOT insert a duplicate (no POST /save-result)");
  ok(els.scoreTable.rows.length === 2, "the table still holds one row per saved score (rows: " + els.scoreTable.rows.length + ")");

  /* ---- picking the same student again after the save re-reads the row ---- */
  callGlobal(sb, "pickStudentFromDropdown", "AM/24/001");
  await sleep(120);
  ok(els.firstTest.value === "5", "re-picking the same student loads the saved score again (not an empty form)");

  /* ---- a student with nothing saved stays a NEW entry ---- */
  els.studentSelectDropdown.value = "AM/24/002";
  callGlobal(sb, "pickStudentFromDropdown", "AM/24/002");
  await sleep(120);
  ok(els.firstTest.value === "" && els.totalScore.value === "",
    "a student with no saved score leaves the boxes empty");
  ok(els.saveScoreBtn.textContent === "Save Score", "and the form stays a plain new entry");
  ok(/NEW entry/i.test(sb.doc.getElementById("amsPrefillNote").innerHTML),
    "the banner says a brand new entry will be added");
  els.firstTest.value = "4"; els.secondTest.value = "4"; els.noteScore.value = "4";
  els.attendanceScore.value = "4"; els.examScore.value = "20";
  sb.ctx.calculateScore();
  sb.ctx.saveScore();
  await sleep(60);
  ok(sb.calls.some(function (c) { return c.indexOf("POST /save-result") === 0; }),
    "a brand new score is still saved with POST /save-result");
  ok(els.scoreTable.rows.length === 3, "only the new row was added (rows: " + els.scoreTable.rows.length + ")");
  ok(els.scoreTable.rows.filter(function (r) { return String(r.dataset.id) === "999"; }).length === 1,
    "the new row carries the id the server answered with");

  /* ---- duplicates already in the database are shown ONCE ---- */
  const dupRows = [
    {
      id: 20, student_id: "AM/24/001", student_name: "Aisha Bello", class_name: "SS 1",
      term: "1st Term", session: "2025/2026", subject: "Mathematics",
      first_test: "8.00", second_test: "7.00", note_score: "6.00", attendance_score: "9.00",
      ca_score: "30.00", exam_score: "45.00", total: "75.00", grade: "A"
    },
    {
      id: 21, student_id: "AM/24/001", student_name: "Aisha Bello", class_name: "SS 1",
      term: "1st Term", session: "2025/2026", subject: "Mathematics",
      first_test: "9.00", second_test: "9.00", note_score: "9.00", attendance_score: "9.00",
      ca_score: "36.00", exam_score: "55.00", total: "91.00", grade: "A"
    }
  ];
  const dup = scoresPageSandbox(dupRows);
  runFile(dup.ctx, "js/app.js");
  dup.fire("DOMContentLoaded");
  await sleep(40);
  callGlobal(dup, "pickStudentFromDropdown", "AM/24/001");
  await sleep(120);
  ok(dup.byId.scoreTable.rows.length === 1,
    "a score the old code saved twice is LISTED once (rows: " + dup.byId.scoreTable.rows.length + ")");
  ok(dup.byId.firstTest.value === "9", "the NEWEST of the two is the one loaded onto the form (first test " + dup.byId.firstTest.value + ")");
  ok(/duplicate row/i.test(dup.doc.getElementById("amsPrefillNote").innerHTML),
    "the banner mentions the duplicate that was ignored");
  dup.ctx.saveScore();
  await sleep(60);
  ok(dup.calls.some(function (c) { return c.indexOf("PUT /update-result/21") === 0; }),
    "and saving merges it into the newest row (PUT /update-result/21)");

  /* ---- picking the student BEFORE the term/subject still loads the score -- */
  const pickOrder = scoresPageSandbox();
  runFile(pickOrder.ctx, "js/app.js");
  pickOrder.fire("DOMContentLoaded");
  await sleep(40);
  pickOrder.byId.term.value = "1st Term";
  pickOrder.byId.session.value = "2025/2026";
  callGlobal(pickOrder, "pickStudentFromDropdown", "AM/24/001");
  await sleep(120);
  ok(pickOrder.byId.firstTest.value === "5", "term/session picked first -> that term's saved score is loaded");

  // Now the teacher picks the subject - the score for it appears by itself.
  pickOrder.byId.subject.value = "Mathematics";
  pickOrder.byId.subject.dispatch("change");
  await sleep(400);
  ok(pickOrder.byId.firstTest.value === "8" && pickOrder.byId.examScore.value === "45",
    "picking the subject re-reads the score saved for it (first: " + pickOrder.byId.firstTest.value + ", exam: " + pickOrder.byId.examScore.value + ")");
  pickOrder.ctx.saveScore();
  await sleep(60);
  ok(pickOrder.calls.some(function (c) { return c.indexOf("PUT /update-result/12") === 0; }),
    "saving that score updates ITS row (PUT /update-result/12)", JSON.stringify(pickOrder.calls.slice(-3)));
}

/* ==========================================================================
   batch entry - the remembered class opens with its scores on screen
   ========================================================================== */
async function batchAutoLoadTests() {
  console.log("\njs/scores-batch.js - saved scores appear without pressing anything");

  const bbClass = makeSelect("bbClass");
  const bbSession = makeSelect("bbSession");
  const bbTerm = makeSelect("bbTerm");
  const bbSubject = makeSelect("bbSubject");
  bbTerm.innerHTML = '<option value="">Select term…</option><option>1st Term</option><option>2nd Term</option><option>3rd Term</option>';
  bbTerm.value = "1st Term";

  const grid = makeEl("div");
  grid._html = "";
  const els = {
    bbClass: bbClass, bbSession: bbSession, bbTerm: bbTerm, bbSubject: bbSubject,
    bbGrid: grid, bbStatus: makeEl("div"), bbSearch: makeEl("input"),
    bbVisibleCount: makeEl("span"), bbEditedHint: makeEl("span"), bbProgress: makeEl("span"),
    bbSaveBtn: makeEl("button"), bbSaveBar: makeEl("div"), amsBatchPanel: makeEl("section")
  };
  Object.keys(els).forEach(function (id) { els[id].id = id; });
  els.bbSaveBar.style = { display: "none" };

  const storage = {};
  storage["ams-scores-batch-v1"] = JSON.stringify({
    class_name: "SS 1", session: "2025/2026", term: "1st Term", subject: "Mathematics"
  });

  const batchCalls = [];
  const sb = makeSandbox({
    els: els,
    fetch: function (url) {
      url = String(url);
      batchCalls.push(url.split("?")[0]);
      if (url.indexOf("/classes") === 0) return Promise.resolve(jsonResponse(200, [{ class_name: "SS 1" }]));
      if (url.indexOf("/sessions") === 0) return Promise.resolve(jsonResponse(200, [{ session: "2025/2026", is_current: 1 }]));
      if (url.indexOf("/subjects") === 0) return Promise.resolve(jsonResponse(200, [{ subject_name: "Mathematics" }]));
      if (url.indexOf("/api/scores/batch") === 0) {
        return Promise.resolve(jsonResponse(200, {
          students: [
            { student_id: "AM/24/001", full_name: "Aisha Bello", class_name: "SS 1" },
            { student_id: "AM/24/002", full_name: "Bilal Yusuf", class_name: "SS 1" }
          ],
          scores: { "am/24/001": { id: 12, first_test: 8, second_test: 7, note_score: 6, attendance_score: 9, ca_score: 30, exam_score: 45, total: 75, grade: "A" } }
        }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    }
  });
  // the sandbox storage is empty by default - seed the remembered picks
  sb.ctx.localStorage.setItem("ams-scores-batch-v1", storage["ams-scores-batch-v1"]);

  runFile(sb.ctx, "js/scores-batch.js");
  await sleep(200);

  ok(batchCalls.some(function (u) { return u.indexOf("/api/scores/batch") === 0; }),
    "the remembered class loads by itself on entry (no button press)", JSON.stringify(batchCalls));
  ok(/AM\/24\/001/.test(grid.innerHTML), "the class grid is on screen");
  ok(/value="8"/.test(grid.innerHTML) && /value="45"/.test(grid.innerHTML),
    "and the scores entered before are already in the boxes");
  ok(/bb-has/.test(grid.innerHTML), "the pre-filled student is marked as already saved");
  ok(els.bbSaveBar.style.display !== "none", "the save bar is shown for the pre-filled grid");

  // Changing the subject reloads the grid for the new pick, by itself.
  const loadsBefore = batchCalls.filter(function (u) { return u.indexOf("/api/scores/batch") === 0; }).length;
  els.bbSubject.innerHTML = '<option value="English">English</option>';
  els.bbSubject.value = "English";
  els.bbSubject.dispatch("change");
  await sleep(600);
  const loadsAfter = batchCalls.filter(function (u) { return u.indexOf("/api/scores/batch") === 0; }).length;
  ok(loadsAfter === loadsBefore + 1,
    "picking another subject reloads the grid once, automatically (" + loadsBefore + " -> " + loadsAfter + ")");
}

/* ==========================================================================
   B. the real server with a fake MySQL layer
   ========================================================================== */
if (process.argv[2] === "--serve") return serve();

function serve() {
  const dir = process.argv[3];
  const port = Number(process.argv[4]);
  process.env.PORT = String(port);
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "harness-secret";
  process.env.DB_PASSWORD = "harness";
  process.env.ADMIN_DEFAULT_PASSWORD = "test1234";

  const trail = path.join(os.tmpdir(), "ams-results-sql-" + port + ".json");
  try { fs.unlinkSync(trail); } catch (e) {}
  const log = [];
  const push = function (v) { log.push(v); try { fs.writeFileSync(trail, JSON.stringify(log)); } catch (e) {} };
  const store = makeStore();
  const newConnection = function () { return makeConnection(store, push); };

  const dbPath = fs.realpathSync(path.join(dir, "db.js"));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: newConnection() };
  // addonConnection() builds its own connection straight from mysql2 - give it
  // the same fake (and the same rows) so the guarded boot migrations really run.
  const mysql2Path = require.resolve("mysql2", { paths: [dir] });
  const fake = { createConnection: function () { return newConnection(); }, createPool: function () { return newConnection(); } };
  require.cache[mysql2Path] = { id: mysql2Path, filename: mysql2Path, loaded: true, exports: fake };

  require(path.join(dir, "server.js"));
  setTimeout(function () { console.log("READY " + port); }, 900);
}

/* ONE shared store: every fake connection in the child process (db.js's and
   the ones addonConnection() builds) reads and writes the same rows - exactly
   like a real database. */
function makeStore() {
  return {
    sessions: Object.create(null),
    nextId: 500,
    rows: [
      /* 1 + 2 are the duplicate pair the old /save-result created (identical). */
      { id: 1, student_id: "AM/24/001", student_name: "Aisha Bello", class_name: "SS 1", term: "1st Term", session: "2025/2026", subject: "Mathematics", first_test: 8, second_test: 7, note_score: 6, attendance_score: 9, ca_score: 30, exam_score: 45, total: 75, grade: "A" },
      { id: 2, student_id: "AM/24/001", student_name: "Aisha Bello", class_name: "SS 1", term: "1st Term", session: "2025/2026", subject: "Mathematics", first_test: 8, second_test: 7, note_score: 6, attendance_score: 9, ca_score: 30, exam_score: 45, total: 75, grade: "A" },
      /* a different subject with different marks - must never be touched */
      { id: 3, student_id: "AM/24/001", student_name: "Aisha Bello", class_name: "SS 1", term: "1st Term", session: "2025/2026", subject: "English", first_test: 5, second_test: 5, note_score: 5, attendance_score: 5, ca_score: 20, exam_score: 30, total: 50, grade: "C" },
      /* two rows for one pupil+subject with DIFFERENT marks: only a class save merges those */
      { id: 60, student_id: "AM/24/003", student_name: "Danladi Musa", class_name: "SS 1", term: "1st Term", session: "2025/2026", subject: "Mathematics", first_test: 2, second_test: 2, note_score: 2, attendance_score: 2, ca_score: 8, exam_score: 10, total: 18, grade: "F" },
      { id: 61, student_id: "AM/24/003", student_name: "Danladi Musa", class_name: "SS 1", term: "1st Term", session: "2025/2026", subject: "Mathematics", first_test: 3, second_test: 3, note_score: 3, attendance_score: 3, ca_score: 12, exam_score: 20, total: 32, grade: "F" }
    ]
  };
}

function makeConnection(store, push) {
  const USER = { id: 1, username: "admin", password_hash: require("bcryptjs").hashSync("test1234", 8), role: "admin" };

  function run(sqlRaw, params) {
    const sql = String(sqlRaw).replace(/\s+/g, " ").trim();
    params = params == null ? [] : (Array.isArray(params) ? params : [params]);

    if (/FROM information_schema\.COLUMNS/i.test(sql)) {
      const m = /TABLE_NAME IN \(([^)]*)\)/i.exec(sql);
      if (m) {
        return { rows: m[1].split(",").map(function (t) { return t.trim().replace(/'/g, "").toLowerCase(); })
          .map(function (t) { return { t: t, c: "id" }; }) };
      }
      return { rows: [{ c: "id" }] };
    }
    if (/FROM information_schema\.STATISTICS/i.test(sql)) return { rows: [] };
    if (/^\s*CREATE TABLE/i.test(sql)) return { rows: { affectedRows: 0 } };
    if (/^SELECT sess, expires_at FROM app_sessions/i.test(sql)) {
      const sess = store.sessions[params[0]];
      return { rows: sess ? [{ sess: sess, expires_at: Date.now() + 600000 }] : [] };
    }
    if (/^INSERT INTO app_sessions/i.test(sql)) { store.sessions[params[0]] = params[1]; return { rows: { affectedRows: 1 } }; }
    if (/^UPDATE app_sessions/i.test(sql)) return { rows: { affectedRows: 1 } };
    if (/^DELETE FROM app_sessions/i.test(sql)) { delete store.sessions[params[0]]; return { rows: { affectedRows: 0 } }; }
    if (/^SELECT 1$/i.test(sql)) return { rows: [{ n: 1 }] };
    if (/^SELECT \* FROM users/i.test(sql)) return { rows: params[0] === USER.username ? [USER] : [] };

    /* ---- the results table: the only data this harness cares about ---- */
    if (/FROM results/i.test(sql) || /(?:INSERT INTO|UPDATE|DELETE FROM) results/i.test(sql)) {
      if (/^INSERT INTO results/i.test(sql)) {
        push("##INSERT## " + JSON.stringify(params.slice(0, 6)));
        const id = ++store.nextId;
        store.rows.push({
          id: id, student_id: params[0], student_name: params[1], class_name: params[2],
          term: params[3], session: params[4], subject: params[5],
          first_test: params[6], second_test: params[7], note_score: params[8],
          attendance_score: params[9], ca_score: params[10], exam_score: params[11],
          total: params[12], grade: params[13]
        });
        return { rows: { insertId: id, affectedRows: 1 } };
      }
      if (/^UPDATE results/i.test(sql)) {
        const id = Number(params[params.length - 1]);
        /* read the SET column names out of the statement - the single-student
           form does not write term/session, the batch save does */
        const setPart = sql.split(/\bSET\b/i)[1].split(/\bWHERE\b/i)[0];
        const cols = [];
        setPart.split(",").forEach(function (frag) {
          const m = /`?([a-z_]+)`?\s*=/i.exec(frag.trim());
          if (m) cols.push(m[1]);
        });
        push("##UPDATE## id=" + id + " cols=" + cols.join("+"));
        const row = store.rows.find(function (r) { return Number(r.id) === id; });
        if (row) cols.forEach(function (col, i) { row[col] = params[i]; });
        return { rows: { affectedRows: row ? 1 : 0 } };
      }
      if (/^DELETE FROM results WHERE id IN/i.test(sql)) {
        const ids = (Array.isArray(params[0]) ? params[0] : []).map(Number);
        push("##DELETE## " + ids.join(","));
        let removed = 0;
        ids.forEach(function (id) {
          const at = store.rows.findIndex(function (r) { return Number(r.id) === id; });
          if (at !== -1) { store.rows.splice(at, 1); removed++; }
        });
        return { rows: { affectedRows: removed } };
      }
      /* SELECT ... FROM results */
      let rows = store.rows.slice();
      const where = sql.split(/\bWHERE\b/i)[1] || "";
      if (/student_id/i.test(where)) {
        const sid = String(params[0] || "").trim().toLowerCase();
        rows = rows.filter(function (r) { return String(r.student_id).trim().toLowerCase() === sid; });
      }
      if (/TRIM\(term\)/i.test(where)) {
        /* either [sid, sid, term, session] (/search-result, /save-result) or
           [term, session] (the batch save lookup) */
        const tail = params.map(String).slice(-2);
        if (tail.length === 2 && tail[0]) rows = rows.filter(function (r) { return String(r.term).trim() === tail[0].trim(); });
        if (tail.length === 2 && tail[1]) rows = rows.filter(function (r) { return String(r.session).trim() === tail[1].trim(); });
      }
      return { rows: rows.map(function (r) { return Object.assign({}, r); }) };
    }

    return { rows: [] };
  }

  const conn = {
    query: function (sql, params, cb) {
      if (typeof params === "function") { cb = params; params = []; }
      let res;
      try { res = run(sql, params); }
      catch (e) { res = { err: e }; }
      setImmediate(function () { if (cb) cb(res.err || null, res.rows || [], null); });
    },
    connect: function (cb) { setImmediate(function () { if (cb) cb(null); }); },
    getConnection: function (cb) { setImmediate(function () { cb(null, conn); }); },
    release: function () {},
    destroy: function () {},
    end: function (cb) { if (cb) cb(); },
    on: function () {}
  };
  return conn;
}

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
    const child = spawn(process.execPath, [path.join(REPO, "test", "scores-prefill-duplicate-test.js"), "--serve", REPO, String(port)],
      { cwd: REPO, env: Object.assign({}, process.env), stdio: ["ignore", "pipe", "pipe"] });
    let out = "", settled = false;
    const timer = setTimeout(function () {
      if (!settled) { settled = true; child.kill("SIGKILL"); reject(new Error("server did not start: " + out.slice(-600))); }
    }, 25000);
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

async function serverTests() {
  console.log("\nserver.js - /save-result upserts, /search-result lists one row");
  const port = 4390 + Math.floor(Math.random() * 40);
  let child;
  try {
    child = await boot(port);
  } catch (e) {
    ok(false, "the app boots with the fake database", String(e.message || e).slice(0, 300));
    return;
  }

  const trailFile = path.join(os.tmpdir(), "ams-results-sql-" + port + ".json");
  function trail() {
    try { return JSON.parse(fs.readFileSync(trailFile, "utf8")); } catch (e) { return []; }
  }

  try {
    const login = await request(port, "POST", "/login", { body: { username: "admin", password: "test1234" } });
    ok(login.status === 200, "harness login works (" + login.status + ")");
    const cookie = (login.headers["set-cookie"] || []).map(function (c) { return c.split(";")[0]; }).join("; ");
    const tok = await request(port, "GET", "/api/csrf-token", { cookie: cookie });
    const csrf = tok.json && tok.json.csrfToken;

    /* ---- the boot heal: the exact duplicate pair (1 + 2) is merged ---- */
    const before = trail();
    const bootDeletes = before.filter(function (l) { return /^##DELETE## /.test(l); });
    ok(bootDeletes.length === 1 && /^##DELETE## 1$/.test(bootDeletes[0]),
      "pack-112 boot step merges the EXACT duplicate pair - newest (id 2) kept, id 1 removed",
      JSON.stringify(bootDeletes));
    ok(before.filter(function (l) { return /^##DELETE## /.test(l); }).every(function (l) { return l.split("##DELETE## ")[1].split(",").length === 1; }),
      "only an identical copy is ever deleted (the English score with other marks is untouched)");

    /* ---- /search-result lists one row per term+session+subject ---- */
    const search = await request(port, "GET", "/search-result/AM%2F24%2F001", { cookie: cookie });
    const listed = (search.json || []).filter(function (r) { return String(r.subject) === "Mathematics"; });
    ok(listed.length === 1, "Mathematics is listed ONCE (rows: " + listed.length + ")");
    ok(Number(listed[0].id) === 2, "the newest copy is the one kept (id " + (listed[0] && listed[0].id) + ")");
    const english = (search.json || []).filter(function (r) { return String(r.subject) === "English"; });
    ok(english.length === 1, "the untouched subject (English) is still listed");

    /* ---- saving a score that already exists UPDATES instead of inserting --- */
    const save1 = await request(port, "POST", "/save-result", {
      cookie: cookie, csrf: csrf,
      body: {
        student_id: "AM/24/001", student_name: "Aisha Bello", class_name: "SS 1",
        term: "1st Term", session: "2025/2026", subject: "mathematics",
        first_test: 9, second_test: 8, note_score: 7, attendance_score: 9,
        ca_score: 33, exam_score: 50, total_score: 83, grade: "A"
      }
    });
    ok(save1.status === 200 && save1.json && save1.json.updated === true,
      "re-saving the same student/term/session/subject UPDATES (updated: " + (save1.json && save1.json.updated) + ")");
    ok(save1.json && Number(save1.json.id) === 2, "and answers with the row it wrote (id " + (save1.json && save1.json.id) + ")");
    ok(save1.json && /no duplicate|duplicate row/i.test(save1.json.message || ""),
      "the answer says no duplicate was added: \"" + (save1.json && save1.json.message) + "\"");

    const after = trail();
    const updates = after.filter(function (l) { return /^##UPDATE## id=2 /.test(l); });
    const inserts = after.filter(function (l) { return /^##INSERT## /.test(l); });
    ok(updates.length >= 1, "the SQL trail shows an UPDATE of row 2 (found " + updates.length + ")",
      JSON.stringify(after.filter(function (l) { return l.indexOf("##") === 0; })));
    ok(inserts.length === 0, "and NOT a single INSERT (found " + inserts.length + ")", JSON.stringify(inserts));

    /* ---- a genuinely new subject still inserts ---- */
    const save2 = await request(port, "POST", "/save-result", {
      cookie: cookie, csrf: csrf,
      body: {
        student_id: "AM/24/002", student_name: "Bilal Yusuf", class_name: "SS 1",
        term: "1st Term", session: "2025/2026", subject: "Mathematics",
        first_test: 4, second_test: 4, note_score: 4, attendance_score: 4,
        ca_score: 16, exam_score: 20, total_score: 36, grade: "F"
      }
    });
    ok(save2.status === 200 && save2.json && save2.json.updated === false,
      "a NEW score is still inserted (updated: " + (save2.json && save2.json.updated) + ")");
    ok(save2.json && Number(save2.json.id) > 500, "and answers with the new id (" + (save2.json && save2.json.id) + ")");

    /* ---- saving a whole class also cleans the duplicates out of it ---- */
    const batch = await request(port, "POST", "/api/scores/batch", {
      cookie: cookie, csrf: csrf,
      body: {
        class_name: "SS 1", term: "1st Term", session: "2025/2026", subject: "Mathematics",
        scores: [
          { student_id: "AM/24/001", student_name: "Aisha Bello", first_test: 9, second_test: 8, note_score: 7, attendance_score: 9, exam_score: 50 },
          { student_id: "AM/24/002", student_name: "Bilal Yusuf", first_test: 4, second_test: 4, note_score: 4, attendance_score: 4, exam_score: 20 },
          { student_id: "AM/24/003", student_name: "Danladi Musa", first_test: 6, second_test: 6, note_score: 6, attendance_score: 6, exam_score: 40 }
        ]
      }
    });
    ok(batch.status === 200 && batch.json && batch.json.merged >= 1,
      "the batch save merges the duplicated class rows (merged: " + (batch.json && batch.json.merged) + ")",
      batch.body.slice(0, 160));
    ok(batch.json && /duplicate row/.test(batch.json.message || ""),
      "and says so: \"" + (batch.json && batch.json.message) + "\"");
    const trail3 = trail();
    ok(trail3.some(function (l) { return /^##DELETE## 60$/.test(l); }),
      "the older duplicate of that pupil is the one removed (id 60)",
      JSON.stringify(trail3.filter(function (l) { return l.indexOf("##DELETE") === 0; })));

    const third = await request(port, "GET", "/search-result/AM%2F24%2F003", { cookie: cookie });
    const thirdMaths = (third.json || []).filter(function (r) { return String(r.subject) === "Mathematics"; });
    ok(thirdMaths.length === 1 && Number(thirdMaths[0].first_test) === 6,
      "that pupil now has ONE Mathematics row, with the marks just saved (rows: " + thirdMaths.length +
      ", first test: " + (thirdMaths[0] && thirdMaths[0].first_test) + ")");

    /* ---- the missing-fields guard ---- */
    const bad = await request(port, "POST", "/save-result", { cookie: cookie, csrf: csrf, body: { student_id: "AM/24/001" } });
    ok(bad.status === 400, "an incomplete save is refused with 400 (" + bad.status + ")");
  } catch (e) {
    ok(false, "the server half ran end to end", String(e && e.message || e).slice(0, 300));
  } finally {
    if (child) child.kill("SIGKILL");
  }
}

(async function main() {
  console.log("pack 112 - previously entered scores show up; no duplicates");
  await prefillBrowserTests();
  await batchAutoLoadTests();
  await serverTests();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.error("test crashed:", err);
  process.exit(1);
});
