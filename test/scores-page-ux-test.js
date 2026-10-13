/* ==========================================================================
   test/scores-page-ux-test.js  (NEW - pack 111)

   Owner, verbatim:
     "In the batch entry. The save is falling under the bottom nav causing not
      to be able to save it. In the single student score if I want to select
      student it will display and disappear same time for 3 times before it
      stay likewise picking subjects also. Fix and merge now"

   Reproduces both faults against the real browser files in a VM with a tiny
   fake DOM + fake fetch:

     1. DROPDOWN FLICKER (scores.html -> js/app.js)
        * the quick-pick student <select> was written FOUR times while the page
          loaded (body onload, onDOMReady, a 50ms timer, DOMContentLoaded) and
          every answer replaced its innerHTML - a student picked in between was
          thrown away again ("display and disappear ... before it stay").
          Now: one shared /students request, one draw, the picked student stays.
        * the subject <select> was rebuilt by loadSubjects() on every class fill
          AND on every quick-card refresh: identical class + options must not be
          drawn again, a picked subject must survive, and an answer for an older
          class must never overwrite the newer one.
        * a redraw must never happen while the native picker is open.

     2. SAVE BAR UNDER THE BOTTOM NAV (scores.html + js/scores-batch.js)
        * every staff page gets the shared fixed quick-nav bar at the bottom
          (css/staff-navigation.css, z-index 995, ~61px). The batch save bar was
          fixed to bottom:0 as well, so the navigation covered "Save All Scores".
          Now: the real bar height is measured into --ams-bb-nav-lift, the save
          bar is lifted by it, and scores.html pads the page by both heights.

   node test/scores-page-ux-test.js
   ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  ok   - " + label); }
  else { fail++; console.log("  FAIL - " + label + (extra ? "   [" + extra + "]" : "")); }
}
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ------------------------------- fake DOM -------------------------------- */
function makeClassList() {
  const set = new Set();
  return {
    _set: set,
    add: function (c) { set.add(c); },
    remove: function (c) { set.delete(c); },
    contains: function (c) { return set.has(c); },
    toggle: function (c, force) {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    }
  };
}

function makeEl(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    id: "", className: "", title: "", type: "", value: "", disabled: false,
    children: [], listeners: {}, _html: "", _text: "", _computed: null,
    rect: { height: 0, bottom: 0, top: 0, width: 0, left: 0, right: 0 },
    style: {
      _props: {},
      setProperty: function (k, v) { this._props[k] = v; this[k] = v; },
      getPropertyValue: function (k) { return this._props[k] || ""; }
    },
    classList: makeClassList(),
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    getBoundingClientRect: function () { return this.rect; },
    addEventListener: function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    removeEventListener: function (ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter(function (f) { return f !== fn; }); },
    dispatch: function (ev, arg) { (this.listeners[ev] || []).slice().forEach(function (f) { f(arg); }); },
    appendChild: function (c) { this.children.push(c); return c; },
    insertBefore: function (c) { this.children.unshift(c); return c; },
    setAttribute: function () {}, removeAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    focus: function () { if (this.__doc) this.__doc.activeElement = this; },
    select: function () {}, blur: function () {}, remove: function () {}, scrollIntoView: function () {}
  };
  return el;
}

/* A <select> good enough for the real code: writing innerHTML parses the
   <option> rows and resets the value to the first row (exactly like a
   browser), and setting .value to something that is not in the list clears it.
   `writes` counts how many times the list was REDRAWN - the number that made
   the choices flash away. */
function makeSelect(id) {
  const el = makeEl("select");
  el.id = id;
  el.options = [];
  el.writes = 0;
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
      this.writes++;
      this.options = [];
      const re = /<option([^>]*)>([\s\S]*?)<\/option>/g;
      let m;
      while ((m = re.exec(this._html))) {
        const attrs = m[1];
        const vm2 = /value\s*=\s*"([^"]*)"/.exec(attrs);
        // <option>1st Term</option> (no value attribute) submits its text,
        // exactly like a browser.
        const text = decodeEntities(m[2]).trim();
        this.options.push({
          value: vm2 ? decodeEntities(vm2[1]) : text,
          text: text,
          disabled: /\bdisabled\b/.test(attrs)
        });
      }
      this._value = this.options.length ? this.options[0].value : "";
    }
  });
  el.appendChild = function (c) {
    if (c && c.tagName === "OPTION") {
      this.options.push({ value: String(c.value == null ? "" : c.value), text: String(c.textContent || ""), disabled: false });
    }
    this.children.push(c);
    return c;
  };
  return el;
}

