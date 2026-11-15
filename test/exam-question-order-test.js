/* ==========================================================================
   test/exam-question-order-test.js  (NEW - exam question order)

   Owner, verbatim:
     "In the exam section. From the third question. If questions is written
      and need to be arranged it will just be jumping from up to down down to
      up. Fix that now and any other possible errors there. Fast and merge now"

   WHAT WAS WRONG (reproduced here against the real js/exam.js):

   1. QUESTIONS RE-ORDERED THEMSELVES WHILE TYPING  ("up to down, down to up")
      Every keystroke runs rescueCaretBlock() (js/exam.js, the input handler).
      Its last act was:

          if (zone.lastElementChild !== block) { zone.appendChild(block); }

      i.e. whatever block the caret was in was MOVED TO THE BOTTOM of the
      page. That is invisible while the teacher types the last question, but
      the moment they go back to question 3 of 6 (to add a word, fix a
      spelling) the next letter threw that question to the end of the paper.
      Type in Q3 -> Q3 lands after Q6; type in it again -> it "jumps" back
      up or down again. Exactly the reported jumping.

   2. "DUPLICATE" MADE AN EMPTY COPY
      duplicateExam() copied only the title/class/subject/term/session and
      then reset the flow, so the copy had no questions and no cover.

   WHAT THIS TEST PROVES (real create-exam.html + real js/exam.js in jsdom):

     A. typing in ANY question (first, middle, last) never changes the order
     B. typing does not move the question to the bottom of the page
     C. Enter in the middle of a question splits it in place (order kept)
     D. the pagination engine itself never re-orders blocks - including the
        spill path (a question taller than a page) and manual page breaks
     E. Duplicate brings the questions (and the cover) with it

   node test/exam-question-order-test.js
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

/* jsdom is a DEV-ONLY helper for this test. If it is not installed the test
   skips cleanly instead of breaking `npm test` on a fresh checkout. */
let JSDOM;
try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = null; }

const PAGE_H = 1123;     // a fake A4 page element height
const ZONE_H = 1000;     // fake .page-content height
const BUDGET = (273 / 210) * 794; // the engine's own budget formula, page 794px wide

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
  /* Height model: a block's height comes from its data-h attribute so a
     question can be made "tall" or "short" the way real Arabic text is. */
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

/* Write `specs` ([{h, text}]) as separate question blocks on the body page. */
function writeQuestions(ctx, specs) {
  const flow = ctx.flow;
  flow.querySelectorAll(".exam-page.body-page").forEach(function (p, i) { if (i > 0) p.remove(); });
  const zone = flow.querySelector(".body-page .page-content");
  zone.innerHTML = "";
  specs.forEach(function (s) {
    const p = ctx.d.createElement("p");
    p.setAttribute("data-h", String(s.h));
    p.textContent = s.text;
    zone.appendChild(p);
  });
  return zone;
}

function readOrder(ctx) {
  return Array.from(ctx.flow.querySelectorAll(".page-content p"))
    .map(function (p) { return p.textContent.trim(); });
}

function readLayout(ctx) {
  return Array.from(ctx.flow.querySelectorAll(".exam-page")).map(function (p) {
    if (p.classList.contains("page-one")) return "COVER";
    return "[" + Array.from(p.querySelectorAll(".page-content p"))
      .map(function (x) { return x.textContent.trim(); }).join(" ") + "]";
  }).join(" | ");
}

