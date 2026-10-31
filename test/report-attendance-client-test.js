/* ==========================================================================
   test/report-attendance-client-test.js  (NEW - report-sheet attendance)

   Loads the REAL js/report-card.js and js/result.js in a vm sandbox with
   a minimal DOM and proves:
     1. the built report sheet (portal + class ZIP) prints the attendance
        row with the term's figures, and "-" when there is no record;
     2. amsFetchReportPack fetches /report-attendance with the report
        row's own student_id/class spelling, and a failed attendance
        fetch can never sink the whole report;
     3. STRICTLY ONE PAGE: a canvas far taller than A4 still becomes a
        ONE-page PDF under forceSinglePage (the mode every report
        download uses), and the print fit-zoom shrinks an over-tall
        sheet to the new 1005px safety target;
     4. the staff Check Result page (js/result.js) words the attendance
        exactly like the shared builder.

     node test/report-attendance-client-test.js
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log("  ok   - " + label); }
  else { failed++; console.log("  FAIL - " + label); }
}

/* ------------------------------ fake DOM ------------------------------- */
let stubHeight = 900; // what the measurement clone reports
function makeEl(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    className: "", id: "", innerHTML: "", textContent: "",
    style: { setProperty: function () {}, removeProperty: function () {} },
    children: [],
    appendChild: function (c) { this.children.push(c); return c; },
    remove: function () {},
    querySelectorAll: function () { return []; },
    getBoundingClientRect: function () { return { height: stubHeight, width: 718 }; },
    cloneNode: function () { const c = makeEl(tag); c.innerHTML = this.innerHTML; return c; },
    set cssText(v) { this._css = v; }, get cssText() { return this._css || ""; }
  };
  if (el.tagName === "CANVAS") {
    el.width = 0; el.height = 0;
    el.getContext = function () { return { drawImage: function () {}, getImageData: function () { return { data: new Array(4).fill(255) }; } }; };
    el.toDataURL = function () { return "data:image/jpeg;base64,AA=="; };
  }
  return el;
}
function makeDocument() {
  return {
    createElement: function (tag) { return makeEl(tag); },
    body: makeEl("body"),
    documentElement: makeEl("html"),
    getElementById: function () { return null; },
    querySelectorAll: function () { return []; }
  };
}

/* ------------------------------- sandbox ------------------------------- */
const ROWS = [
  { student_id: "AM101", student_name: "Bello Adebayo", class_name: "SS 1", subject: "Mathematics", grade: "A", total: 85, exam_score: 55, ca_score: 30 },
  { student_id: "AM101", student_name: "Bello Adebayo", class_name: "SS 1", subject: "English", grade: "B", total: 70, exam_score: 45, ca_score: 25 }
];
const ATT = { available: true, present: 57, absent: 3, late: 1, marked: 61, attended: 58, school_days: 62, percentage: 94 };

let attendanceShouldFail = false;
const fetchedUrls = [];
function stubFetch(url) {
  fetchedUrls.push(String(url));
  const json = function (v) { return { ok: true, json: function () { return Promise.resolve(v); } }; };
  const u = String(url);
  if (u.indexOf("/report-attendance/") === 0) {
    if (attendanceShouldFail) return Promise.reject(new Error("network down"));
    return Promise.resolve(json(ATT));
  }
  if (u.indexOf("/search-result/") === 0) return Promise.resolve(json(ROWS));
  if (u.indexOf("/student-position/") === 0) return Promise.resolve(json({ position: 2 }));
  if (u.indexOf("/student/") === 0) return Promise.resolve(json([{ student_id: "AM101", class_name: "SS 1", photo_path: "" }]));
  if (u === "/signatures" || u === "/class-signatures") return Promise.resolve(json([]));
  if (u === "/me") return Promise.resolve(json({ loggedIn: false }));
  return Promise.resolve(json([]));
}

function loadScript(file, extra) {
  const sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, fetch: stubFetch,
    document: makeDocument(),
    addEventListener: function () {}
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  Object.assign(sandbox, extra || {});
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(REPO, file), "utf8"), sandbox, { filename: file });
  return sandbox;
}

