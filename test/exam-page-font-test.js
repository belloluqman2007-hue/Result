/* ==========================================================================
   test/exam-page-font-test.js
   (NEW - per-page font size / spacing + selected-word sizing + quick save)

   Owner, verbatim:
     "put save icon on the exam space to be easily to access

      And in the font size and spacing must be working differently for each
      page not I will change font from a page and every other written exam
      will change and between the exam I must be able to enlarge some words
      within the exam written not everything will be charging together

      And I think it should be working independently and when selected on

      Fix and merge"

   WHAT WAS WRONG (reproduced here against the real js/exam.js):

   1. ONE font size for the WHOLE booklet.
      applyExamFontFrom() looped over EVERY `#examFlow .exam-body` and
      forced the same size on all of them, and setSpacing() did the same for
      spacing. Writing exam 3 and touching "Font Size" restyled every page of
      exam 1 and exam 2 as well.

   2. ONE spacing for the WHOLE booklet, and on a device without Sakkal
      Majalla `css/exam.css` tied the font size to the spacing class
      (.no-sakkal .exam-body.spacing-compact = 10pt, etc.), so the size
      picker could never win.

   3. Enlarging SELECTED words did not work at all:
        - the toolbar used document.execCommand("fontSize", 1..7) and
          <font size="6"> is 24pt - SMALLER than the 32pt paper text;
        - tapping the <select> dropped the highlight, so nothing was sized;
        - the next page-size change stripped every inline font-size, wiping
          the enlarged words.

   WHAT THIS TEST PROVES (real create-exam.html + real js/exam.js in jsdom):

     A. a floating save icon exists on the exam space (top-right), next to
        the Step 1/Step 2/Exam Space saves, and Ctrl/Cmd+S saves too
     B. a blank title is auto-filled on a one-tap save, a missing detail
        opens Step 1 instead of failing silently, and an empty paper still
        saves with non-empty body_html
     C. changing the font size on one page changes ONLY that page - every
        other page (and the other exam in the booklet) keeps its own size
     D. spacing works per page the same way
     E. each page stores its own data-page-font-pt / data-page-spacing and
        those travel inside the saved HTML (so a reload keeps the look)
     F. selecting words and pressing A+ enlarges ONLY those words, keeps the
        highlight, and the words survive a later page-size change (ratio kept)
     G. A- shrinks, A-reset returns the words to the page size
     H. the CSS no longer couples spacing classes to !important font sizes,
        and a paragraph cannot flatten a selected word

   node test/exam-page-font-test.js
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  ok   - " + label); }
  else { fail++; console.log("  FAIL - " + label + (extra ? "   [" + extra + "]" : "")); }
}

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = null; }

const PAGE_H = 1123;
const ZONE_H = 1000;

function bootExam() {
  const html = fs.readFileSync(path.join(REPO, "create-exam.html"), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/create-exam.html"
  });
  const w = dom.window, d = w.document;

  w.fetch = function () {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } });
  };
  w.alert = function () {};
  w.confirm = function () { return true; };
  w.scrollTo = function () {};
  w.HTMLElement.prototype.scrollIntoView = function () {};

  Object.defineProperty(w.HTMLElement.prototype, "offsetWidth", {
    get: function () { return 794; }, configurable: true
  });
  Object.defineProperty(w.HTMLElement.prototype, "offsetHeight", {
    get: function () {
      if (this.classList && this.classList.contains("exam-page")) return PAGE_H;
      if (this.tagName === "P") return parseFloat(this.getAttribute("data-h") || "100");
      if (this.classList && this.classList.contains("page-content")) return ZONE_H;
      return 10;
    },
    configurable: true
  });
  w.getComputedStyle = function (el) {
    return {
      marginTop: "0px",
      marginBottom: "0px",
      fontSize: (el && el.style && el.style.fontSize) ? el.style.fontSize : "32pt"
    };
  };

  w.eval(fs.readFileSync(path.join(REPO, "js", "exam.js"), "utf8"));
  w.initExam();
  w.paginateExam();
  return { w: w, d: d, flow: d.getElementById("examFlow") };
}

/* Build a booklet: `exams` sections, each with `pages` question pages.
   A manual page break starts every page after the first, because that is
   the only way the engine deliberately keeps several pages in one exam
   (without a break an exam is auto-fitted onto a single page). */