/* A fake response with the same surface the pages use. */
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: function () {
      return body === null ? Promise.reject(new Error("not json")) : Promise.resolve(body);
    },
    text: function () { return Promise.resolve(JSON.stringify(body)); },
    headers: { get: function () { return null; } }
  };
}

function makeSandbox(opts) {
  opts = opts || {};
  const byId = {};
  Object.keys(opts.els || {}).forEach(function (id) { byId[id] = opts.els[id]; });

  const docListeners = {};
  const winListeners = {};
  const html = makeEl("html");
  const body = makeEl("body");
  const doc = {
    readyState: opts.readyState || "complete",
    activeElement: null,
    documentElement: html,
    body: body,
    head: makeEl("head"),
    byId: byId,
    getElementById: function (id) { return byId[id] || null; },
    createElement: function (tag) { const e = makeEl(tag); e.__doc = doc; return e; },
    querySelector: function (sel) {
      if (String(sel).indexOf("quicknav") !== -1) return opts.nav || null;
      return byId[String(sel).replace(/^#/, "").split(/[ ,]/)[0]] || null;
    },
    querySelectorAll: function () { return []; },
    addEventListener: function (ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    removeEventListener: function () {},
    _fire: function (ev) { (docListeners[ev] || []).slice().forEach(function (f) { f(); }); },
    _listeners: docListeners
  };
  Object.keys(byId).forEach(function (id) { byId[id].__doc = doc; });

  const win = {
    innerHeight: opts.innerHeight || 800,
    document: doc,
    location: { href: "scores.html", pathname: "/scores.html", search: "" },
    getComputedStyle: function (el) {
      return el && el._computed ? el._computed : { display: "block", position: "static", visibility: "visible" };
    },
    addEventListener: function (ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); },
    removeEventListener: function () {},
    _listeners: winListeners,
    _fire: function (ev) { (winListeners[ev] || []).slice().forEach(function (f) { f(); }); }
  };
  if (opts.mutationObserver !== false) {
    win.MutationObserver = function () { this.observe = function () {}; this.disconnect = function () {}; };
  }
  if (opts.resizeObserver) {
    win.ResizeObserver = function () { this.observe = function () {}; this.disconnect = function () {}; };
  }

  const storage = {};
  const store = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem: function (k, v) { storage[k] = String(v); },
    removeItem: function (k) { delete storage[k]; }
  };

  const ctx = vm.createContext({
    console: { log: function () {}, warn: function () {}, error: function () {} },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function () { return 0; },
    document: doc,
    window: win,
    localStorage: store,
    sessionStorage: store,
    alert: function () {},
    fetch: opts.fetch
  });
  // In a browser these are globals as well as window properties.
  ctx.location = win.location;
  ctx.globalThis = ctx;
  if (win.ResizeObserver) ctx.ResizeObserver = win.ResizeObserver;
  if (win.MutationObserver) ctx.MutationObserver = win.MutationObserver;
  return { ctx: ctx, doc: doc, win: win, html: html, body: body, byId: byId, fire: doc._fire };
}

function runFile(ctx, rel) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, { filename: rel });
}

const STUDENTS = [
  { student_id: "AM/24/001", full_name: "Aisha Bello", class_name: "SS 1" },
  { student_id: "AM/24/002", full_name: "Bilal Yusuf", class_name: "SS 1" },
  { student_id: "AM/24/003", full_name: "Danladi Musa", class_name: "Primary Two" },
  { student_id: "AM/24/004", full_name: "Fatima Idris", class_name: "Primary Two" }
];

/* ==========================================================================
   1. quick-pick student dropdown - one draw, the stay is a stay
   ========================================================================== */