/* -------------------------------- tests -------------------------------- */
async function main() {
  /* ---- js/report-card.js: rendering ---- */
  const rc = loadScript("js/report-card.js", {
    jspdf: {
      jsPDF: function () {
        this.pages = 1;
        this.addImage = function () {};
        this.addPage = function () { this.pages++; };
      }
    }
  });

  const pack = { rows: ROWS, student: null, position: 2, signatures: [], classSignatures: [], attendance: ATT };
  const card = rc.amsBuildReportCard(pack, "1st Term", "2025/2026");
  ok(card.innerHTML.indexOf("Attendance:") !== -1, "built report sheet carries an Attendance row");
  ok(card.innerHTML.indexOf("94% (58 of 62 days)") !== -1,
    "attendance reads '94% (58 of 62 days)' (cell found: " + (card.innerHTML.indexOf("94% (58 of 62 days)") !== -1) + ")");
  ok(card.innerHTML.indexOf("Absent / Late:") !== -1 && card.innerHTML.indexOf(">3 / 1<") !== -1,
    "absent/late reads '3 / 1'");

  const noAtt = rc.amsBuildReportCard({ rows: ROWS, student: null, position: 2, signatures: [], classSignatures: [], attendance: null }, "1st Term", "2025/2026");
  ok(noAtt.innerHTML.indexOf("Attendance:") !== -1 && noAtt.innerHTML.indexOf("of 62 days") === -1,
    "no attendance record -> row still present, figures shown as '-'");

  /* FIX (report-search repair): rows stored with class_name NULL made
     first.class_name.includes() throw, so the portal said "Network
     error" and the ZIP skipped the pupil. The builder must now shrug
     and fall back to the primary report-level label. */
  const nullClassRows = ROWS.map(function (r) { return Object.assign({}, r, { class_name: null }); });
  let nullThrew = false, nullCard = null;
  try {
    nullCard = rc.amsBuildReportCard({ rows: nullClassRows, student: null, position: 2, signatures: [], classSignatures: [], attendance: ATT }, "1st Term", "2025/2026");
  } catch (e) { nullThrew = true; }
  ok(!nullThrew && nullCard && nullCard.innerHTML.indexOf("Mathematics") !== -1,
    "rows with NULL class_name still build a full report sheet");

  /* ---- js/report-card.js: pack fetch ---- */
  fetchedUrls.length = 0;
  const fetched = await rc.amsFetchReportPack("am101", "1st Term", "2025/2026"); // hand-typed lower-case id
  ok(fetched.attendance && fetched.attendance.percentage === 94, "amsFetchReportPack returns the attendance summary");
  const attUrl = fetchedUrls.filter(function (u) { return u.indexOf("/report-attendance/") === 0; })[0] || "";
  ok(attUrl.indexOf("/report-attendance/AM101?") === 0,
    "attendance is fetched with the result row's own student_id spelling (" + attUrl + ")");
  ok(attUrl.indexOf("term=1st%20Term") !== -1 && attUrl.indexOf("session=2025%2F2026") !== -1 && attUrl.indexOf("className=SS%201") !== -1,
    "attendance URL carries term + session + className");

  attendanceShouldFail = true;
  const stillBuilt = await rc.amsFetchReportPack("AM101", "1st Term", "2025/2026");
  attendanceShouldFail = false;
  ok(stillBuilt.rows.length === 2 && stillBuilt.attendance === null,
    "a failed attendance fetch leaves the report itself untouched (attendance: null)");

  /* ---- STRICTLY ONE PAGE: PDF ---- */
  const tallCanvas = { width: 1588, height: 9000, toDataURL: function () { return "data:image/jpeg;base64,AA=="; } };
  const onePage = rc.amsCanvasToA4Pdf(tallCanvas, 0.95, null, true, { margin: 10 });
  ok(onePage.pages === 1, "forceSinglePage: a 9000px-tall report canvas becomes a ONE-page PDF (pages: " + onePage.pages + ")");
  const manyPages = rc.amsCanvasToA4Pdf(tallCanvas, 0.95, null, false, { margin: 10 });
  ok(manyPages.pages > 1, "control: without forceSinglePage the same canvas slices to " + manyPages.pages + " pages - the flag is the guarantee");

  /* ---- STRICTLY ONE PAGE: print fit-zoom ---- */
  const src = makeEl("div");
  stubHeight = 2010; // a sheet twice the printable height
  const zoom = rc.amsFitPrintZoomSync(src);
  ok(Math.abs(zoom - 1005 / 2010) < 1e-9, "over-tall sheet zooms to the 1005px safety target (zoom " + zoom + ")");
  stubHeight = 900; // already fits
  ok(rc.amsFitPrintZoomSync(src) === 1, "a sheet that fits keeps zoom 1 (design untouched)");
  stubHeight = 1100; // fits under the old 1030px line? No: 1100 > 1030 too.
  const z3 = rc.amsFitPrintZoomSync(src);
  ok(z3 < 1030 / 1100 && z3 > 0, "the new target is stricter than the old 1030px one (zoom " + z3.toFixed(3) + " < " + (1030 / 1100).toFixed(3) + ")");

  /* ---- js/result.js: identical wording on the staff page ---- */
  const rj = loadScript("js/result.js");
  const t = rj.amsAttendanceText(ATT);
  ok(t.main === "94% (58 of 62 days)" && t.absentLate === "3 / 1",
    "Check Result page words attendance identically ('" + t.main + "', '" + t.absentLate + "')");
  const t0 = rj.amsAttendanceText(null);
  ok(t0.main === "-" && t0.absentLate === "-", "no record -> '-' on the Check Result page too");

  /* ---- print CSS hard cap really is in the shipped stylesheet ---- */
  const css = fs.readFileSync(path.join(REPO, "css", "style.css"), "utf8");
  const printBlock = css.slice(css.indexOf("@media print"));
  ok(/#reportContainer\{[^}]*max-height:276mm[^}]*overflow:hidden/.test(printBlock),
    "print stylesheet hard-caps #reportContainer at 276mm with overflow hidden (one page, always)");
  ok(!/margin-bottom:30px/.test(printBlock) && /margin-bottom:8px !important/.test(printBlock),
    "print signature strip no longer inherits the 30px screen bottom margin");

  /* ---- the staff page markup carries the cells the script fills ---- */
  const html = fs.readFileSync(path.join(REPO, "student-result.html"), "utf8");
  ok(html.indexOf('id="studentAttendance"') !== -1 && html.indexOf('id="studentAbsentLate"') !== -1,
    "student-result.html has the attendance cells inside the report sheet");

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error("HARNESS ERROR:", (e && e.stack) || e);
  process.exit(1);
});
