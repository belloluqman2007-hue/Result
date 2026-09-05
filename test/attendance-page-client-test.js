/* ==========================================================================
   test/attendance-page-client-test.js  (NEW - pack 108)

   Runs the two browser files in a VM with a tiny fake DOM + fake fetch and
   asserts the behaviour the owner is missing:
     * the Mark Register NEVER ends up empty because of one bad answer -
       the class list is drawn from /students instead, with the server's own
       sentence above it;
     * a 401 still goes to the login page (a lost login is never faked);
     * an X-AMS-Notice from the server is shown but the pupils still render;
     * csrf.js: idempotent GETs are retried on a 500/502/503/504 answer and
       on a dropped transport, writes are sent exactly once, the session
       cookie is always forwarded, exempt paths match on absolute URLs too.

   node test/attendance-page-client-test.js
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

/* ------------------------------- fake DOM -------------------------------- */
function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(), children: [], _text: "", _html: "",
    style: { cssText: "" }, colSpan: 0, className: "", title: "", type: "", value: "",
    attrs: {}, listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    click() { (this.listeners.click || []).forEach(function (f) { f(); }); },
    querySelectorAll(sel) { return walk(this).filter(function (n) { return n.className && n.className.indexOf(String(sel).replace(".", "")) !== -1; }); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    get innerText() { return this._text; }
  };
  return el;
}
function walk(node, out) {
  out = out || [];
  (node.children || []).forEach(function (c) { out.push(c); walk(c, out); });
  return out;
}
function makeDocument(ids) {
  const byId = {};
  Object.keys(ids).forEach(function (k) { byId[k] = ids[k](); });
  return {
    byId: byId,
    getElementById: function (id) { return byId[id] || null; },
    createElement: makeEl,
    querySelector: function (sel) { return sel === "#attTable tbody" ? byId.__tbody : (byId[String(sel).replace(/^#/, "").replace(/\..*$/, "")] || null); },
    addEventListener: function () {}
  };
}

function fakeResponse(status, body, headers) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status: status,
    headers: { get: function (n) { return (headers || {})[n] || null; } },
    json: function () { return typeof body === "string" ? Promise.reject(new Error("not json")) : Promise.resolve(body); },
    text: function () { return Promise.resolve(text); },
    body: null
  };
}

/* ============================ csrf.js wrapper ============================= */
async function csrfTests() {
  console.log("\ncsrf.js - the fetch wrapper");
  const ctx = vm.createContext({
    console: { warn: function () {}, log: function () {}, error: function () {} },
    setTimeout: function (fn) { return setTimeout(fn, 0); },
    setInterval: function () { return 0; },
    URL: URL, document: { addEventListener: function () {} }
  });
  ctx.window = ctx;
  ctx.__handler = function () { return Promise.resolve(fakeResponse(200, {})); };
  // window.fetch is what the module captures as its "native" fetch; every
  // test only swaps __handler, so the wrapper under test stays the real one.
  ctx.fetch = function (url, options) { return ctx.__handler(url, options); };
  vm.runInContext(fs.readFileSync(path.join(REPO, "js/csrf.js"), "utf8"), ctx, { filename: "js/csrf.js" });

  function install(handler) { ctx.__handler = handler; }

  // 1. a 500 GET is retried (a read is safe to repeat) and the 200 wins
  {
    let n = 0; const seen = [];
    install(function (url) {
      n++; seen.push(String(url));
      return Promise.resolve(n < 3 ? fakeResponse(500, { message: "Database error" }) : fakeResponse(200, [{ student_id: "A101", status: "absent" }]));
    });
    const res = await ctx.window.fetch("/attendance/class?class_name=SS%201&date=2026-09-05", { method: "GET" });
    ok(n === 3, "a GET that answers 500 is retried until it succeeds (attempts: " + n + ")");
    ok(res.status === 200, "the successful 200 answer is what the page receives");
    ok(seen.every(function (u) { return u.indexOf("/attendance/class") === 0; }), "every retry re-asks the same read-only URL");
  }

  // 2. transport failure (the net::ERR_QUIC_PROTOCOL_ERROR case) recovers
  {
    let n = 0;
    install(function () {
      n++;
      if (n < 2) { const e = new TypeError("Failed to fetch"); e.name = "NetworkError"; return Promise.reject(e); }
      return Promise.resolve(fakeResponse(200, []));
    });
    const res = await ctx.window.fetch("/attendance/class?class_name=X&date=2026-09-05", {});
    ok(n === 2 && res.status === 200, "a dropped QUIC stream is retried once and the register then loads (attempts: " + n + ")");
  }

  // 3. POST is never retried, and it carries the token + the session cookie
  {
    const seen = [];
    install(function (url, options) {
      seen.push({ url: String(url), o: options, st: 200 });
      if (String(url) === "/api/csrf-token") return Promise.resolve(fakeResponse(200, { csrfToken: "tok-77" }));
      return Promise.resolve(fakeResponse(500, { message: "Database error" }));
    });
    const res = await ctx.window.fetch("/attendance/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const post = seen.filter(function (x) { return x.url === "/attendance/save"; })[0];
    ok(seen.filter(function (x) { return x.url === "/attendance/save"; }).length === 1,
      "POST /attendance/save is sent exactly once (writes are never retried)", JSON.stringify(seen.map(function (x) { return x.url; })));
    ok(post && post.o.headers["x-csrf-token"], "the CSRF token is attached to the save");
    ok(post && post.o.credentials === "same-origin", "the session cookie is forwarded on writes");
    ok(res.status === 500, "a failed save is handed to the page untouched, not swallowed");
  }

  // 4. exempt paths for absolute URLs, and credentials on plain reads
  {
    const seen = [];
    install(function (url, options) { seen.push({ url: String(url), o: options }); return Promise.resolve(fakeResponse(200, {})); });
    await ctx.window.fetch("/api/distinct-classes", {});
    ok(seen[0] && seen[0].o.credentials === "same-origin", "authenticated reads carry the session cookie");
    let tokenFetches = 0;
    install(function (url) {
      if (String(url) === "/api/csrf-token") { tokenFetches++; return Promise.resolve(fakeResponse(200, { csrfToken: "t" })); }
      seen.push({ url: String(url), o: {} });
      return Promise.resolve(fakeResponse(200, { ok: true }));
    });
    await ctx.window.fetch("https://result-cfn8.onrender.com/login", { method: "POST", body: "{}" });
    ok(tokenFetches === 0, "an absolute https://site/login URL is still recognised as exempt (no token round-trip)");
  }

  // 5. double-include safety: wrapping twice must not double-send
  {
    let n = 0;
    install(function () { n++; return Promise.resolve(fakeResponse(200, {})); });
    vm.runInContext(fs.readFileSync(path.join(REPO, "js/csrf.js"), "utf8"), ctx, { filename: "js/csrf.js (second include)" });
    await ctx.window.fetch("/students", {});
    ok(n === 1, "including csrf.js twice cannot wrap fetch twice (requests sent: " + n + ")");
  }
}

/* ========================== js/attendance.js ============================== */
function loadAttendance(fetchImpl) {
  const tbody = makeEl("tbody");
  const els = {
    attMsg: function () { return makeEl("div"); },
    attClass: function () { const e = makeEl("select"); e.value = "SS  1"; return e; },
    attDate: function () { const e = makeEl("input"); e.value = "2026-09-05"; return e; },
    attTaken: function () { const e = makeEl("div"); e.classList = { add: function () {}, remove: function () {} }; return e; },
    attTakenText: function () { return makeEl("span"); },
    attRepFrom: function () { return makeEl("input"); },
    attRepTo: function () { return makeEl("input"); },
    attStuPick: function () { const e = makeEl("select"); e.value = ""; return e; },
    attStuSummary: function () { return makeEl("div"); },
    attAbsPanel: function () { const e = makeEl("div"); e.style = { display: "" }; return e; }
  };
  const doc = makeDocument(els);
  doc.byId.__tbody = tbody;
  const redirects = [];
  const ctx = vm.createContext({
    console: console, setTimeout: function (fn) { return setTimeout(fn, 0); }, setInterval: function () { return 0; },
    document: doc, window: { location: { href: "attendance.html", assign: function (u) { redirects.push(u); }, reload: function () {} } },
    fetch: fetchImpl, encodeURIComponent: encodeURIComponent, JSON: JSON, Promise: Promise,
    String: String, Number: Number, Array: Array, Object: Object, Date: Date, Math: Math, Error: Error,
    isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, RegExp: RegExp, Function: Function, Boolean: Boolean
  });
  ctx.window.document = doc;
  vm.runInContext(fs.readFileSync(path.join(REPO, "js/attendance.js"), "utf8"), ctx, { filename: "js/attendance.js" });
  return { ctx: ctx, tbody: tbody, doc: doc, redirects: redirects };
}
/* Everything the fake DOM holds as text: TD text, <b> names inside cells,
   the HTML of rows written through tbody.innerHTML, and <option> labels. */
function rowTexts(tbody) {
  const out = [];
  if (tbody._html) out.push(String(tbody._html));
  walk(tbody).forEach(function (n) {
    if (n._text) out.push(String(n._text));
    if (n._html) out.push(String(n._html));
  });
  return out;
}

async function attendanceTests() {
  console.log("\njs/attendance.js - the Mark Register page");

  // A. the reported case: register 500s, the class list still has the pupils
  {
    const urls = [];
    const env = loadAttendance(function (url, options) {
      urls.push(String(url));
      if (String(url).indexOf("/attendance/class") === 0) {
        return Promise.resolve(fakeResponse(500, { message: "Could not load the class list from the students table - database said: Unknown column 'a.class_name' in 'field list'" }));
      }
      if (String(url).indexOf("/students?status=active") === 0) return Promise.resolve(fakeResponse(200, []));
      if (String(url).indexOf("/students") === 0) {
        return Promise.resolve(fakeResponse(200, [
          { student_id: "A101", full_name: "Aisha Bello", class_name: "SS  1", status: "active" },
          { student_id: "A102", full_name: "Bilal Yusuf", class_name: "SS 1", status: "active" },
          { student_id: "A104", full_name: "Idris Farouk", class_name: "SS 1", status: "withdrawn" }
        ]));
      }
      if (String(url).indexOf("/attendance/summary") === 0) return Promise.resolve(fakeResponse(200, { taken: false }));
      return Promise.resolve(fakeResponse(200, {}));
    });
    await new Promise(function (r) { setTimeout(r, 30); });
    env.ctx.loadRegister();
    await new Promise(function (r) { setTimeout(r, 60); });
    const texts = rowTexts(env.tbody);
    ok(texts.indexOf("Aisha Bello") !== -1 && texts.indexOf("Bilal Yusuf") !== -1,
      "recovery: the pupils ARE displayed even though /attendance/class answered 500", texts.join("|"));
    ok(texts.indexOf("Idris Farouk") === -1, "recovery: withdrawn pupils stay out of the register");
    ok(texts.some(function (t) { return /could not be read/i.test(t); }),
      "recovery: the row above the list explains what happened instead of hiding it");
    ok(texts.some(function (t) { return t === "A101"; }), "recovery: the admission numbers are there, so the marks save against the right pupil");
    ok(JSON.stringify(env.ctx.attState) === '{"A101":"present","A102":"present"}',
      "recovery: everyone defaults to Present and is ready to correct", JSON.stringify(env.ctx.attState));
    ok(urls.some(function (u) { return u.indexOf("/students?status=active") === 0; }),
      "recovery: the fallback also survives a missing status column (it retried the plain /students list)");
  }

  // B. healthy answer: saved marks restored, notice shown
  {
    const env = loadAttendance(function (url) {
      if (String(url).indexOf("/attendance/class") === 0) {
        return Promise.resolve(fakeResponse(200,
          [{ student_id: "A101", full_name: "Aisha Bello", status: "absent" }, { student_id: "A102", full_name: "Bilal Yusuf", status: "present" }],
          { "X-AMS-Notice": "Marks saved earlier could not be read - everyone starts as Present." }));
      }
      if (String(url).indexOf("/attendance/summary") === 0) return Promise.resolve(fakeResponse(200, { taken: false }));
      return Promise.resolve(fakeResponse(200, []));
    });
    env.ctx.loadRegister();
    await new Promise(function (r) { setTimeout(r, 60); });
    const texts = rowTexts(env.tbody);
    ok(texts.indexOf("Aisha Bello") !== -1, "normal: the register renders from the server rows");
    ok(JSON.stringify(env.ctx.attState) === '{"A101":"absent","A102":"present"}', "normal: the saved marks come back selected", JSON.stringify(env.ctx.attState));
    ok(texts.some(function (t) { return /could not be read/i.test(t); }), "normal: X-AMS-Notice from the server is shown to the teacher");
  }

  // C. expired login is never faked into a register
  {
    const env = loadAttendance(function (url) {
      if (String(url).indexOf("/attendance/class") === 0) return Promise.resolve(fakeResponse(401, { message: "Not logged in" }));
      return Promise.resolve(fakeResponse(200, [{ student_id: "A101", full_name: "Aisha Bello", class_name: "SS 1", status: "active" }]));
    });
    env.ctx.loadRegister();
    await new Promise(function (r) { setTimeout(r, 80); });
    const texts = rowTexts(env.tbody);
    ok(!texts.some(function (t) { return t === "Aisha Bello"; }), "401: no pretend register is drawn from the class list");
    ok(/login session expired/i.test(String(env.tbody.innerHTML)), "401: the teacher is told to log in again", String(env.tbody.innerHTML).slice(0, 120));
  }

  // D. an empty class says so in words, and HTML from the server is escaped
  {
    const env = loadAttendance(function (url) {
      if (String(url).indexOf("/attendance/class") === 0) return Promise.resolve(fakeResponse(200, [], { "X-AMS-Notice": 'Try <img src=x onerror="pwned()"> again' }));
      return Promise.resolve(fakeResponse(200, []));
    });
    env.ctx.loadRegister();
    await new Promise(function (r) { setTimeout(r, 60); });
    const html = String(env.tbody.innerHTML || "");
    ok(/Try .* again/.test(html), "empty class: the server's own sentence is what the teacher reads", html.slice(0, 120));
    ok(html.indexOf("<img") === -1 && html.indexOf("&lt;img") !== -1,
      "server text is HTML-escaped (no markup can ride in through a database error)", html.slice(0, 120));
  }
}

(async function main() {
  await csrfTests();
  await attendanceTests();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