async function studentDropdownTests() {
  console.log("\njs/app.js - quick-pick student dropdown (the \"disappear\" bug)");
  const drop = makeSelect("studentSelectDropdown");
  const cls = makeSelect("studentClass");
  cls.value = "";
  let studentsCalls = 0;
  let clsCalls = 0;
  const sb = makeSandbox({
    els: {
      studentSelectDropdown: drop,
      studentClass: cls,
      studentId: makeEl("input"),
      studentName: makeEl("input"),
      dashboardSummary: makeEl("div")
    },
    fetch: function (url) {
      url = String(url);
      if (url.indexOf("/students") === 0) { studentsCalls++; return Promise.resolve(jsonResponse(200, STUDENTS)); }
      if (url.indexOf("/classes") === 0) { clsCalls++; return Promise.resolve(jsonResponse(200, [{ class_name: "SS 1" }, { class_name: "Primary Two" }])); }
      if (url.indexOf("/dashboard-summary") === 0) return Promise.resolve(jsonResponse(200, { students: 4, subjects: 2, results: 0 }));
      return Promise.resolve(jsonResponse(200, []));
    }
  });
  runFile(sb.ctx, "js/app.js");
  runFile(sb.ctx, "js/subject.js");   // scores.html loads it too (loadClassesIntoSelects)
  sb.fire("DOMContentLoaded");
  await sleep(40);

  ok(drop.writes === 1, "the whole page load draws the student list exactly ONCE (draws: " + drop.writes + ", /students calls: " + studentsCalls + ")");
  ok(studentsCalls === 1, "the four old racers share one /students request (calls: " + studentsCalls + ")");
  ok(drop.options.length === 5, "all four students are listed (options: " + drop.options.length + ")");

  // The teacher opens the dropdown and picks a student ...
  drop.value = "AM/24/002";
  // ... and every one of the old late callers fires again.
  sb.ctx.populateStudentDropdown("");
  sb.ctx.populateStudentDropdown("");
  sb.ctx.loadSubjects();
  sb.ctx.loadClassesIntoSelects();
  await sleep(40);
  ok(drop.value === "AM/24/002", "the picked student is still selected after the late fills (value: '" + drop.value + "')");
  ok(drop.writes === 1, "and the list was NOT rebuilt under the picker (draws: " + drop.writes + ")");

  // While the native picker is open nothing may be redrawn.
  const writesBefore = drop.writes;
  sb.doc.activeElement = drop;
  cls.value = "SS 1";
  sb.ctx.populateStudentDropdown("SS 1", true);
  await sleep(40);
  ok(drop.writes === writesBefore, "no redraw while the picker is open (draws still: " + drop.writes + ")");
  drop.dispatch("blur");         // the teacher closes the picker
  await sleep(20);
  ok(drop.writes === writesBefore + 1, "the queued class filter is drawn as soon as the picker closes (draws: " + drop.writes + ")");
  ok(drop.value === "AM/24/002", "the picked student survives the deferred draw (value: '" + drop.value + "')");
  ok(drop.options.some(function (o) { return o.value === "AM/24/001"; }), "SS 1 students are the listed ones after filtering");

  // Filter to a class the picked student is NOT in: the choice must stay visible.
  sb.doc.activeElement = null;
  sb.ctx.populateStudentDropdown("Primary Two");
  await sleep(20);
  ok(drop.value === "AM/24/002", "a class filter change cannot silently drop the chosen student (value: '" + drop.value + "')");
  ok(drop.options.some(function (o) { return o.value === "AM/24/002"; }), "the chosen student keeps a row in the filtered list");
  ok(drop.writes === writesBefore + 2, "the new filter is one draw, not a storm (draws: " + drop.writes + ")");
}

/* ==========================================================================
   2. subject dropdown - identical list, no redraw, stale answer ignored
   ========================================================================== */