function buildBooklet(ctx, exams, pages) {
  const flow = ctx.flow;
  flow.innerHTML = "";
  for (let e = 0; e < exams; e++) {
    const cover = ctx.d.createElement("div");
    cover.className = "exam-page page-one";
    if (e === 0) cover.id = "coverPage";
    flow.appendChild(cover);
    for (let p = 0; p < pages; p++) {
      const page = ctx.d.createElement("div");
      page.className = "exam-page body-page";
      const zone = ctx.d.createElement("div");
      zone.className = "page-content exam-body";
      if (p > 0) {
        const marker = ctx.d.createElement("div");
        marker.className = "manual-page-break";
        marker.setAttribute("data-break", "1");
        zone.appendChild(marker);
      }
      const para = ctx.d.createElement("p");
      para.setAttribute("data-h", "100");
      para.textContent = "EXAM" + (e + 1) + " PAGE" + (p + 1);
      zone.appendChild(para);
      page.appendChild(zone);
      flow.appendChild(page);
    }
  }
  ctx.w.paginateExam();
  return Array.from(flow.querySelectorAll(".exam-page.body-page"));
}

/* The page's pickers are wired with inline `onchange="..."` attributes. jsdom
   in "outside-only" mode never compiles those, so the tests call the very same
   global the browser would call - the logic under test is untouched. */
function pickFont(ctx, id, value) {
  ctx.d.getElementById(id).value = value;
  ctx.w.applyExamFontFrom(value, ctx.d.getElementById(
    id === "examFontSelectTools" ? "examFontSelect" : "examFontSelectTools"));
}

function zoneOf(page) { return page.querySelector(".page-content"); }
function ptOf(page) { return zoneOf(page).getAttribute("data-page-font-pt"); }
function spacingOf(page) { return zoneOf(page).getAttribute("data-page-spacing"); }