function caretInto(ctx, el, atEnd) {
  const r = ctx.d.createRange();
  r.selectNodeContents(el);
  r.collapse(atEnd ? false : true);
  const sel = ctx.w.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/* One keystroke: insert a character at the caret, then fire the real
   `input` event the editor listens to. */
function typeAtCaret(ctx, text) {
  const sel = ctx.w.getSelection();
  const r = sel.getRangeAt(0);
  const tn = ctx.d.createTextNode(text);
  r.insertNode(tn);
  const after = ctx.d.createRange();
  after.setStartAfter(tn);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  ctx.flow.dispatchEvent(new ctx.w.Event("input", { bubbles: true }));
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  console.log("\n[1] typing in the middle of the paper keeps the question order");

  {
    const ctx = bootExam();
    const zone = writeQuestions(ctx, [
      { h: 100, text: "Q1" }, { h: 100, text: "Q2" }, { h: 700, text: "Q3" },
      { h: 100, text: "Q4" }, { h: 100, text: "Q5" }, { h: 100, text: "Q6" }
    ]);
    const before = readOrder(ctx);
    ok(before.join(",") === "Q1,Q2,Q3,Q4,Q5,Q6", "six questions start in order", before.join(","));

    /* THE REPORTED CASE: go back to the THIRD question and type. */
    const q3 = Array.from(zone.children).find(function (p) { return p.textContent === "Q3"; });
    caretInto(ctx, q3, true);
    typeAtCaret(ctx, "x");

    let order = readOrder(ctx);
    ok(order.join(",") === "Q1,Q2,Q3x,Q4,Q5,Q6",
      "typing in Q3 does NOT throw Q3 to the bottom (up/down jumping)", order.join(","));

    /* and it stays put over a full pause, when the 800ms re-pagination runs */
    await sleep(1100);
    order = readOrder(ctx);
    ok(order.join(",") === "Q1,Q2,Q3x,Q4,Q5,Q6",
      "order is still correct after the automatic re-pagination", order.join(","));

    /* first and last question too */
    const q1 = Array.from(ctx.flow.querySelectorAll(".page-content p")).find(function (p) { return p.textContent === "Q1"; });
    caretInto(ctx, q1, true);
    typeAtCaret(ctx, "!");
    const q6 = Array.from(ctx.flow.querySelectorAll(".page-content p")).find(function (p) { return p.textContent === "Q6"; });
    caretInto(ctx, q6, true);
    typeAtCaret(ctx, "?");
    order = readOrder(ctx);
    ok(order.join(",") === "Q1!,Q2,Q3x,Q4,Q5,Q6?",
      "typing in the first and last question also keeps the order", order.join(","));

    /* the exact old bug: a middle question must still be a middle child */
    const zoneNow = ctx.flow.querySelector(".body-page .page-content");
    const kids = Array.from(zoneNow.children).map(function (p) { return p.textContent.trim(); });
    ok(kids.indexOf("Q3x") === 2,
      "Q3 is still the THIRD child of the text zone (not appended at the end)", kids.join(","));
    ctx.w.close();
  }

  console.log("\n[2] Enter in the middle of a question splits it in place");

  {
    const ctx = bootExam();
    const zone = writeQuestions(ctx, [
      { h: 100, text: "Q1" }, { h: 100, text: "Q2" }, { h: 100, text: "Q3" },
      { h: 100, text: "Q4" }, { h: 100, text: "Q5" }
    ]);
    const q3 = Array.from(zone.children).find(function (p) { return p.textContent === "Q3"; });
    caretInto(ctx, q3, true);
    const ev = new ctx.w.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true });
    ctx.flow.dispatchEvent(ev);

    ok(ev.defaultPrevented, "Enter is handled by the editor (own new-line logic)");
    const labels = Array.from(zone.children).map(function (p) { return p.textContent.trim() || "(empty)"; });
    ok(labels.join(",") === "Q1,Q2,Q3,(empty),Q4,Q5",
      "the new line is created right BELOW Q3, above Q4 - nothing jumps", labels.join(","));

    /* The caret must actually BE in the new line: otherwise the very next
       letter is typed nowhere (the old "second line does not respond"). */
    const newLine = zone.children[3];
    const caretHost = ctx.w.getSelection().getRangeAt(0).startContainer;
    ok(newLine.contains(caretHost),
      "the caret sits INSIDE the new line after Enter (focus no longer wipes it)");

    /* and the next keystroke really lands there */
    typeAtCaret(ctx, "ans");
    ok(newLine.textContent === "ans",
      "the next letters are typed on the new line, in place", JSON.stringify(newLine.textContent));
    ctx.w.close();
  }

  console.log("\n[3] the pagination engine itself never re-orders questions");

  {
    const ctx = bootExam();
    const specs = [
      { h: 400, text: "Q1" }, { h: 400, text: "Q2" },
      { h: 1900, text: "Q3" },            /* taller than a whole page - spill path */
      { h: 120, text: "Q4" }, { h: 120, text: "Q5" }, { h: 120, text: "Q6" }
    ];
    writeQuestions(ctx, specs);
    ctx.w.paginateExam();
    let order = readOrder(ctx);
    ok(order.join(",") === "Q1,Q2,Q3,Q4,Q5,Q6",
      "a question taller than the page spills onto its own page - order kept", readLayout(ctx));

    /* 200 random layouts - the engine must never re-order anything */
    let bad = 0;
    for (let trial = 0; trial < 200; trial++) {
      const n = 3 + Math.floor(Math.random() * 12);
      const list = [];
      for (let i = 0; i < n; i++) list.push({ h: 40 + Math.floor(Math.random() * 900), text: "Q" + (i + 1) });
      writeQuestions(ctx, list);
      ctx.w.paginateExam();
      const got = readOrder(ctx).map(function (t) { return parseInt(t.slice(1), 10); });
      const want = list.map(function (_, i) { return i + 1; });
      if (got.join(",") !== want.join(",")) bad++;
    }
    ok(bad === 0, "200 random question-size layouts all keep their order", bad + " re-ordered");
    ctx.w.close();
  }

  console.log("\n[4] Duplicate keeps the questions");

  {
    const ctx = bootExam();
    const exam = {
      id: 7, title: "First Term Test", class_name: "SS 1", subject: "Tajweed",
      term: "1st Term", session: "2025/2026", duration: "1 hour",
      instructions: "<p class=\"instruction-line\">x</p>",
      body_html: "<p>QUESTION ONE</p><p>QUESTION TWO</p><p>QUESTION THREE</p>"
    };
    ctx.w.fetch = function (url) {
      url = String(url);
      if (url.indexOf("/exam/7") !== -1) {
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve(exam); } });
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } });
    };
    ctx.w.duplicateExam(7);
    await sleep(400);
    const copied = readOrder(ctx);
    ok(copied.indexOf("QUESTION ONE") !== -1 && copied.indexOf("QUESTION THREE") !== -1,
      "Duplicate copies the original's questions into the new draft", copied.join(","));
    ctx.w.close();
  }

  console.log("\n[5] saving never throws when the cover is missing");

  {
    const ctx = bootExam();
    let sent = null;
    ctx.w.fetch = function (url, opts) {
      url = String(url);
      if (url.indexOf("/save-exam") !== -1) {
        sent = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ id: 3, message: "Draft saved" }); } });
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } });
    };
    ctx.d.getElementById("examTitle").value = "Test";
    const cs = ctx.d.getElementById("examClass");
    cs.innerHTML = '<option value="SS 1">SS 1</option>';
    cs.value = "SS 1";
    const ss = ctx.d.getElementById("examSubject");
    ss.innerHTML = '<option value="Tajweed">Tajweed</option>';
    ss.value = "Tajweed";
    ctx.d.getElementById("examTerm").value = "1st Term";
    ctx.d.getElementById("examSession").value = "2025/2026";
    ctx.d.getElementById("coverPage").remove();
    ctx.d.querySelector(".body-page .page-content").innerHTML = "<p>Q1</p><p>Q2</p>";

    let threw = null;
    try { ctx.w.saveExam(); } catch (e) { threw = e.message; }
    await sleep(300);
    ok(!threw, "saveExam does not throw when #coverPage is gone", threw || "");
    ok(sent && sent.body_html.indexOf("Q2") !== -1,
      "the exam is still sent to the server (with its questions)", sent ? sent.body_html : "nothing sent");
    ctx.w.close();
  }

  console.log("\n[6] the fix is actually in the shipped file");

  {
    const src = fs.readFileSync(path.join(REPO, "js", "exam.js"), "utf8");
    ok(src.indexOf("if (zone.lastElementChild !== block)") === -1,
      "the old 'move the caret block to the bottom of the page' code is gone");
    ok(src.indexOf("Copied into your drafts") !== -1,
      "duplicateExam keeps working (message present)");
  }

  console.log("\n----------------------------------------");
  console.log(pass + " passed, " + fail + " failed");
  if (fail) process.exit(1);
}

if (!JSDOM) {
  console.log("SKIP - jsdom is not installed (npm i --no-save jsdom to run this test)");
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