async function subjectDropdownTests() {
  console.log("\njs/app.js - subject dropdown (\"likewise picking subjects also\")");
  const subject = makeSelect("subject");
  const cls = makeSelect("studentClass");
  // What loadClassesIntoSelects() has already put in the page's class picker.
  cls.innerHTML = '<option value="" disabled selected>Select Class</option>' +
    '<option value="SS 1">SS 1</option><option value="SS 2">SS 2</option>';
  cls.writes = 0;
  const subjectCalls = [];
  let staleDelay = 0;
  const sb = makeSandbox({
    els: { subject: subject, studentClass: cls },
    fetch: function (url) {
      url = String(url);
      if (url.indexOf("/subjects") === 0) {
        subjectCalls.push(url);
        const list = url.indexOf("SS%202") !== -1 || url.indexOf("SS 2") !== -1
          ? [{ subject_name: "Arabic" }]
          : [{ subject_name: "Mathematics" }, { subject_name: "English" }];
        const delay = staleDelay;
        return new Promise(function (res) { setTimeout(function () { res(jsonResponse(200, list)); }, delay); });
      }
      return Promise.resolve(jsonResponse(200, []));
    }
  });
  runFile(sb.ctx, "js/app.js");
  await sleep(20);

  cls.value = "SS 1";
  sb.ctx.loadSubjects();
  sb.ctx.loadSubjects();
  sb.ctx.loadSubjects();
  await sleep(40);
  ok(subject.writes === 1, "three loadSubjects() calls for the same class draw the subject list once (draws: " + subject.writes + ", calls: " + subjectCalls.length + ")");
  ok(subject.options.length === 3, "both subjects plus the placeholder are listed (options: " + subject.options.length + ")");

  subject.value = "Mathematics";
  sb.ctx.loadSubjects();                 // e.g. the quick-card refresh
  await sleep(20);
  ok(subject.value === "Mathematics", "the chosen subject survives a refresh (value: '" + subject.value + "')");
  ok(subject.writes === 1, "and the identical list is not redrawn (draws: " + subject.writes + ")");

  // An answer for an older class must never overwrite the newer one.
  staleDelay = 30;
  cls.value = "SS 1";                    // slow answer: Mathematics / English
  sb.ctx.loadSubjects();
  staleDelay = 0;
  cls.value = "SS 2";                    // fast answer: Arabic (the real pick)
  sb.ctx.loadSubjects();
  await sleep(80);
  const values = subject.options.map(function (o) { return o.value; });
  ok(values.indexOf("Arabic") !== -1 && values.indexOf("Mathematics") === -1,
    "the stale answer for the previous class is ignored", JSON.stringify(values));
}

/* ==========================================================================
   3. batch save bar vs. the shared bottom navigation
   ========================================================================== */