function selectRange(ctx, node, start, end) {
  const r = ctx.d.createRange();
  if (typeof start === "number") { r.setStart(node, start); r.setEnd(node, end); }
  else { r.selectNodeContents(node); }
  const sel = ctx.w.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return r;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  console.log("\n[1] the exam space has an easy-to-reach Save icon");

  {
    const ctx = bootExam();
    const btn = ctx.d.getElementById("examQuickSaveBtn");
    ok(!!btn, "a floating quick-save button exists on the exam space");
    ok(!!btn && btn.getAttribute("onclick") === "saveExam()",
      "the floating icon calls saveExam() directly (one tap, no menu)");
    ok(!!btn && /save/i.test(btn.getAttribute("title") || ""),
      "it explains itself (title mentions Save)");

    const html = fs.readFileSync(path.join(REPO, "create-exam.html"), "utf8");
    ok((html.match(/class="exam-save-btn"/g) || []).length >= 3,
      "Save is also a button in Step 1, Step 2 and the Exam Space panel",
      String((html.match(/class="exam-save-btn"/g) || []).length));

    const css = fs.readFileSync(path.join(REPO, "css", "exam.css"), "utf8");
    ok(/\.exam-quick-save\{[^}]*position:fixed/.test(css),
      "the floating save is fixed on screen while the teacher scrolls");
    ok(/\.exam-quick-save\{[^}]*top:12px/.test(css) &&
       /\.exam-quick-save\{[^}]*right:14px/.test(css),
      "it sits in the top-right corner (the only corner the other chrome leaves free)");
    ok(/@media print\{\s*\.exam-quick-save\{ display:none !important; \}/.test(css),
      "it is never printed onto the paper");
    ok(/\.ams-capturing \.exam-quick-save\{ display:none !important; \}/.test(css),
      "it is never captured into the downloaded PDF");
    ok(/key === "s" \|\| e.key === "S"/.test(fs.readFileSync(path.join(REPO, "js", "exam.js"), "utf8")),
      "Ctrl/Cmd+S saves the exam too");
    ctx.w.close();
  }

  console.log("\n[2] one-tap save is forgiving (so the icon always works)");

  {
    const ctx = bootExam();
    const posts = [];
    ctx.w.fetch = function (url, opts) {
      if (String(url).indexOf("/save-exam") !== -1) {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ id: 42, message: "Draft saved" }); } });
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } });
    };

    const cs = ctx.d.getElementById("examClass");
    cs.innerHTML = '<option value="SS 1">SS 1</option>'; cs.value = "SS 1";
    const ss = ctx.d.getElementById("examSubject");
    ss.innerHTML = '<option value="Tajweed">Tajweed</option>'; ss.value = "Tajweed";
    ctx.d.getElementById("examTerm").value = "2nd Term";
    ctx.d.getElementById("examSession").value = "2025/2026";
    ctx.d.getElementById("examTitle").value = "";
    zoneOf(ctx.flow.querySelector(".body-page")).innerHTML = "<p>Q1</p><p>Q2</p>";

    ctx.w.saveExam();
    await sleep(300);
    ok(posts.length === 1, "a save really is sent with a blank title", String(posts.length));
    ok(posts[0] && posts[0].title === "2nd Term Exam - Tajweed",
      "the blank title is auto-filled from the details already chosen",
      posts[0] && posts[0].title);
    ok(posts[0] && posts[0].body_html.indexOf("Q2") !== -1,
      "the questions travel with it", posts[0] && posts[0].body_html.slice(0, 40));
    ok(ctx.d.getElementById("examQuickSaveLabel").textContent.indexOf("Saved") !== -1,
      "the floating icon reports success ('Saved')",
      ctx.d.getElementById("examQuickSaveLabel").textContent);

    // A fresh paper: no blocks at all -> must still save (server rejects "").
    const ctx2 = bootExam();
    const posts2 = [];
    ctx2.w.fetch = function (url, opts) {
      if (String(url).indexOf("/save-exam") !== -1) {
        posts2.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ id: 7, message: "Draft saved" }); } });
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } });
    };
    const cs2 = ctx2.d.getElementById("examClass");
    cs2.innerHTML = '<option value="SS 2">SS 2</option>'; cs2.value = "SS 2";
    const ss2 = ctx2.d.getElementById("examSubject");
    ss2.innerHTML = '<option value="Fiqh">Fiqh</option>'; ss2.value = "Fiqh";
    ctx2.d.getElementById("examTerm").value = "1st Term";
    ctx2.d.getElementById("examSession").value = "2025/2026";
    ctx2.d.getElementById("examTitle").value = "";
    ctx2.flow.querySelectorAll(".page-content").forEach(function (z) { z.innerHTML = ""; });
    ctx2.w.saveExam();
    await sleep(300);
    ok(posts2.length === 1, "an empty paper still saves", String(posts2.length));
    ok(posts2[0] && posts2[0].body_html && posts2[0].body_html.length > 0,
      "an empty paper is sent with non-empty body_html (no server 400)",
      posts2[0] && JSON.stringify(posts2[0].body_html));

    // Missing details -> Step 1 opens, nothing is sent.
    const ctx3 = bootExam();
    let sent3 = 0;
    ctx3.w.fetch = function (url) {
      if (String(url).indexOf("/save-exam") !== -1) { sent3++; }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } });
    };
    ctx3.w.examGotoStep(1);
    ctx3.w.saveExam();
    await sleep(150);
    ok(sent3 === 0, "a save with no details does not hit the server");
    ok(ctx3.d.getElementById("examStep1").style.display !== "none",
      "…and Step 1 (with the missing fields) is put in front of the teacher");
    ok(ctx3.d.getElementById("examQuickSaveLabel").textContent === "Not saved",
      "the floating icon says 'Not saved'",
      ctx3.d.getElementById("examQuickSaveLabel").textContent);
    ctx.w.close(); ctx2.w.close(); ctx3.w.close();
  }

  console.log("\n[3] font size changes ONE page - never the other page or exam");

  {
    const ctx = bootExam();
    const pages = buildBooklet(ctx, 2, 2); // exam 1 (2 pages) + exam 2 (2 pages)
    ok(pages.length === 4, "booklet built: 2 exams x 2 question pages", String(pages.length));

    // Write on exam 1 / page 2 and pick 40pt.
    const target = pages[1];
    selectRange(ctx, zoneOf(target).querySelector("p"));
    ctx.w.noteActiveBodyPage(target);
    pickFont(ctx, "examFontSelectTools", "40");

    ok(ptOf(pages[0]) !== "40" && ptOf(pages[1]) === "40" &&
       ptOf(pages[2]) !== "40" && ptOf(pages[3]) !== "40",
      "only the page being written on went to 40pt",
      pages.map(ptOf).join(" / "));
    ok(ptOf(pages[2]) !== ptOf(pages[1]) && ptOf(pages[3]) !== ptOf(pages[1]),
      "the other exam in the same booklet was NOT resized",
      ptOf(pages[2]) + " / " + ptOf(pages[3]));

    // Now page 1 of exam 1 -> 22pt; the others must stay exactly as they were.
    const before = pages.map(ptOf).join(",");
    selectRange(ctx, zoneOf(pages[0]).querySelector("p"));
    ctx.w.noteActiveBodyPage(pages[0]);
    pickFont(ctx, "examFontSelectTools", "22");
    const after = pages.map(ptOf).join(",");
    ok(ptOf(pages[0]) === "22", "page 1 is now 22pt", ptOf(pages[0]));
    ok(ptOf(pages[1]) === "40", "page 2 kept its own 40pt", ptOf(pages[1]));
    ok(before !== after && ptOf(pages[2]) === "32" && ptOf(pages[3]) === "32",
      "exam 2's pages never moved (still 32pt)", ptOf(pages[2]) + " / " + ptOf(pages[3]));

    // A second change on exam 2 must not touch exam 1.
    selectRange(ctx, zoneOf(pages[3]).querySelector("p"));
    ctx.w.noteActiveBodyPage(pages[3]);
    pickFont(ctx, "examFontSelect", "36");
    ok(ptOf(pages[3]) === "36", "exam 2 page 2 went to 36pt", ptOf(pages[3]));
    ok(ptOf(pages[0]) === "22" && ptOf(pages[1]) === "40" && ptOf(pages[2]) === "32",
      "exam 1 kept 22pt / 40pt / and its second page 32pt",
      [ptOf(pages[0]), ptOf(pages[1]), ptOf(pages[2])].join(" / "));

    // Pagination (typing) must not stamp one size over every page again.
    ctx.w.paginateExam();
    ok(ptOf(pages[0]) === "22" && ptOf(pages[1]) === "40" && ptOf(pages[3]) === "36",
      "a full re-layout keeps every page's own size",
      pages.map(ptOf).join(" / "));
    ctx.w.close();
  }

  console.log("\n[4] spacing changes ONE page - never the other page or exam");

  {
    const ctx = bootExam();
    const pages = buildBooklet(ctx, 2, 2);
    selectRange(ctx, zoneOf(pages[1]).querySelector("p"));
    ctx.w.noteActiveBodyPage(pages[1]);
    ctx.d.getElementById("spacingSelect").value = "spacious";
    ctx.w.setSpacing();   // the inline onchange="setSpacing()" handler, called directly

    ok(spacingOf(pages[1]) === "spacious", "the active page became 'spacious'", spacingOf(pages[1]));
    ok(spacingOf(pages[0]) === "normal" && spacingOf(pages[2]) === "normal" &&
       spacingOf(pages[3]) === "normal",
      "every other page (and the other exam) kept 'normal'",
      pages.map(spacingOf).join(" / "));
    ok(zoneOf(pages[1]).classList.contains("spacing-spacious") &&
       !zoneOf(pages[0]).classList.contains("spacing-spacious"),
      "the CSS class moved only on that page");

    // The page's font size must never be changed by a spacing pick.
    ok(ptOf(pages[1]) === "32",
      "picking spacing does not secretly change the page's font size", ptOf(pages[1]));

    ctx.w.paginateExam();
    ok(spacingOf(pages[1]) === "spacious" && spacingOf(pages[0]) === "normal",
      "a re-layout keeps each page's own spacing",
      spacingOf(pages[0]) + " / " + spacingOf(pages[1]));
    ctx.w.close();
  }

  console.log("\n[5] the per-page look is saved (and reloads identically)");

  {
    const ctx = bootExam();
    const pages = buildBooklet(ctx, 1, 2);
    ctx.w.noteActiveBodyPage(pages[0]);
    selectRange(ctx, zoneOf(pages[0]).querySelector("p"));
    pickFont(ctx, "examFontSelectTools", "26");
    ctx.w.noteActiveBodyPage(pages[1]);
    selectRange(ctx, zoneOf(pages[1]).querySelector("p"));
    pickFont(ctx, "examFontSelectTools", "40");

    const html = ctx.w.serializeFlow();
    ok(/data-page-font-pt="26"/.test(html) && /data-page-font-pt="40"/.test(html),
      "the saved HTML carries each page's own size",
      (html.match(/data-page-font-pt="[^"]*"/g) || []).join(" "));
    ok(/data-page-spacing="normal"/.test(html),
      "the saved HTML carries each page's own spacing");

    // Reload exactly what was saved (the multi-exam format) and re-check.
    ctx.w.resetFlow(html);
    const reloaded = Array.from(ctx.flow.querySelectorAll(".exam-page.body-page"));
    ok(reloaded.length === 2, "both pages came back", String(reloaded.length));
    ok(reloaded[0] && ptOf(reloaded[0]) === "26" && reloaded[1] && ptOf(reloaded[1]) === "40",
      "the reloaded pages kept their own different sizes",
      reloaded.map(ptOf).join(" / "));
    ctx.w.close();
  }

  console.log("\n[6] selecting words enlarges ONLY those words");

  {
    const ctx = bootExam();
    const pages = buildBooklet(ctx, 2, 1);
    const page = pages[0];
    const other = pages[1];
    const para = zoneOf(page).querySelector("p");
    para.textContent = "kuli shukran jiddan";      // the words to keep as they are
    const text = para.firstChild;

    // Highlight "shukran" (offsets 5..12).
    selectRange(ctx, text, 5, 12);
    ctx.w.rememberExamSelection();
    ctx.w.enlargeSelectedWords(8);

    const spans = para.querySelectorAll("[data-word-size]");
    ok(spans.length === 1, "exactly one word span was created", String(spans.length));
    ok(spans[0] && spans[0].textContent === "shukran",
      "the span wraps exactly the highlighted word",
      spans[0] && spans[0].textContent);
    ok(spans[0] && parseFloat(spans[0].style.getPropertyValue("--word-pt")) === 40,
      "the word is now 40pt (32 + 8), i.e. really bigger",
      spans[0] && spans[0].style.getPropertyValue("--word-pt"));
    ok(para.textContent === "kuli shukran jiddan",
      "no text was lost or re-ordered", para.textContent);
    ok(!zoneOf(page).querySelector("[data-word-size]").closest("p") ||
       zoneOf(other).querySelectorAll("[data-word-size]").length === 0,
      "nothing was resized in the other exam");

    const sel = ctx.w.getSelection();
    ok(sel && !sel.getRangeAt(0).collapsed &&
       sel.toString() === "shukran",
      "the highlight stays on the word (so A+ can be pressed again)",
      sel && sel.toString());

    // The page's own base size must NOT have changed.
    ok(ptOf(page) === "32", "the page's base size did not change", ptOf(page));

    // Press A+ again straight away.
    ctx.w.enlargeSelectedWords(8);
    ok(parseFloat(para.querySelector("[data-word-size]").style.getPropertyValue("--word-pt")) === 48,
      "pressing A+ again grows the same word to 48pt",
      para.querySelector("[data-word-size]").style.getPropertyValue("--word-pt"));

    // A- shrinks only the selection.
    ctx.w.shrinkSelectedWords(8);
    ok(parseFloat(para.querySelector("[data-word-size]").style.getPropertyValue("--word-pt")) === 40,
      "A- shrinks the selected word back to 40pt");

    // Changing the PAGE size keeps the word bigger (and keeps its ratio).
    ctx.w.noteActiveBodyPage(page);
    pickFont(ctx, "examFontSelectTools", "16");
    const grown = para.querySelector("[data-word-size]");
    ok(!!grown, "the enlarged word SURVIVES a page font-size change");
    ok(grown && parseFloat(grown.style.getPropertyValue("--word-pt")) === 20,
      "…and stays 1.25x the page text (16pt -> the word becomes 20pt)",
      grown && grown.style.getPropertyValue("--word-pt"));
    ok(ptOf(other) === "32", "the other exam's page was untouched", ptOf(other));

    // A-reset gives the word back to the page size.
    ctx.w.rememberExamSelection();
    ctx.w.resetSelectedWordSize();
    ok(para.querySelectorAll("[data-word-size]").length === 0,
      "A-reset removes the custom word size",
      String(para.querySelectorAll("[data-word-size]").length));
    ok(para.textContent === "kuli shukran jiddan",
      "the text itself is still intact after the reset", para.textContent);
    ctx.w.close();
  }

  console.log("\n[7] the word size picker sizes the selection, not the page");

  {
    const ctx = bootExam();
    const pages = buildBooklet(ctx, 1, 2);
    const page = pages[0];
    const para = zoneOf(page).querySelector("p");
    para.textContent = "alpha beta gamma";

    selectRange(ctx, para.firstChild, 6, 10); // "beta"
    ctx.w.rememberExamSelection();
    const picker = ctx.d.getElementById("fontSizeSelect");
    picker.value = "56";
    ctx.w.setFontSize();

    const span = para.querySelector("[data-word-size]");
    ok(!!span && span.textContent === "beta",
      "the picker sized only the highlighted word", span && span.textContent);
    ok(span && parseFloat(span.style.getPropertyValue("--word-pt")) === 56,
      "…to exactly 56pt as chosen", span && span.style.getPropertyValue("--word-pt"));
    ok(ptOf(page) === "32", "the page kept its own size", ptOf(page));
    ok(picker.value === "", "the picker returns to its placeholder for the next pick");

    // With NO selection the same picker is a page-size control.
    const live = Array.from(ctx.flow.querySelectorAll(".exam-page.body-page"));
    /* Drop the highlight the way clicking outside the paper does. A <select>
       keeps its own internal selection in jsdom, so the field is cleared
       directly rather than through removeAllRanges(). */
    ctx.w.getSelection().removeAllRanges();
    ctx.w.savedExamSelectionRange = null;
    for (const field of ["examFontSelect", "examFontSelectTools", "spacingSelect", "fontSizeSelect"]) {
      const el = ctx.d.getElementById(field);
      if (el && el.blur) el.blur();
      if (ctx.d.activeElement === el) ctx.d.body.focus();
    }
    for (const field of ["examFontSelect", "examFontSelectTools"]) {
      ctx.d.getElementById(field).value = "";
      ctx.d.getElementById(field).blur();
    }
    /* Put the caret inside the second page - that is what "writing on page 2"
       means in a browser. */
    const caret = ctx.d.createRange();
    caret.selectNodeContents(zoneOf(live[1]).querySelector("p"));
    caret.collapse(true);
    ctx.w.getSelection().removeAllRanges();
    ctx.w.getSelection().addRange(caret);
    ctx.w.noteActiveBodyPage(live[1]);
    picker.value = "24";
    ctx.w.setFontSize();
    ok(ptOf(live[0]) === "32", "no selection: page 1 stays at 32pt", ptOf(live[0]));
    ok(ptOf(live[1]) === "24", "no selection: the page being written goes to 24pt", ptOf(live[1]));
    ctx.w.close();
  }

  console.log("\n[8] the picker follows the caret from page to page");

  {
    const ctx = bootExam();
    const pages = buildBooklet(ctx, 1, 3);
    ctx.w.noteActiveBodyPage(pages[2]);
    selectRange(ctx, zoneOf(pages[2]).querySelector("p"));
    pickFont(ctx, "examFontSelectTools", "40");
    ok(ctx.d.getElementById("examFontSelectTools").value === "40",
      "the toolbar shows the page's own size after the change",
      ctx.d.getElementById("examFontSelectTools").value);

    selectRange(ctx, zoneOf(pages[0]).querySelector("p"));
    ctx.d.dispatchEvent(new ctx.w.Event("selectionchange"));
    ok(ctx.d.getElementById("examFontSelectTools").value === "32",
      "moving the caret to another page shows THAT page's size",
      ctx.d.getElementById("examFontSelectTools").value);
    ok(ctx.d.getElementById("examPageScopeHint").textContent.indexOf("page 2") !== -1,
      "the toolbar names the page it will change (the cover is page 1)",
      ctx.d.getElementById("examPageScopeHint").textContent.trim());
    ok(pages[0].classList.contains("is-active-page"),
      "the active page is marked on screen");
    ctx.w.close();
  }

  console.log("\n[9] the CSS no longer couples spacing to !important font sizes");

  {
    const css = fs.readFileSync(path.join(REPO, "css", "exam.css"), "utf8");
    ok(!/\.no-sakkal \.exam-body\.spacing-[a-z]+ \{ font-size: [0-9]+pt !important; \}/.test(css),
      "no-sakkal no longer forces a fixed font size per spacing class");
    ok(/\.no-sakkal \.exam-body:not\(\[data-page-font-pt\]\)/.test(css),
      "the fallback size only applies to a page with no stored size");

    const bodyRule = (css.match(/(?:^|\n)\.exam-body\{\s*min-height[^}]*\}/) || [""])[0];
    ok(!/font-size:[^;]*!important/.test(bodyRule),
      "the exam body font-size is not !important (a word size must be able to win)",
      bodyRule.replace(/\s+/g, " ").slice(0, 120));
    ok(/font-size:\s*var\(--exam-page-font-pt,\s*32pt\)/.test(bodyRule),
      "the page size comes from the page itself (--exam-page-font-pt)");

    ok(/\.exam-body p \[data-word-size\]/.test(css),
      "a paragraph can no longer flatten a selected word (inherit beats nothing)");
    ok(/font-size:calc\(var\(--word-pt, 36\) \* 1pt\)/.test(css),
      "word sizes render from --word-pt");

    const wordRule = (css.match(/\.exam-body p \[data-word-size\][^{]*\{[^}]*\}/) || [""])[0];
    ok(!/!important/.test(wordRule),
      "the word-size rule relies on specificity, not !important");

    const examSrc = fs.readFileSync(path.join(REPO, "js", "exam.js"), "utf8");
    const codeOnly = examSrc.replace(/\/\*[\s\S]*?\*\//g, "")
                            .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    ok(codeOnly.indexOf('execCommand("fontSize"') === -1 &&
       codeOnly.indexOf("execCommand('fontSize'") === -1,
      "the old execCommand('fontSize') path (24pt 'X-Large') is gone");
    ctx_free();
  }

  console.log("\n[10] new pages inherit the page they grow from");

  {
    const ctx = bootExam();
    const pages = buildBooklet(ctx, 1, 1);
    ctx.w.noteActiveBodyPage(pages[0]);
    selectRange(ctx, zoneOf(pages[0]).querySelector("p"));
    pickFont(ctx, "examFontSelectTools", "40");
    ctx.d.getElementById("spacingSelect").value = "relaxed";
    ctx.w.setSpacing();

    ctx.w.paginateExam();
    const live = Array.from(ctx.flow.querySelectorAll(".exam-page.body-page"));
    const created = ctx.w.appendBodyPage(ctx.flow, live[0]);
    ok(ptOf(created) === "40",
      "a new page starts from the page being written on (40pt)", ptOf(created));
    ok(spacingOf(created) === "relaxed",
      "…and its spacing (relaxed)", spacingOf(created));
    ok(ptOf(live[0]) === "40", "the source page is unchanged", ptOf(live[0]));
    ctx.w.close();
  }

  console.log("\n----------------------------------------");
  console.log(pass + " passed, " + fail + " failed");
  if (fail) process.exit(1);
}

function ctx_free() { /* no-op: keeps [9] symmetrical */ }

if (!JSDOM) {
  console.log("SKIP - jsdom is not installed (npm i --no-save jsdom to run this test)");
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