async function saveBarTests() {
  console.log("\njs/scores-batch.js - save bar lifted above the bottom nav");
  const nav = makeEl("nav");
  nav._computed = { display: "flex", position: "fixed", visibility: "visible" };
  nav.rect = { height: 61, bottom: 800, top: 739, width: 360, left: 0, right: 360 };

  const els = {
    bbClass: makeSelect("bbClass"),
    bbSession: makeSelect("bbSession"),
    bbTerm: makeSelect("bbTerm"),
    bbSubject: makeSelect("bbSubject"),
    bbGrid: makeEl("div"),
    bbStatus: makeEl("div"),
    bbSearch: makeEl("input"),
    bbVisibleCount: makeEl("span"),
    bbEditedHint: makeEl("span"),
    bbProgress: makeEl("span"),
    bbSaveBtn: makeEl("button"),
    bbSaveBar: makeEl("div")
  };
  // What scores.html puts in the Term dropdown (session/class/subject are
  // filled from the API by initBatchTab()).
  els.bbTerm.innerHTML = '<option value="">Select term…</option><option>1st Term</option>' +
    '<option>2nd Term</option><option>3rd Term</option>';
  els.bbTerm.writes = 0;
  els.bbSaveBar.style.display = "none";
  els.bbSaveBar.rect = { height: 78, bottom: 800, top: 722, width: 360, left: 0, right: 360 };

  const sb = makeSandbox({
    els: els,
    nav: nav,
    innerHeight: 800,
    resizeObserver: true,
    fetch: function (url) {
      url = String(url);
      if (url.indexOf("/classes") === 0) return Promise.resolve(jsonResponse(200, [{ class_name: "SS 1" }]));
      if (url.indexOf("/sessions") === 0) return Promise.resolve(jsonResponse(200, [{ session: "2025/2026", is_current: 1 }]));
      if (url.indexOf("/subjects") === 0) return Promise.resolve(jsonResponse(200, [{ subject_name: "Mathematics" }]));
      if (url.indexOf("/api/scores/batch") === 0) {
        return Promise.resolve(jsonResponse(200, { students: STUDENTS.slice(0, 2), scores: {} }));
      }
      return Promise.resolve(jsonResponse(200, []));
    }
  });
  runFile(sb.ctx, "js/scores-batch.js");
  await sleep(60);

  ok(String(sb.html.style["--ams-bb-nav-lift"]) === "61px",
    "the real height of the bottom navigation is measured and published (--ams-bb-nav-lift: " + sb.html.style["--ams-bb-nav-lift"] + ")");
  ok(sb.html.classList.contains("ams-bb-lifted") === true, "the page switches to the lifted layout");

  // Nothing may be lifted when the nav is hidden (desktop) - and back again.
  nav._computed = { display: "none", position: "fixed", visibility: "visible" };
  sb.win._fire("resize");
  ok(String(sb.html.style["--ams-bb-nav-lift"]) === "0px" && !sb.html.classList.contains("ams-bb-lifted"),
    "on desktop (nav display:none) nothing is lifted");
  nav._computed = { display: "flex", position: "fixed", visibility: "visible" };
  sb.win._fire("resize");
  ok(String(sb.html.style["--ams-bb-nav-lift"]) === "61px", "rotating/resizing back re-lifts the save bar");

  // Pick the class exactly like the teacher does: the change listener loads
  // that class's subjects.
  els.bbClass.value = "SS 1";
  els.bbClass.dispatch("change");
  await sleep(40);
  ok(els.bbSubject.options.some(function (o) { return o.value === "Mathematics"; }),
    "picking the class loads its subjects (pick-once, as before)");

  // Now load the class: the save bar appears and must sit ABOVE the navigation.
  els.bbSession.value = "2025/2026";
  els.bbTerm.value = "1st Term";
  els.bbSubject.value = "Mathematics";
  sb.win.bbLoad();
  await sleep(60);
  ok(els.bbSaveBar.style.display !== "none", "the save bar is shown after Load Students");
  ok(sb.body.classList.contains("ams-bb-savebar-on") === true, "the page knows the save bar is on screen");
  ok(String(sb.html.style["--ams-bb-save-h"]) === "78px",
    "the save bar's own height is published too (--ams-bb-save-h: " + sb.html.style["--ams-bb-save-h"] + ")");

  // The numbers are useless unless the stylesheet uses them.
  const page = fs.readFileSync(path.join(REPO, "scores.html"), "utf8");
  ok(/\.bb-savebar\{[^}]*bottom: var\(--ams-bb-nav-lift/.test(page.replace(/\s*\n\s*/g, " ")),
    "scores.html lifts .bb-savebar by --ams-bb-nav-lift");
  ok(/html body\.ams-staff-navigation \.bb-savebar\{[^}]*bottom: var\(--ams-bb-nav-lift/.test(page.replace(/\s*\n\s*/g, " ")),
    "and a CSS fallback keeps it lifted even before the measurement lands");
  ok(/padding-bottom: calc\(var\(--ams-bb-nav-lift, 61px\) \+ var\(--ams-bb-save-h, 0px\) \+ 26px\)/.test(page),
    "the page content is padded by BOTH the nav and the save bar");
  ok(/html\.ams-bb-lifted \.bb-savebar\{ padding-bottom:10px; \}/.test(page),
    "the lifted bar drops its safe-area padding (no double gap above the nav)");
  ok(page.indexOf("#amsInstallBtn") !== -1, "the PWA install bubble is lifted out of the Save button's way");
  ok(/\/\* Toasts[\s\S]*?#ams-toast-root\{[\s\S]*?bottom: calc\(var\(--ams-bb-nav-lift, 0px\) \+ var\(--ams-bb-save-h, 0px\) \+ 22px\)/.test(page),
    "save/error toasts are moved above the save bar + bottom nav too");
}

/* ==========================================================================
   4. the z-index order that caused it (navigation must stay under the bar)
   ========================================================================== */
function stackingTests() {
  console.log("\nstylesheets - the stacking that hid the Save button");
  const page = fs.readFileSync(path.join(REPO, "scores.html"), "utf8");
  const nav = fs.readFileSync(path.join(REPO, "css/staff-navigation.css"), "utf8");
  const saveZ = Number((/\.bb-savebar\{[\s\S]*?z-index:(\d+)/.exec(page) || [])[1]);
  const navZ = Number((/\.ams-shared-quicknav\{[\s\S]*?z-index:(\d+)/.exec(nav) || [])[1]);
  ok(navZ === 995, "the shared bottom quick-nav is the fixed bar at z-index 995 (core fix: " + navZ + ")");
  ok(saveZ > navZ, "the save bar now stacks above the bottom nav (" + saveZ + " > " + navZ + ")");
  ok(saveZ < 1002, "and still far below the navigation drawer (1002)");
}

/* ---------------------------------- run ---------------------------------- */
(async function main() {
  console.log("pack 111 - scores page: save bar vs bottom nav, dropdown flicker");
  await studentDropdownTests();
  await subjectDropdownTests();
  await saveBarTests();
  stackingTests();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.error("test crashed:", err);
  process.exit(1);
});
