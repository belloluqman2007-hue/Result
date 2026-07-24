/* ==========================================================================
   EXAM BUILDER  (js/exam.js)
   --------------------------------------------------------------------------
   CHANGED (auto pagination - request #1):
   The exam is now ONE continuous editable document (#examFlow) that the
   system lays out onto A4 pages automatically - like Microsoft Word.

     - The teacher simply types; blocks (paragraphs, lists, tables,
       images) are measured and placed on the current page.
     - If a block does not fit in the remaining space, the WHOLE block
       moves to the next page. A single question is NEVER split.
     - New pages appear automatically (each with the exam header) and
       empty trailing pages disappear automatically.
     - "Page Break" inserts a Word-style forced break (Ctrl+Enter feel).

   Kept intact: all original function names (initExam, generateCoverPage,
   saveExam, openLoadPanel, loadExam, deleteExamFromPanel, insertPageBreak,
   removeLastPage, examPrint, downloadExamPDF, format, insertTable,
   setSpacing, toggleDirection, setFontSize, toggleVoice, insertHarakat),
   the /save-exam + /exams + /exam/:id routes and the exams table format.
   Old saved exams (per-page JSON array) load seamlessly - their pages
   are merged into the flow and re-paginated automatically.
========================================================================== */

let currentExamId = null;

const TERM_ARABIC = {
    "1st Term": "الْأُولَى",
    "2nd Term": "الثَّانِيَة",
    "3rd Term": "الثَّالِثَة"
};

/* ==========================================================================
   1. INITIALISATION
========================================================================== */

function initExam() {
    loadExamClasses();
    preventToolbarFocusLoss();

    document.getElementById("examClass").addEventListener("change", loadExamSubjects);

    const flow = document.getElementById("examFlow");

    /* CHANGED (pack 26 - owner: "Fix the exam that is not rendering all my
       questions after been downloaded and not yet effective to use and
       very stressful"):
       Root cause of the stress + the missing questions: the layout used to
       re-paginate 300ms after EVERY keystroke. On a phone that re-layout
       moved the paragraph being typed in mid-word - the caret jumped or
       the keyboard flickered closed ("very stressful", "can't write on
       this page"), and letters Android was still holding could be dropped,
       so typed text went missing before the PDF was ever built.
       Now: while typing, the refresh waits for a real pause (800ms);
       Arabic IME composition is left alone completely; and the text caret
       is saved + restored around every refresh (blocks are MOVED by the
       engine, never rebuilt, so the selection survives). Auto-flow to new
       pages still happens exactly as before. */
    let paginateTimer = null;
    function keepExamCaret(fn) {
        const sel = window.getSelection();
        let saved = null;
        try {
            if (sel && sel.rangeCount) {
                const r = sel.getRangeAt(0);
                if (flow.contains(r.startContainer) && flow.contains(r.endContainer)) {
                    saved = r.cloneRange();
                }
            }
        } catch (e) {}
        fn();
        if (saved) {
            try {
                if (flow.contains(saved.startContainer) && flow.contains(saved.endContainer)) {
                    sel.removeAllRanges();
                    sel.addRange(saved);
                }
            } catch (e) { /* caret anchor genuinely gone - leave as is */ }
        }
    }
    function scheduleTypingPaginate(delay) {
        clearTimeout(paginateTimer);
        paginateTimer = setTimeout(function () { keepExamCaret(paginateExam); }, delay);
    }
    flow.addEventListener("input", function (e) {
        if (e && e.isComposing) return; // mid Arabic IME composition: hands off
        scheduleTypingPaginate(800);
    });
    // tapping out of the page text = refresh the layout promptly
    flow.addEventListener("focusout", function () {
        scheduleTypingPaginate(200);
    });

    // Images load asynchronously - re-measure once they arrive.
    flow.addEventListener("load", function (e) {
        if (e.target && e.target.tagName === "IMG") paginateExam();
    }, true);

    // Rotating the phone / resizing the window changes page width → re-fit.
    let resizeTimer = null;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(paginateExam, 500);
    });

    // Image tools: click an image to select it, click away to deselect.
    flow.addEventListener("click", handleFlowClick);
    document.addEventListener("click", function (e) {
        if (!e.target.closest(".exam-img") && !e.target.closest(".img-tools")) {
            deselectExamImage();
        }
    });

    // File picker for "Image" toolbar button.
    const imgInput = document.getElementById("examImageInput");
    if (imgInput) {
        imgInput.addEventListener("change", function () {
            if (imgInput.files && imgInput.files[0]) {
                insertExamImage(imgInput.files[0]);
            }
            imgInput.value = "";
        });
    }

    // NEW (multi-exam in one PDF): page 1's cover markup is stamped in
    // from #examCoverTemplate (extra covers get the same stamp), so the
    // template stays the single source for every cover.
    const firstCover = document.getElementById("coverPage");
    if (firstCover) buildCover(firstCover);

    // NEW (cover text fits one line): once now, again when webfonts
    // arrive, and on resize/rotate - keeps the cover exactly A4 everywhere.
    fitAllCoverOneLiners();
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(fitAllCoverOneLiners);
    }
    let fitTimer = null;
    window.addEventListener("resize", function () {
        clearTimeout(fitTimer);
        fitTimer = setTimeout(function () {
            fitAllCoverOneLiners();
            updateExamZoom();
        }, 400);
    });

    // NEW (question font size feature): the teacher picks the starting
    // size in Step 1; the auto-fit still shrinks it if questions spill.
    // CHANGED (pack 17 - owner: "add font size to the exam tools"): the
    // same picker now also lives in the Step 2 toolbar
    // (examFontSelectTools) - both stay in sync either way, so the
    // teacher never has to go back to Step 1 to resize questions.
    const fontSel = document.getElementById("examFontSelect");
    const fontSelTools = document.getElementById("examFontSelectTools");
    function applyExamFontFrom(val, other) {
        document.querySelectorAll("#examFlow .exam-body").forEach(function (b) {
            /* FIX (pack 18 - owner: "font size is not working for the first
               page if written exam"): paragraphs/words sized earlier through
               the legacy toolbar (which still emits <font size> tags) or by
               paste kept their locked inline size and ignored this picker.
               Unlock them first so the chosen exam-wide size really wins. */
            b.querySelectorAll("font[size]").forEach(function (f) { f.removeAttribute("size"); });
            b.querySelectorAll("[style]").forEach(function (el) {
                if (el.style && el.style.fontSize) el.style.fontSize = "";
            });
            b.style.fontSize = val + "pt";
        });
        if (other && other.value !== val) other.value = val;
        paginateExam();
    }
    if (fontSel) fontSel.addEventListener("change", function () { applyExamFontFrom(fontSel.value, fontSelTools); });
    if (fontSelTools) fontSelTools.addEventListener("change", function () { applyExamFontFrom(fontSelTools.value, fontSel); });
    if (fontSel && fontSelTools) fontSelTools.value = fontSel.value;

    refreshAllPageHeaders();
    paginateExam();
}

// Prevent toolbar/palette button clicks from stealing focus away from the
// editable area, so the text cursor position is preserved when formatting.
function preventToolbarFocusLoss() {
    document.querySelectorAll(
        ".exam-format-toolbar button, .harakat-palette button, .math-palette button, .img-tools button"
    ).forEach(btn => {
        btn.addEventListener("mousedown", e => e.preventDefault());
    });
}

/* ==========================================================================
   2. CLASS / SUBJECT LOADING (self-contained)
========================================================================== */

function loadExamClasses() {
    fetch("/classes")
        .then(response => response.json())
        .then(classes => {
            const select = document.getElementById("examClass");
            select.innerHTML = '<option value="" disabled selected>Select Class</option>';
            classes.forEach(cls => {
                select.innerHTML += `<option value="${cls.class_name}">${cls.class_name}</option>`;
            });
        })
        .catch(error => console.log(error));
}

function loadExamSubjects() {
    const classSelect = document.getElementById("examClass");
    const subjectSelect = document.getElementById("examSubject");
    const selectedClass = classSelect.value;

    if (!selectedClass) {
        subjectSelect.innerHTML = '<option value="" disabled selected>Select class first</option>';
        return;
    }

    fetch(`/subjects?class=${encodeURIComponent(selectedClass)}`)
        .then(response => response.json())
        .then(subjects => {
            if (subjects.length === 0) {
                subjectSelect.innerHTML = '<option value="" disabled selected>No subjects set up for this class</option>';
                return;
            }
            subjectSelect.innerHTML = '<option value="" disabled selected>Select Subject</option>';
            subjects.forEach(subject => {
                subjectSelect.innerHTML += `<option value="${subject.subject_name}">${subject.subject_name}</option>`;
            });
        })
        .catch(error => console.log(error));
}

/* ==========================================================================
   3. WIZARD (Step 1 details -> Step 2 editor) + sidebar
========================================================================== */

function toggleExamSidebar(force) {
    var side = document.getElementById("examSidebar");
    var scrim = document.getElementById("examSideScrim");
    if (!side) return;
    var open = typeof force === "boolean"
        ? force
        : !side.classList.contains("exam-side-open");
    side.classList.toggle("exam-side-open", open);
    if (scrim) scrim.classList.toggle("exam-side-open", open);
}

function examCloseSidebarOnMobile() {
    if (window.innerWidth <= 1100) toggleExamSidebar(false);
}

function examGotoStep(step) {
    var step1 = document.getElementById("examStep1");
    var step2 = document.getElementById("examStep2");
    if (!step1 || !step2) return;

    if (step === 2) {
        var cls = document.getElementById("examClass").value;
        var subject = document.getElementById("examSubject").value;
        var term = document.getElementById("examTerm").value;
        var session = document.getElementById("examSession").value;
        if (!cls || !subject || !term || !session) {
            if (window.amsToast) {
                window.amsToast("Please choose Class, Subject, Term and Session first.", "error", 4500);
            } else {
                alert("Please select Class, Subject, Term, and Session before continuing.");
            }
            return;
        }
        generateCoverPage(); // fills page-1 letterhead + every page header
        step1.style.display = "none";
        step2.style.display = "block";
        examCloseSidebarOnMobile();
        var firstPage = document.querySelector(".exam-page");
        if (firstPage) firstPage.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
        step2.style.display = "none";
        step1.style.display = "block";
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

function updateWizardSummary() {
    var el = document.getElementById("examWizardSummary");
    if (!el) return;
    var cls = document.getElementById("examClass").value;
    var subject = document.getElementById("examSubject").value;
    var term = document.getElementById("examTerm").value;
    var session = document.getElementById("examSession").value;
    if (cls && subject && term && session) {
        el.textContent = cls + " \u00B7 " + subject + " \u00B7 " + term + " \u00B7 " + session +
            " \u2014 pages are created automatically as you write.";
    }
}

/* ==========================================================================
   4. COVER PAGES + MULTI-EXAM SECTIONS
========================================================================== */

// NEW (multi-exam in one PDF): stamp the pristine cover markup (from
// #examCoverTemplate) into an EMPTY cover page. One source of truth for
// the first cover AND every extra "Add Another Exam" cover. Value hooks
// are .js-cover-* classes (not ids) because a document can hold MANY
// covers at once.
function buildCover(coverEl) {
    const tpl = document.getElementById("examCoverTemplate");
    if (tpl && !coverEl.querySelector(".cover-header")) {
        coverEl.appendChild(tpl.content.cloneNode(true));
    }
}

/* NEW (cover text fits one line on every device): phones do not have
   Sakkal Majalla / Times New Roman, so the long cover lines wrapped and
   the whole cover grew past the sheet (the downloaded PDF then squeezed
   page 1 down). This shrinks ONLY the long one-liners until each fits its
   width on ONE line. On the Windows laptop with the real fonts nothing
   ever wraps, so nothing changes there. */
function fitOneLineText(el, minPt) {
    if (!el) return;
    if (!el.dataset.basePt) {
        el.dataset.basePt = ((parseFloat(getComputedStyle(el).fontSize) || 16) * 0.75).toFixed(2);
    }
    el.style.whiteSpace = "nowrap";
    let pt = parseFloat(el.dataset.basePt);
    el.style.fontSize = pt + "pt";
    for (let i = 0; i < 6 && el.scrollWidth > el.clientWidth + 1 && pt > minPt; i++) {
        pt = Math.max(minPt, pt * (el.clientWidth / el.scrollWidth) * 0.98);
        el.style.fontSize = pt + "pt";
    }
}

function fitCoverOneLiners(cover) {
    [".cover-arabic-name", ".cover-english-name", ".cover-address",
     ".cover-tel", ".cover-email", ".cover-motto", ".cover-exam-period"]
    .forEach(function (sel) { fitOneLineText(cover.querySelector(sel), 12); });
}

function fitAllCoverOneLiners() {
    document.querySelectorAll("#examFlow .exam-page.page-one").forEach(fitCoverOneLiners);
}

/* NEW (true A4 on every screen): on a narrow screen the whole flow keeps
   its REAL A4 layout and the VIEW is zoomed out with one transform, so
   typing, pagination, the auto font-fit and printing measure exactly the
   same on phone and laptop. The margin trick keeps the layout height in
   sync with the scaled-down view. */
function updateExamZoom() {
    const flow = document.getElementById("examFlow");
    if (!flow || !flow.parentElement) return;
    const main = flow.parentElement;
    const pageEl = flow.querySelector(".exam-page");
    const avail = main.clientWidth - 12;
    const pw = pageEl ? pageEl.offsetWidth : 0;
    if (pw > 0 && pw > avail) {
        const s = avail / pw;
        flow.style.transform = `scale(${s})`;
        // .exam-pages is flex + align-items:center, so every page is
        // horizontally centred; scaling about the same centre point keeps
        // the zoomed page centred on the screen.
        flow.style.transformOrigin = "center 0";
        flow.style.marginBottom = (-(1 - s) * flow.scrollHeight) + "px";
    } else {
        flow.style.transform = "";
        flow.style.marginBottom = "";
    }
}

// The LAST cover in the document - the one "Generate Cover Page" fills.
function lastCover() {
    const covers = document.querySelectorAll("#examFlow .exam-page.page-one");
    return covers[covers.length - 1] || null;
}

// Fill ONE cover from the wizard fields. silent=true just skips an
// incomplete wizard (used when auto-filling a brand-new section).
function fillCover(cover, silent) {
    const cls = document.getElementById("examClass").value;
    const subject = document.getElementById("examSubject").value;
    const term = document.getElementById("examTerm").value;
    const session = document.getElementById("examSession").value;
    const duration = document.getElementById("examDuration").value.trim();

    if (!cls || !subject || !term || !session) {
        if (!silent) {
            alert("Please select Class, Subject, Term, and Session before generating the cover page.");
        }
        return;
    }

    // Values end with a full stop exactly like the printed school exam
    // sheets (e.g. "شَرْحُ التَّوْحِيدِ.").
    const dot = function (v) { return /[.؟!]\s*$/.test(v) ? v : v + "."; };
    cover.querySelector(".js-cover-class").textContent = dot(cls);
    cover.querySelector(".js-cover-subject").textContent = dot(subject);
    cover.querySelector(".js-cover-duration").textContent = duration ? dot(duration) : "-";

    // The paper shows the session as "END-YEAR\HIJRI" (e.g. 2026\1447)
    // and the footer as "AMSAIS@2026/1447". Hijri = Gregorian end year - 579.
    const endYear = (session.split("/")[1] || session).trim();
    const hijri = String(parseInt(endYear, 10) - 579);
    const termArabic = TERM_ARABIC[term] || term;
    cover.querySelector(".js-cover-period").textContent =
        `اِمْتِحَانُ الْفَتْرَةِ ${termArabic} لِلْعَامِ الدِّرَاسِيِّ ${endYear}\\${hijri}`;
    cover.querySelector(".js-cover-code").textContent = `AMSAIS@${endYear}/${hijri}`;
}

function generateCoverPage() {
    // CHANGED (multi-exam in one PDF): fills the NEWEST cover (the last
    // one). With a single exam that is page 1, exactly as before.
    const cover = lastCover();
    if (!cover) return;
    if (!cover.querySelector(".cover-header")) buildCover(cover);
    fillCover(cover, false);
    refreshAllPageHeaders();
    paginateExam(); // chrome height changed -> re-fit the blocks
}

// NEW (multi-exam in one PDF): append a NEW cover page + its own empty
// question page at the END of the document. The teacher then changes the
// details in Step 1 and presses "Generate Cover Page" - it fills the NEW
// cover. Repeat for every exam, then print/download ONE pdf with covers
// on pages 1, 3, 5... exactly like the school's own exam booklets.
function addExamSection() {
    const flow = document.getElementById("examFlow");
    const cover = document.createElement("div");
    cover.className = "exam-page page-one";
    buildCover(cover);
    flow.appendChild(cover);
    appendBodyPage(flow);          // its own question page, right after it
    fillCover(cover, true);        // start from the current wizard values
    fitCoverOneLiners(cover);      // NEW (cover text fits one line)
    paginateExam();
    if (window.amsToast) {
        window.amsToast("New exam added at the end. Set its details in Step 1 and press \"Generate Cover Page\" - it fills the NEW cover.", "info", 7000);
    }
    if (typeof examGotoStep === "function") examGotoStep(1);
    cover.scrollIntoView({ behavior: "smooth", block: "start" });
}

// NEW (multi-exam in one PDF): remove an EXTRA cover together with the
// question pages that belong to it (everything up to the next cover).
function removeExamSection(btn) {
    const cover = btn.closest(".exam-page.page-one");
    if (!cover) return;
    if (!confirm("Remove this whole exam section - its cover page AND the questions under it?")) return;
    let n = cover.nextElementSibling;
    while (n && !n.classList.contains("page-one")) {
        const dead = n;
        n = n.nextElementSibling;
        dead.remove();
    }
    cover.remove();
    paginateExam();
}

// CHANGED (school paper design): the real school exam paper has NO header
// on the question pages - page 1 is a pure cover and pages 2+ are plain
// question pages (verified against the school's own printed papers).
// examPageHeaderHTML() was removed; refreshAllPageHeaders() is kept (same
// name, called from several places) and now only refreshes the wizard.
function refreshAllPageHeaders() {
    updateWizardSummary();
}

/* ==========================================================================
   5. THE AUTOMATIC PAGINATION ENGINE  (request #1 - the heart of it all)
   --------------------------------------------------------------------------
   A "block" is a direct child of a page's .page-content zone:
   a paragraph, a list, a table or an image block. Blocks are moved
   BETWEEN pages, never re-created, so the text cursor is preserved.
========================================================================== */

// Usable height of one A4 question page: 297mm minus the page's vertical
// padding. CHANGED (school paper design): body pages now use the paper's
// real margins (12mm top + 12mm bottom), so a page holds ~10 questions,
// exactly like the school's printed papers.
const PAGE_CONTENT_MM = 273;

// How tall (px) may the content zone of THIS page be on the current screen?
function budgetFor(page) {
    let budget = (PAGE_CONTENT_MM / 210) * page.offsetWidth;
    // Subtract everything above the content zone (page header / letterhead).
    Array.from(page.children).forEach(function (child) {
        if (!child.classList.contains("page-content") &&
            !child.classList.contains("page-warn-chip")) {
            budget -= child.offsetHeight + marginV(child);
        }
    });
    return Math.max(budget, 40);
}

function marginV(el) {
    const cs = getComputedStyle(el);
    return (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
}

function outerHeightPx(el) {
    return el.offsetHeight + marginV(el);
}

function placeBlock(block, page) {
    const content = page.querySelector(".page-content");
    if (block.parentNode !== content) {
        content.appendChild(block); // moves the SAME node - caret survives
    }
}

// Build one more question page - a plain content zone only, no header
// (CHANGED (school paper design): question pages carry no school header).
// NEW (multi-exam in one PDF): when paginating a middle section the page
// is inserted right after `afterEl`; by default it goes to the end.
function appendBodyPage(flow, afterEl) {
    const page = document.createElement("div");
    page.className = "exam-page body-page";
    const spacing = document.getElementById("spacingSelect").value;
    page.innerHTML = `<div class="page-content exam-body spacing-${spacing}"></div>`;
    if (afterEl && afterEl.parentNode === flow) {
        flow.insertBefore(page, afterEl.nextElementSibling);
    } else {
        flow.appendChild(page);
    }
    return page;
}

// Make sure the structure is sane before laying out.
// CHANGED (school paper design): page 1 is a PURE cover (no .page-content
// on purpose) and body pages have no .exam-page-header. Strip any legacy
// headers left over from old saved exams / old markup, and guarantee every
// body page has exactly one content zone - but never add one to the cover.
function ensureExamStructure(flow) {
    flow.querySelectorAll(".exam-page-header").forEach(function (h) { h.remove(); });

    // NEW (multi-exam in one PDF): every cover gets its template stamped
    // in; the FIRST cover carries the #coverPage id (saved exams rely on
    // it); every cover EXCEPT the first gets a small screen-only remove
    // button so a mistaken section can be deleted again.
    const covers = Array.from(flow.querySelectorAll(".exam-page.page-one"));
    covers.forEach(function (cover, i) {
        buildCover(cover);
        if (i === 0) {
            if (!document.getElementById("coverPage")) cover.id = "coverPage";
            const stray = cover.querySelector(".cover-remove");
            if (stray) stray.remove();
        } else if (!cover.querySelector(".cover-remove")) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cover-remove";
            btn.contentEditable = "false";
            btn.title = "Remove this whole exam section (cover + its questions)";
            btn.textContent = "\u00D7";
            btn.addEventListener("click", function () { removeExamSection(btn); });
            cover.appendChild(btn);
        }
    });

    flow.querySelectorAll(".exam-page").forEach(function (page) {
        if (page.classList.contains("page-one")) return; // cover stays pure
        const contents = Array.from(page.querySelectorAll(".page-content"));
        if (!contents.length) {
            const content = document.createElement("div");
            const spacing = document.getElementById("spacingSelect").value;
            content.className = `page-content exam-body spacing-${spacing}`;
            page.appendChild(content);
        } else if (contents.length > 1) {
            /* FIX (pack 19 - owner: "the second exam shows only two lines"):
               some saved exams ended up with ONE body zone per typed line on
               the same page. The paginator only reads the FIRST .page-content
               of a page, so every extra zone (the rest of the questions) was
               silently dropped from screen AND print - leaving intro + one
               question. Merge all zones into the first one; untouched for
               pages that already have a single zone. */
            for (let i = 1; i < contents.length; i++) {
                const empty = !contents[i].textContent.trim() && !contents[i].querySelector("img,table");
                if (!empty) {
                    // keep every merged zone on its OWN line: zones that hold
                    // loose inline fragments (font/span without a block) are
                    // wrapped in a block so lines can never glue together.
                    const hasBlock = !!contents[i].querySelector("p,div,ol,ul,table,blockquote,h1,h2,h3,h4,h5,h6,li");
                    if (hasBlock) {
                        while (contents[i].firstChild) contents[0].appendChild(contents[i].firstChild);
                    } else {
                        const line = document.createElement("div");
                        while (contents[i].firstChild) line.appendChild(contents[i].firstChild);
                        contents[0].appendChild(line);
                    }
                }
                contents[i].remove();
            }
        }
    });
}

function paginateExam() {
    const flow = document.getElementById("examFlow");
    if (!flow) return;

    deselectExamImageIfDeleted();

    ensureExamStructure(flow);

    // NEW (multi-exam in one PDF): the paper is laid out per EXAM
    // SECTION - one cover plus the question pages that belong to it.
    // A question can never travel into another exam's section: covers
    // are hard boundaries just like the school's printed booklets
    // (cover, questions, cover, questions...).
    const segments = [];
    let cur = null;
    flow.querySelectorAll(".exam-page").forEach(function (page) {
        if (page.classList.contains("page-one")) {
            cur = { cover: page, bodies: [] };
            segments.push(cur);
        } else if (cur) {
            cur.bodies.push(page);
        }
    });

    segments.forEach(function (seg) { paginateSegment(flow, seg); });

    /* NEW (pack 17 - owner: "let it all display as the first one
       display"): ONE question text size for the whole downloaded
       booklet. Each auto-fitted exam used to shrink on its own, so the
       first exam printed full-size while a fuller exam printed tiny and
       cramped. Now every one-page exam shares the size that fitted the
       FULLEST exam - applying a smaller size can never overflow a page,
       so this is always safe. Exams split with manual page breaks keep
       the chosen (full) size, exactly like before. */
    let docFit = Infinity;
    segments.forEach(function (seg) {
        if (seg.spilled) return; // pack 25: spilled sections ride their own flow, don't drag the shared size down
        if (seg.bodies.some(function (p) { return !!p.querySelector(".manual-page-break"); })) return;
        const c = seg.bodies[0] && seg.bodies[0].querySelector(".page-content");
        const pt = c && parseFloat(c.style.fontSize);
        if (pt) docFit = Math.min(docFit, pt);
    });
    if (docFit !== Infinity) {
        segments.forEach(function (seg) {
            if (seg.spilled) return; // pack 25
            if (seg.bodies.some(function (p) { return !!p.querySelector(".manual-page-break"); })) return;
            const c = seg.bodies[0] && seg.bodies[0].querySelector(".page-content");
            if (c) c.style.fontSize = docFit + "pt";
        });
    }

    refreshAllPageHeaders();
    checkAllPagesOverflow();
    updateExamZoom(); // NEW (true A4 on every screen): page count changed
}

/* NEW (one page per exam - auto font fit): readability floor for the
   automatic shrink - below this, the overflow warning chip takes over. */
const EXAM_MIN_PT = 12;

/* The question font size the teacher picked in Step 1 (the page style
   select). The auto-fit shrinks from there, never above it. */
function examBaseFontPt() {
    const s = document.getElementById("examFontSelect");
    return s && s.value ? parseFloat(s.value) : 32;
}

/* Shrink (or grow back) ONE question page's font until its blocks fit the
   page budget. Measured live, so wrapping is accounted for - the page
   count NEVER grows from typing; only an explicit "Insert Page Break"
   gives a section more than one page. */
/* CHANGED (pack 17 - "the other exams after the first one is not
   displaying well"): the old proportional shrink OVERSHOT badly on phone
   fonts (Amiri measures far taller than Sakkal Majalla): one big
   overshoot slammed the font to the 12pt floor and STOPPED there with no
   grow-back, so exam 2, 3... printed TINY on half a page while exam 1
   stayed full-size. The fitter now binary-searches between the floor and
   the teacher's chosen size and keeps the LARGEST size that truly fits
   the page - every exam stays as readable as its content allows. */
function autoFitOnePage(page) {
    const content = page.querySelector(".page-content");
    if (!content) return null;
    const base = examBaseFontPt();
    const blocks = Array.from(content.children).filter(function (b) {
        return !b.classList.contains("manual-page-break");
    });
    if (!blocks.length) { content.style.fontSize = base + "pt"; return base; }

    const budget = budgetFor(page);
    const measure = function (pt) {
        content.style.fontSize = pt + "pt";
        let used = 0;
        blocks.forEach(function (b) { used += outerHeightPx(b); });
        return used;
    };

    // Fits at the teacher's chosen size? Keep it - the exact paper look.
    if (measure(base) <= budget + 1) return base;

    /* CHANGED (pack 25 - owner: "downloaded exam is missing questions"):
       even the floor cannot fit it -> return NULL so the caller SPILLS
       the questions onto more pages instead of clipping them off the
       bottom of a one-page sheet (questions silently vanished from the
       PDF before). */
    if (measure(EXAM_MIN_PT) > budget + 1) return null;

    // Binary search: LARGEST readable size that fits the one page.
    let lo = EXAM_MIN_PT, hi = base;
    for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        if (measure(mid) <= budget + 1) lo = mid; else hi = mid;
    }
    content.style.fontSize = (Math.floor(lo * 4) / 4) + "pt"; // tidy 0.25pt steps
    return parseFloat(content.style.fontSize);
}

/* NEW (pack 25 - owner: "downloaded exam is missing questions; page 6
   only takes one line"): when even the smallest readable size cannot
   fit a section on one page, SPILL the questions across as many pages
   as they need (a question is still never split). Before this, the
   extra questions sat below the page bottom and were cropped out of the
   downloaded PDF - on the phone the teacher also saw a body page that
   looked like it took only one line. Layout: identical to the manual
   page-break path, minus the markers. The section is flagged .spilled so
   the booklet-wide shared question size no longer forces it smaller. */
function spillSegmentAcrossPages(flow, seg) {
    const first = seg.bodies[0];
    const firstContent = first.querySelector(".page-content");
    firstContent.style.fontSize = EXAM_MIN_PT + "pt";
    seg.spilled = true;

    const blocks = Array.from(firstContent.children).filter(function (b) {
        return !b.classList.contains("manual-page-break");
    });
    let pageIdx = 0;
    let remaining = budgetFor(first);
    blocks.forEach(function (block) {
        const h = outerHeightPx(block);
        const budget = budgetFor(seg.bodies[pageIdx]);
        const pageAlreadyHasBlocks = remaining < budget - 0.5;
        if (h > budget + 1) {
            // single block taller than a page: own page, warning explains
            if (pageAlreadyHasBlocks) {
                pageIdx++;
                if (!seg.bodies[pageIdx]) seg.bodies.push(appendBodyPage(flow, seg.bodies[pageIdx - 1]));
            }
            placeBlock(block, seg.bodies[pageIdx]);
            pageIdx++;
            if (!seg.bodies[pageIdx]) seg.bodies.push(appendBodyPage(flow, seg.bodies[pageIdx - 1]));
            remaining = budgetFor(seg.bodies[pageIdx]);
        } else if (h > remaining + 1) {
            pageIdx++;
            if (!seg.bodies[pageIdx]) seg.bodies.push(appendBodyPage(flow, seg.bodies[pageIdx - 1]));
            placeBlock(block, seg.bodies[pageIdx]);
            remaining = budgetFor(seg.bodies[pageIdx]) - h;
        } else {
            placeBlock(block, seg.bodies[pageIdx]);
            remaining -= h;
        }
    });
}

/* Lay out ONE section (cover + its question pages).
   CHANGED (one page per exam - auto font fit): a section WITHOUT manual
   page breaks keeps exactly ONE question page - overflow shrinks the
   font instead of creating a new page, exactly as the school's printed
   papers (cover + one question page per exam). Sections where the
   teacher inserted a page break keep the classic multi-page layout. */
function paginateSegment(flow, seg) {
    if (!seg.bodies.length) {
        seg.bodies.push(appendBodyPage(flow, seg.cover));
    }

    const hasBreaks = seg.bodies.some(function (p) {
        return !!p.querySelector(".manual-page-break");
    });

    if (!hasBreaks) {
        // Merge every question of this section onto its single page, then
        // auto-fit the font. (Moving the SAME nodes keeps the caret.)
        const firstContent = seg.bodies[0].querySelector(".page-content");
        seg.bodies.forEach(function (page, i) {
            if (i === 0) return;
            const c = page.querySelector(".page-content");
            if (c) Array.from(c.children).forEach(function (b) { firstContent.appendChild(b); });
            page.remove();
        });
        seg.bodies = [seg.bodies[0]];
        seg.spilled = false; // pack 25: reset; re-detected below
        // pack 25: NULL = cannot fit even at the floor -> SPILL across
        // pages instead of letting questions vanish below the page edge.
        const fitPt = autoFitOnePage(seg.bodies[0]);
        if (fitPt === null && firstContent.children.length) {
            spillSegmentAcrossPages(flow, seg);
        }
        return;
    }

    // Collect every block in document order, inside this section only.
    const blocks = [];
    seg.bodies.forEach(function (page) {
        const content = page.querySelector(".page-content");
        if (content) {
            Array.from(content.children).forEach(function (b) { blocks.push(b); });
        }
    });

    let pageIdx = 0;
    let remaining = budgetFor(seg.bodies[0]);

    blocks.forEach(function (block) {
        // A forced page break: the marker itself hops to the top of the
        // next page and everything after it follows onto that page.
        if (block.classList.contains("manual-page-break")) {
            pageIdx++;
            if (!seg.bodies[pageIdx]) seg.bodies.push(appendBodyPage(flow, seg.bodies[pageIdx - 1]));
            placeBlock(block, seg.bodies[pageIdx]);
            remaining = budgetFor(seg.bodies[pageIdx]);
            return;
        }

        const h = outerHeightPx(block);
        const budget = budgetFor(seg.bodies[pageIdx]);
        const pageAlreadyHasBlocks = remaining < budget - 0.5;

        if (h > budget + 1) {
            // Block taller than a whole page: give it a page of its own
            // (it will overflow - the warning chip explains what to do).
            if (pageAlreadyHasBlocks) {
                pageIdx++;
                if (!seg.bodies[pageIdx]) seg.bodies.push(appendBodyPage(flow, seg.bodies[pageIdx - 1]));
            }
            placeBlock(block, seg.bodies[pageIdx]);

            // Following blocks continue on a fresh page.
            pageIdx++;
            if (!seg.bodies[pageIdx]) seg.bodies.push(appendBodyPage(flow, seg.bodies[pageIdx - 1]));
            remaining = budgetFor(seg.bodies[pageIdx]);
        } else if (h > remaining + 1) {
            // THE IMPORTANT RULE: doesn't fit in the remaining space,
            // so the WHOLE question moves to the next page - never split.
            pageIdx++;
            if (!seg.bodies[pageIdx]) seg.bodies.push(appendBodyPage(flow, seg.bodies[pageIdx - 1]));
            placeBlock(block, seg.bodies[pageIdx]);
            remaining = budgetFor(seg.bodies[pageIdx]) - h;
        } else {
            placeBlock(block, seg.bodies[pageIdx]);
            remaining -= h;
        }
    });

    // Remove trailing pages OF THIS SECTION that hold nothing (empty
    // pages vanish automatically; a page with a forced break marker is
    // kept) - but always keep at least one question page per section.
    for (let i = seg.bodies.length - 1; i > 0; i--) {
        const content = seg.bodies[i].querySelector(".page-content");
        const hasMarker = content && content.querySelector(".manual-page-break");
        const hasBlocks = content && content.children.length > 0;
        const isUsed = hasBlocks && Array.from(content.children).some(c =>
            !c.classList.contains("manual-page-break") || hasMarker
        );
        if (!content || (!content.children.length)) {
            seg.bodies[i].remove();
            seg.bodies.pop();
        } else if (!isUsed && !hasMarker) {
            seg.bodies[i].remove();
            seg.bodies.pop();
        } else {
            break;
        }
    }
    if (!seg.bodies.some(function (p) { return p.querySelector(".page-content"); })) {
        seg.bodies.push(appendBodyPage(flow, seg.bodies.length ? seg.bodies[seg.bodies.length - 1] : seg.cover));
    }
}

/* Overflow warning (screen-only): only reachable when a SINGLE block is
   taller than a page - it can never be split, so we flag it instead. */
function checkAllPagesOverflow() {
    document.querySelectorAll(".exam-page").forEach(function (page) {
        const content = page.querySelector(".page-content");
        if (!content) return;
        const budget = budgetFor(page);

        let used = 0;
        Array.from(content.children).forEach(function (b) {
            if (!b.classList.contains("manual-page-break")) used += outerHeightPx(b);
        });

        const over = used > budget + 4;
        page.classList.toggle("page-overfull", over);

        let chip = page.querySelector(".page-warn-chip");
        if (over) {
            if (!chip) {
                chip = document.createElement("div");
                chip.className = "page-warn-chip";
                chip.contentEditable = "false";
                chip.textContent = "\u26A0 One question here is taller than a whole page - try shrinking its image, spacing or font.";
                page.appendChild(chip);
            }
        } else if (chip) {
            chip.remove();
        }
    });
}

/* ==========================================================================
   6. PAGE BREAKS (Word-style, Ctrl+Enter feel)
========================================================================== */

// Kept name (was "+ New Page"): now inserts a forced page break at the
// text cursor - the engine does the actual page creation.
function insertPageBreak() {
    const flow = document.getElementById("examFlow");
    const marker = document.createElement("div");
    marker.className = "manual-page-break";
    marker.contentEditable = "false";
    marker.setAttribute("data-break", "1");

    // Try to insert at the caret; otherwise append at the end of the flow.
    const sel = window.getSelection();
    let inserted = false;
    if (sel && sel.rangeCount) {
        const node = sel.getRangeAt(0).startContainer;
        const hostBlock = (node.nodeType === 1 ? node : node.parentElement) &&
            (node.nodeType === 1 ? node : node.parentElement).closest(".page-content > *");
        if (hostBlock) {
            // Split: everything from the caret moves after the marker.
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const afterRange = range.cloneRange();
            afterRange.selectNodeContents(hostBlock);
            afterRange.setStart(range.endContainer, range.endOffset);
            const tail = afterRange.extractContents();
            hostBlock.parentNode.insertBefore(marker, hostBlock.nextSibling);
            if (tail.textContent.trim() !== "" || tail.querySelector && tail.querySelector("img,table,ul,ol")) {
                const tailBlock = document.createElement("p");
                tailBlock.appendChild(tail);
                marker.parentNode.insertBefore(tailBlock, marker.nextSibling);
            }
            inserted = true;
        }
    }

    if (!inserted) {
        // FIX (school paper design): cover has no content zone - make sure
        // one exists before appending the marker.
        let contents = flow.querySelectorAll(".page-content");
        if (!contents.length) {
            appendBodyPage(flow);
            contents = flow.querySelectorAll(".page-content");
        }
        contents[contents.length - 1].appendChild(marker);
    }

    paginateExam();

    // Move the caret to the start of the brand-new page so the teacher
    // can keep typing immediately (Word behaviour).
    const newPageContent = marker.closest(".page-content");
    if (newPageContent) {
        let firstEditable = marker.nextElementSibling;
        if (!firstEditable) {
            firstEditable = document.createElement("p");
            firstEditable.innerHTML = "<br>";
            newPageContent.insertBefore(firstEditable, marker.nextSibling);
        }
        const range = document.createRange();
        range.selectNodeContents(firstEditable);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        marker.closest(".exam-page").scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

// Kept name (was "- Remove Last Page"): removes the most recent forced
// break. Pages themselves are automatic, so there is nothing else to undo.
function removeLastPage() {
    const markers = document.querySelectorAll("#examFlow .manual-page-break");
    if (!markers.length) {
        if (window.amsToast) {
            window.amsToast("Pages are created automatically as you write - there is no manual page break to remove.", "info", 5000);
        } else {
            alert("No manual page break to remove.");
        }
        return;
    }
    markers[markers.length - 1].remove();
    paginateExam();
}

/* ==========================================================================
   7. RICH TEXT TOOLBAR (original + upgrades from request #2)
========================================================================== */

function format(command) {
    document.execCommand(command, false, null);
    paginateExamSoon();
}

function setFontSize() {
    const size = document.getElementById("fontSizeSelect").value;
    document.execCommand("fontSize", false, size);
    paginateExamSoon();
}

function setSpacing() {
    const spacing = document.getElementById("spacingSelect").value;
    document.querySelectorAll(".exam-body").forEach(body => {
        body.classList.remove("spacing-compact", "spacing-normal", "spacing-relaxed", "spacing-spacious");
        body.classList.add(`spacing-${spacing}`);
    });
    paginateExamSoon();
}

function toggleDirection() {
    // Applies to the whole flow (all page contents share one direction).
    const flow = document.getElementById("examFlow");
    flow.dir = flow.dir === "rtl" ? "ltr" : "rtl";
    paginateExamSoon();
}

function insertTable() {
    const rows = parseInt(prompt("How many rows?", "3"), 10);
    const cols = parseInt(prompt("How many columns?", "3"), 10);

    if (!rows || !cols || rows < 1 || cols < 1) {
        alert("Please enter valid numbers for rows and columns.");
        return;
    }

    let html = "<table>";
    for (let r = 0; r < rows; r++) {
        html += "<tr>";
        for (let c = 0; c < cols; c++) {
            html += "<td>&nbsp;</td>";
        }
        html += "</tr>";
    }
    html += "</table><p><br></p>";

    document.execCommand("insertHTML", false, html);
    paginateExamSoon();
}

// HARAKAT palette (manual diacritic insertion)
function insertHarakat(char) {
    document.execCommand("insertText", false, char);
    paginateExamSoon();
}

/* NEW (editor upgrade, request #2): maths/science symbol palette */
function toggleMathPalette() {
    const pal = document.getElementById("mathPalette");
    pal.style.display = pal.style.display === "none" ? "flex" : "none";
}

function insertSymbol(symbol) {
    document.execCommand("insertText", false, symbol);
    paginateExamSoon();
}

// Debounced re-pagination used by toolbar actions.
let paginateSoonTimer = null;
function paginateExamSoon() {
    clearTimeout(paginateSoonTimer);
    paginateSoonTimer = setTimeout(paginateExam, 200);
}

/* ==========================================================================
   8. IMAGES IN THE EXAM  (NEW - request #2)
   Insert, click-to-select, resize (buttons or corner grip), align, delete.
========================================================================== */

function insertExamImage(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        downscaleImage(e.target.result, file.type, 1500, function (dataUrl) {
            const html =
                '<p class="img-block" style="text-align:center;">' +
                `<img class="exam-img" src="${dataUrl}" style="width:60%;">` +
                "</p><p><br></p>";
            document.execCommand("insertHTML", false, html);
            paginateExam();
        });
    };
    reader.readAsDataURL(file);
}

// Big phone photos would make the exam file huge and the PDF slow
// (performance, request #8) - shrink to a sensible width first.
function downscaleImage(dataUrl, mimeType, maxWidth, done) {
    const img = new Image();
    img.onload = function () {
        if (img.width <= maxWidth && dataUrl.length < 1500000) {
            done(dataUrl); // small enough already
            return;
        }
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        // JPEG keeps the exam lean; PNG stays PNG when it was small+sharp.
        done(canvas.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = function () { done(dataUrl); };
    img.src = dataUrl;
}

let selectedExamImage = null;

function handleFlowClick(e) {
    const img = e.target.closest(".exam-img");
    if (img) {
        e.preventDefault();
        selectExamImage(img);
        return;
    }
    const toolBtn = e.target.closest(".img-tools button");
    if (toolBtn && selectedExamImage) {
        const action = toolBtn.getAttribute("data-action");
        applyImageAction(selectedExamImage, action);
    }
}

function selectExamImage(img) {
    deselectExamImage();
    selectedExamImage = img;
    img.classList.add("exam-img-selected");

    const tools = document.createElement("div");
    tools.className = "img-tools";
    tools.contentEditable = "false";
    tools.innerHTML =
        '<button type="button" data-action="smaller" title="Smaller">&#8722;</button>' +
        '<button type="button" data-action="bigger" title="Bigger">+</button>' +
        '<button type="button" data-action="left" title="Align left">&#8676;</button>' +
        '<button type="button" data-action="center" title="Center">&#8646;</button>' +
        '<button type="button" data-action="right" title="Align right">&#8677;</button>' +
        '<button type="button" data-action="delete" title="Remove image" class="img-tools-del">&#10005;</button>';

    const block = img.closest(".img-block") || img.parentElement;
    block.style.position = "relative";
    block.appendChild(tools);
    preventToolbarFocusLoss();
}

function deselectExamImage() {
    document.querySelectorAll(".img-tools").forEach(t => t.remove());
    document.querySelectorAll(".exam-img-selected").forEach(i => i.classList.remove("exam-img-selected"));
    selectedExamImage = null;
}

function deselectExamImageIfDeleted() {
    if (selectedExamImage && !document.body.contains(selectedExamImage)) {
        selectedExamImage = null;
    }
}

function applyImageAction(img, action) {
    const block = img.closest(".img-block") || img.parentElement;
    const current = parseFloat(img.style.width) || 60;

    if (action === "smaller") img.style.width = Math.max(10, current - 10) + "%";
    else if (action === "bigger") img.style.width = Math.min(100, current + 10) + "%";
    else if (action === "left") block.style.textAlign = "left";
    else if (action === "center") block.style.textAlign = "center";
    else if (action === "right") block.style.textAlign = "right";
    else if (action === "delete") {
        const p = block.closest("p") || block;
        p.remove();
        deselectExamImage();
    }
    paginateExam();
}

/* ==========================================================================
   9. VOICE NOTE (browser-native speech recognition)
========================================================================== */

let recognition = null;
let isRecording = false;

function toggleVoice() {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
        alert("Voice input isn't supported in this browser. Please try Google Chrome.");
        return;
    }

    const voiceBtn = document.getElementById("voiceBtn");

    if (isRecording) {
        recognition.stop();
        return;
    }

    recognition = new SpeechRecognitionAPI();
    recognition.lang = document.getElementById("voiceLang").value;
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = function () {
        isRecording = true;
        voiceBtn.classList.add("recording");
        voiceBtn.textContent = "\u23F9 Stop";
    };

    recognition.onresult = function (event) {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        if (transcript.trim() !== "") {
            document.execCommand("insertText", false, transcript + " ");
            paginateExamSoon();
        }
    };

    recognition.onerror = function (event) {
        console.log("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
            alert("Microphone access was blocked. Please allow microphone permission and try again.");
        }
    };

    recognition.onend = function () {
        isRecording = false;
        voiceBtn.classList.remove("recording");
        voiceBtn.innerHTML = "&#127908; Voice";
    };

    recognition.start();
}

/* ==========================================================================
   10. SAVE / LOAD
   New storage shape: body_html = the flow HTML as ONE string (manual page
   break markers included). Old exams stored a JSON array of page strings -
   loadExam() joins them back into the flow and re-paginates, so nothing
   old breaks.
========================================================================== */

function serializeFlow() {
    deselectExamImage(); // never persist the on-screen image tools
    const flow = document.getElementById("examFlow");
    const covers = flow.querySelectorAll(".exam-page.page-one");

    if (covers.length <= 1) {
        // Single exam - the classic format: questions only, one string.
        let html = "";
        flow.querySelectorAll(".page-content").forEach(function (content) {
            html += content.innerHTML;
        });
        return html;
    }

    // NEW (multi-exam in one PDF): save the WHOLE flow - every cover with
    // its own exam information and every question zone - cleaned of the
    // screen-only helpers. Loading brings back all sections exactly.
    const clone = flow.cloneNode(true);
    clone.querySelectorAll(".page-warn-chip, .img-tools, .cover-remove").forEach(function (el) { el.remove(); });
    clone.querySelectorAll(".page-overfull").forEach(function (el) { el.classList.remove("page-overfull"); });
    return clone.innerHTML;
}

function saveExam() {
    const title = document.getElementById("examTitle").value.trim();
    const cls = document.getElementById("examClass").value;
    const subject = document.getElementById("examSubject").value;
    const term = document.getElementById("examTerm").value;
    const session = document.getElementById("examSession").value;
    const duration = document.getElementById("examDuration").value.trim();
    // NEW (pack 22): optional exam date - feeds the portal exam timetable.
    const examDate = (document.getElementById("examDate") || {}).value || "";
    // CHANGED (multi-exam in one PDF): the classic "instructions" column
    // stores the FIRST cover's instructions; extra covers keep their own
    // inside the saved flow (see serializeFlow).
    const instructions = document.querySelector("#coverPage .js-cover-instructions").innerHTML;

    if (!title || !cls || !subject || !term || !session) {
        alert("Please fill in the Exam Title and all the fields in the details step before saving.");
        return;
    }

    const payload = {
        id: currentExamId,
        title,
        class_name: cls,
        subject,
        term,
        session,
        duration,
        exam_date: examDate, // NEW (pack 22)
        instructions,
        body_html: serializeFlow() // single flow string (was: JSON page array)
    };

    fetch("/save-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        if (window.amsToast) window.amsToast(data.message, "success", 4000);
        else alert(data.message);
        if (data.id) currentExamId = data.id;
    })
    .catch(error => {
        console.log(error);
        alert("Error saving exam.");
    });
}

function openLoadPanel() {
    fetch("/exams")
        .then(response => response.json())
        .then(exams => {
            const table = document.getElementById("savedExamsTable");
            table.innerHTML = `
                <tr>
                    <th>Title</th>
                    <th>Class</th>
                    <th>Subject</th>
                    <th>Term</th>
                    <th>Session</th>
                    <th>Action</th>
                </tr>
            `;

            exams.forEach(exam => {
                const row = table.insertRow();
                row.insertCell(0).textContent = exam.title;
                row.insertCell(1).textContent = exam.class_name;
                row.insertCell(2).textContent = exam.subject;
                row.insertCell(3).textContent = exam.term;
                row.insertCell(4).textContent = exam.session;
                row.insertCell(5).innerHTML = `
                    <button type="button" onclick="askLoadExamStep(${exam.id}, this)">Open</button>
                    <button type="button" onclick="deleteExamFromPanel(${exam.id})" style="background:#8C3B2E; border-color:#8C3B2E; color:#fff;">Delete</button>
                `;
            });

            document.getElementById("loadPanelOverlay").style.display = "flex";
        })
        .catch(error => {
            console.log(error);
            alert("Error loading saved exams.");
        });
}

function closeLoadPanel() {
    document.getElementById("loadPanelOverlay").style.display = "none";
}

/* NEW (pack 18 - owner request): opening a saved exam first ASKS where to
   take the teacher - Step 1 (details) or Step 2 (writing). Until pack 17
   a saved exam always jumped straight to Step 2. */
let pendingLoadExamId = null;

function askLoadExamStep(id, btn) {
    pendingLoadExamId = id;
    const row = btn && btn.closest ? btn.closest("tr") : null;
    const name = row && row.cells && row.cells[0] ? row.cells[0].textContent : "";
    document.getElementById("loadStepExamName").textContent = name;
    const ovl = document.getElementById("loadStepOverlay");
    const b1 = document.getElementById("loadStepBtn1");
    const b2 = document.getElementById("loadStepBtn2");
    b1.onclick = function () { chooseLoadExamStep(1); };
    b2.onclick = function () { chooseLoadExamStep(2); };
    ovl.style.display = "flex";
}

function closeLoadStepPanel() {
    document.getElementById("loadStepOverlay").style.display = "none";
    pendingLoadExamId = null;
}

function chooseLoadExamStep(step) {
    const id = pendingLoadExamId;
    document.getElementById("loadStepOverlay").style.display = "none";
    pendingLoadExamId = null;
    if (!id) return;
    loadExam(id, step);
}

// CHANGED (pack 18): loadExam() now takes the wizard step to land on
// (1 = details, 2 = writing). Plain loadExam(id) calls keep the old
// straight-to-Step-2 behaviour (default = 2).
function loadExam(id, gotoStep) {
    fetch(`/exam/${id}`)
        .then(response => response.json())
        .then(exam => {
            currentExamId = exam.id;

            document.getElementById("examTitle").value = exam.title;
            document.getElementById("examTerm").value = exam.term;
            document.getElementById("examSession").value = exam.session;
            document.getElementById("examDuration").value = exam.duration || "";
            // NEW (pack 22): restore the saved exam date when present.
            const dateEl = document.getElementById("examDate");
            if (dateEl) dateEl.value = exam.exam_date ? String(exam.exam_date).slice(0, 10) : "";

            document.getElementById("examClass").value = exam.class_name;

            // FIX (pack 17): make the saved subject selectable IMMEDIATELY -
            // the subject list loads asynchronously, and the new
            // straight-to-Step-2 jump validates Class+Subject+Term+Session,
            // so the value must be in place BEFORE the gate runs.
            const subjectSelect = document.getElementById("examSubject");
            if (exam.subject) {
                if (!Array.from(subjectSelect.options).some(o => o.value === exam.subject)) {
                    subjectSelect.innerHTML += `<option value="${exam.subject}">${exam.subject}</option>`;
                }
                subjectSelect.value = exam.subject;
            }

            // FIX (pack 18): same trick for Term/Session (and Class) - an
            // exam saved in an old session/term that is no longer in the
            // static lists made the Step-2 gate fail and stranded the
            // teacher back on Step 1. Keep saved values selectable.
            [["examTerm", exam.term], ["examSession", exam.session], ["examClass", exam.class_name]].forEach(function (pair) {
                const sel = document.getElementById(pair[0]);
                const val = pair[1];
                if (sel && val && !Array.from(sel.options).some(o => o.value === val)) {
                    sel.innerHTML += `<option value="${val}">${val}</option>`;
                }
                if (sel && val) sel.value = val;
            });

            fetch(`/subjects?class=${encodeURIComponent(exam.class_name)}`)
                .then(response => response.json())
                .then(subjects => {
                    // Keep a saved subject selectable even if it is disabled now.
                    const saved = subjectSelect.value;
                    subjectSelect.innerHTML = '<option value="" disabled>Select Subject</option>';
                    subjects.forEach(subject => {
                        subjectSelect.innerHTML += `<option value="${subject.subject_name}">${subject.subject_name}</option>`;
                    });
                    if (exam.subject && !Array.from(subjectSelect.options).some(o => o.value === exam.subject)) {
                        subjectSelect.innerHTML += `<option value="${exam.subject}">${exam.subject}</option>`;
                    }
                    subjectSelect.value = exam.subject || saved;
                });

            // CHANGED (multi-exam in one PDF): multi-exam saves carry each
            // cover's own instructions inside the flow itself, so the
            // classic instructions column is only applied to single exams.
            const isMultiSave = exam.body_html && exam.body_html.indexOf("page-one") !== -1;
            if (exam.instructions && !isMultiSave) {
                document.querySelector("#coverPage .js-cover-instructions").innerHTML = exam.instructions;
            }

            generateCoverPage();

            // Merge whatever was stored into ONE flow string.
            let flowHtml;
            try {
                const parsed = JSON.parse(exam.body_html);
                if (Array.isArray(parsed)) {
                    flowHtml = parsed.join("");       // legacy: page-array format
                } else if (typeof parsed === "string") {
                    flowHtml = parsed;                 // JSON-encoded single string
                } else {
                    flowHtml = exam.body_html;
                }
            } catch (e) {
                flowHtml = exam.body_html;             // plain string (new format)
            }

            resetFlow(flowHtml);
            closeLoadPanel();
            fitAllCoverOneLiners();
            // CHANGED (pack 17 - owner request): a SAVED exam opened for
            // editing goes straight to Step 2 (the writing/editing tools),
            // not back to the details step. The wizard fields are already
            // filled from the saved record, so the step-2 gate passes.
            // CHANGED (pack 18 - owner request): the chooser now decides -
            // Step 1 (details) or Step 2 (writing). Default stays Step 2.
            examGotoStep(gotoStep === 1 ? 1 : 2);
        })
        .catch(error => {
            console.log(error);
            alert("Error loading exam.");
        });
}

// Replace the question flow with new HTML and lay it out afresh.
// NEW (multi-exam in one PDF): multi-exam saves contain the whole flow
// (every cover + questions) - they restore wholesale. Classic single-exam
// saves (questions only) load exactly as before.
function resetFlow(flowHtml) {
    const flow = document.getElementById("examFlow");
    const isMulti = flowHtml && flowHtml.indexOf("page-one") !== -1;

    if (isMulti) {
        flow.innerHTML = flowHtml;
        paginateExam(); // re-stamps covers, re-adds remove buttons, re-fits
        return;
    }

    // Drop any extra covers and every question page, keep the first cover.
    const covers = Array.from(flow.querySelectorAll(".exam-page.page-one"));
    covers.forEach(function (cover, i) { if (i > 0) cover.remove(); });
    flow.querySelectorAll(".exam-page:not(.page-one)").forEach(p => p.remove());
    const firstCover = flow.querySelector(".exam-page.page-one");
    if (firstCover) buildCover(firstCover);

    // The cover is pure chrome, so the loaded questions go onto a fresh
    // body page, never onto page 1.
    const firstBody = appendBodyPage(flow);
    firstBody.querySelector(".page-content").innerHTML =
        flowHtml && flowHtml.trim() !== "" ? flowHtml : "<p><br></p>";

    paginateExam();
}

function deleteExamFromPanel(id) {
    const confirmed = confirm("Delete this exam permanently?");
    if (!confirmed) return;

    fetch(`/exam/${id}`, { method: "DELETE" })
        .then(response => response.json())
        .then(data => {
            alert(data.message);
            openLoadPanel();
        })
        .catch(error => {
            console.log(error);
            alert("Error deleting exam.");
        });
}

/* ==========================================================================
   11. PRINT + PDF
========================================================================== */

// Called by the "Print / Save as PDF" button.
// CHANGED (phone print fix): Android Chrome silently IGNORES window.print() -
// pressing Print on the phone genuinely did nothing ("print is not
// displaying anything"). On Android we now build the same A4 PDF and open
// it, so printing/sharing happens from the phone's own PDF viewer. Other
// devices keep the normal print dialog.
function examPrint() {
    if (/Android/i.test(navigator.userAgent)) {
        downloadExamPDF(true); // true = open the PDF in the phone viewer
        return;
    }
    paginateExam(); // fresh layout before printing, just in case
    // The phone view-zoom (updateExamZoom) uses a transform + negative
    // margin. Clear them around print so the paper always prints at the
    // true A4 size (the @media print rules also force the same).
    var flow = document.getElementById("examFlow");
    var savedT = flow ? flow.style.transform : "";
    var savedM = flow ? flow.style.marginBottom : "";
    if (flow) { flow.style.transform = ""; flow.style.marginBottom = ""; }
    window.print();
    if (flow) { flow.style.transform = savedT; flow.style.marginBottom = savedM; }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && window.amsToast) {
        window.amsToast(
            "Phone tip: on mobile use the browser menu (\u22EE) \u2192 Share \u2192 Print.",
            "info",
            6500
        );
    }
}

// NEW (device-proof PDF capture): on a phone the downloader used to
// photograph each page exactly as the phone displayed it - and phones laid
// the page out narrower and TALLER than real A4. One tall page then made the
// old fit-shrinking shrink EVERY PDF page with fat white margins (the
// "looks fine on the site, broken after download" bug). Fix: photograph a
// hidden, exact full-size A4 COPY of each page instead (.pdf-capture-stage
// in css/exam.css pins the copy to 210x297mm and crops at the page edge),
// so phone, tablet and laptop now produce identical full-page PDFs and the
// global fit below stays at 1 (no shrinking) by construction.
function capturePageAsA4(page) {
    var stage = document.createElement("div");
    // ams-capturing on the stage reuses the same css rules, so screen-only
    // chips/tools/the cover-delete button stay hidden in the copy too.
    stage.className = "pdf-capture-stage ams-capturing";
    stage.setAttribute("aria-hidden", "true");

    var clone = page.cloneNode(true);
    clone.removeAttribute("id");
    // The copy lives in the same document for a moment - no duplicate ids.
    clone.querySelectorAll("[id]").forEach(function (el) { el.removeAttribute("id"); });
    stage.appendChild(clone);
    document.body.appendChild(stage);

    // Wait for web fonts so the Arabic text measures/paints exactly like on screen.
    var fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
    return fontsReady.then(function () {
        return html2canvas(clone, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    }).then(function (cv) {
        stage.remove();
        return cv;
    }, function (err) {
        stage.remove();
        throw err;
    });
}

/* FIX (pack 23 - owner: "the exam only shows the first page when downloaded;
   I don't want any problem from the exam again"): on some phones the canvas
   snapshot of a later page can fail silently (memory/canvas limits) and the
   page simply vanished from the PDF. Now each page is tried at scale 2,
   then retried at 1.5 and 1 (smaller canvases = far less memory) before we
   ever give up - and we NEVER quietly drop a page: a clearly-labelled
   fallback sheet takes its place so the PDF always has the full page count
   and the teacher is told which page needs a retry. */
/* CHANGED (pack 27 - owner: "The page 4 of the exam is not downloading"):
   phone memory was the real enemy - each A4 snapshot at scale 2 is a
   ~17-megapixel canvas (~35MB of RAM), and by the 4th page many phones
   silently killed the capture (the page then vanished from the PDF).
   Phones now START at a lighter scale and step down from there; laptops
   keep full quality. `lite=true` (the automatic second-chance pass) goes
   straight to the lightest scales - a slightly softer page always beats a
   missing page. */
function capturePageScales(lite) {
    var phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.deviceMemory && navigator.deviceMemory <= 4);
    if (lite) return [1.25, 1];
    return phone ? [1.75, 1.5, 1.25, 1] : [2, 1.5, 1];
}
function capturePageWithRetries(page, lite) {
    var scales = capturePageScales(lite);
    function attempt(i) {
        if (i >= scales.length) return Promise.reject(new Error("capture failed"));
        var stage = document.createElement("div");
        stage.className = "pdf-capture-stage ams-capturing";
        stage.setAttribute("aria-hidden", "true");
        var clone = page.cloneNode(true);
        clone.removeAttribute("id");
        clone.querySelectorAll("[id]").forEach(function (el) { el.removeAttribute("id"); });
        stage.appendChild(clone);
        document.body.appendChild(stage);
        var fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
        return fontsReady.then(function () {
            return html2canvas(clone, { scale: scales[i], backgroundColor: "#ffffff", useCORS: true });
        }).then(function (cv) {
            stage.remove();
            // A blank/empty canvas (0x0 or 1x1) is as bad as a thrown error.
            if (!cv || cv.width < 10 || cv.height < 10) throw new Error("empty canvas");
            return cv;
        }).catch(function (err) {
            try { stage.remove(); } catch (e) {}
            // brief pause lets the phone reclaim memory before the retry
            return new Promise(function (resolve) { setTimeout(resolve, 250); }).then(function () { return attempt(i + 1); });
        });
    }
    return attempt(0);
}

// Clear, honest stand-in sheet used only if a page STILL cannot be captured
// after all retries - the PDF stays complete and the problem is visible.
function buildFallbackPageCanvas(pageNumber) {
    var cv = document.createElement("canvas");
    cv.width = 1240; cv.height = 1754;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#14532d"; ctx.font = "bold 46px Arial"; ctx.textAlign = "center";
    ctx.fillText("Page " + pageNumber + " failed to render", cv.width / 2, 780);
    ctx.fillStyle = "#5B6B62"; ctx.font = "30px Arial";
    ctx.fillText("Please press Download again - or contact the office", cv.width / 2, 850);
    ctx.fillText("and this page will be re-made.", cv.width / 2, 895);
    return cv;
}

// Downloads the whole exam as ONE consistent A4 PDF. Since the engine now
// lays pages out perfectly, the global fit is almost always exactly 1 -
// the per-page scale still protects against any odd oversized block,
// and every page shares it, so formatting stays identical page to page.
// CHANGED: openInViewer=true opens the finished PDF in the phone's own
// PDF viewer instead of just downloading it (used by the Print button on
// Android, where window.print() is ignored by the browser).
function downloadExamPDF(openInViewer) {
    if (!window.jspdf || !window.html2canvas) {
        if (window.amsToast) window.amsToast("PDF generator is still loading - try again in a moment.", "info");
        return;
    }

    paginateExam(); // fresh layout before rendering, just in case

    var pages = Array.from(document.querySelectorAll(".exam-page")).filter(function (page) {
        // Skip pages with no visible content (safety net; engine prunes them).
        var content = page.querySelector(".page-content");
        if (!content) return true; // letterhead always prints
        var hasMeaningful = Array.from(content.children).some(function (b) {
            if (b.classList.contains("manual-page-break")) return false;
            return (b.textContent || "").trim() !== "" || b.querySelector("img,table,ul,ol");
        });
        return hasMeaningful || page.classList.contains("page-one");
    });

    if (!pages.length) {
        if (window.amsToast) window.amsToast("Write the exam first.", "info");
        return;
    }
    if (window.amsToast) window.amsToast("Building PDF\u2026 please wait.", "info", 2500);

    var flow = document.getElementById("examFlow");
    flow.classList.add("ams-capturing"); // hides screen-only chips/tools
    deselectExamImage();

    /* CHANGED (pack 27 - owner: "The page 4 of the exam is not downloading"):
       we used to keep EVERY page's giant canvas alive until the end - a
       handful of ~35MB canvases that crashed the tab on ordinary phones
       mid-way (the download simply died around page 4). Now each captured
       page is compressed to a JPEG string IMMEDIATELY and its canvas is
       destroyed before the next page starts, so memory stays flat no
       matter how many pages the exam has. */
    function canvasToShot(cv) {
        var shot = null;
        try {
            shot = { url: cv.toDataURL("image/jpeg", 0.93), w: cv.width, h: cv.height };
            if (!shot.url || shot.url.length < 50) shot = null; // corrupt encode = treat as failure
        } catch (e) { shot = null; }
        try { cv.width = 0; cv.height = 0; } catch (e) {}       // free the RAM either way
        // throw -> the caller's .catch counts this page for the second-chance pass
        if (!shot) throw new Error("jpeg encode failed");
        return shot;
    }

    var images = [];      // one {url,w,h} per page - cheap strings, no canvases
    var failedPages = []; // pages that needed an automatic second chance
    var i = 0;
    var phonePace = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    function captureNext() {
        if (i >= pages.length) {
            secondChance(finishPdf); // NEW (pack 27): failed pages get one more try
            return;
        }
        var pageNum = i + 1;
        capturePageWithRetries(pages[i], false)
            .then(function (cv) { images[i] = canvasToShot(cv); })
            .catch(function () {
                console.log("Exam PDF: page " + pageNum + " could not be captured (will retry once more).");
                failedPages.push(pageNum);
                images[i] = null; // placeholder - second chance or fallback fills it
            })
            .then(function () {
                i++;
                // small pause between pages: keeps phone memory healthy on
                // long exams; phones get a slightly longer breather.
                setTimeout(captureNext, phonePace ? 140 : 60);
            });
    }

    /* NEW (pack 27): automatic second chance. If any page failed its first
       capture (phone memory hiccup), wait a moment, then re-capture JUST
       those pages at the lightest quality. Only a page that fails TWICE
       becomes the labelled fallback sheet - so a busy phone no longer
       "loses" page 4. */
    function secondChance(done) {
        if (!failedPages.length) return done();
        var queue = failedPages.slice();
        var stillFailed = [];
        if (window.amsToast) {
            window.amsToast("Almost there - retrying page(s) " + queue.join(", ") + "\u2026", "info", 3200);
        }
        function redoOne() {
            if (!queue.length) {
                // whatever is still missing becomes a labelled fallback sheet
                stillFailed.forEach(function (pNum) {
                    try { images[pNum - 1] = canvasToShot(buildFallbackPageCanvas(pNum)); }
                    catch (e) { /* the slot stays empty only if even plain drawing failed */ }
                });
                failedPages = stillFailed;
                return done();
            }
            var pNum = queue.shift();
            setTimeout(function () {
                capturePageWithRetries(pages[pNum - 1], true) // lite mode: lightest scales
                    .then(function (cv) { images[pNum - 1] = canvasToShot(cv); })
                    .catch(function () { stillFailed.push(pNum); })
                    .then(redoOne);
            }, 450);
        }
        redoOne();
    }

    function finishPdf() {
        flow.classList.remove("ams-capturing");

        images = images.filter(Boolean);
        if (!images.length) {
            if (window.amsToast) window.amsToast("Could not build the PDF - please try again.", "error");
            return;
        }

        // ONE global fit for ALL pages: identical margins + text size.
        var fits = images.map(function (im) {
            var hMmAtFullWidth = (im.h * 210) / im.w;
            return hMmAtFullWidth > 297 ? 297 / hMmAtFullWidth : 1;
        });
        var globalFit = Math.min.apply(null, fits.concat([1]));
        var shrunkPages = fits.filter(function (f) { return f < 0.999; }).length;

        var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });

        images.forEach(function (im, idx) {
            var hMmAtFullWidth = (im.h * 210) / im.w;
            var finalW = 210 * globalFit;
            var finalH = Math.min(hMmAtFullWidth * globalFit, 297);
            if (idx > 0) pdf.addPage();
            pdf.addImage(im.url, "JPEG", (210 - finalW) / 2, 0, finalW, finalH);
        });
        images = []; // release the strings too

        if (openInViewer && typeof pdf.output === "function") {
            // Android print path: open the PDF so it can be printed/shared
            // from the phone's viewer. Popup blocked? Fall back to download.
            try {
                var blobUrl = pdf.output("bloburl");
                var win = window.open(blobUrl, "_blank");
                if (!win) pdf.save("exam.pdf");
            } catch (e) {
                pdf.save("exam.pdf");
            }
        } else {
            pdf.save("exam.pdf");
        }

        if (window.amsToast) {
            if (failedPages.length) {
                window.amsToast(
                    "PDF downloaded, but page(s) " + failedPages.join(", ") + " really could not be drawn on this device - those sheets are marked inside the PDF. Please press Download again.",
                    "error", 9000
                );
            } else if (shrunkPages > 0) {
                window.amsToast(
                    "PDF downloaded \u2713 One block was too tall for its page, so all pages were slightly shrunk to keep one consistent look.",
                    "info", 7000
                );
            } else {
                window.amsToast("PDF downloaded \u2713 all pages included - open it and print/share from your phone", "success", 6000);
            }
        }
    }

    captureNext();
}

/* ==========================================================================
   NEW (pack 17 - owner request): "download as word document for external
   editing". Builds a Word-compatible .doc (HTML markup that Word/WPS opens
   FULLY editable) from the live pages: every cover and every question
   page in order, one Word page per exam page. Images are referenced by
   their full URL (they ship with the site, so Word fetches them online).
   The PDF stays the exact-print format; the .doc is for typing changes -
   it keeps the paper styling closely but is not pixel-perfect by design.
========================================================================== */
function downloadExamWord() {
    paginateExam(); // fresh layout, same as the PDF path
    const pages = Array.from(document.querySelectorAll("#examFlow .exam-page"));
    if (!pages.length) {
        if (window.amsToast) window.amsToast("Write the exam first.", "info");
        return;
    }
    const origin = location.origin;

    const pageHtml = pages.map(function (page) {
        const isCover = page.classList.contains("page-one");
        const clone = page.cloneNode(true);
        // Screen-only aids never enter the Word file.
        clone.querySelectorAll(".cover-remove,.page-warn-chip,.manual-page-break").forEach(function (el) { el.remove(); });
        // Word fetches pictures online -> absolute URLs needed.
        clone.querySelectorAll("img").forEach(function (img) {
            const src = img.getAttribute("src") || "";
            if (src && !/^(https?:|data:)/i.test(src)) {
                img.setAttribute("src", origin + "/" + src.replace(/^\/+/, ""));
            }
        });
        const content = isCover ? clone : (clone.querySelector(".page-content") || clone);
        const sizeRule = (!isCover && content.style && content.style.fontSize)
            ? "font-size:" + content.style.fontSize + ";" : "";
        return `<div dir="rtl" style="width:178mm; margin:0 auto; padding:10mm 12mm; box-sizing:border-box; ${sizeRule}">${content.innerHTML}</div>`;
    }).join(`<br clear="all" style="page-break-before:always; mso-special-character:line-break;">`);

    // The paper styling, translated into Word-safe CSS (fonts come with
    // Windows/Office - Sakkal Majalla, Traditional Arabic, Times).
    const css = `
      body{ direction:rtl; text-align:right; font-family:'Sakkal Majalla','Traditional Arabic','Amiri',serif; font-weight:bold; }
      p{ margin:0 0 6px 0; }
      .cover-header{ text-align:center; }
      .cover-bismillah{ display:block; width:42mm; margin:0 auto 3mm; }
      .cover-logo{ display:block; width:40mm; margin:0 auto 2mm; }
      .cover-arabic-name{ font-size:30pt; font-weight:bold; text-align:center; margin:1mm 0 2mm; }
      .cover-english-name{ font-family:'Times New Roman',Times,serif; font-size:17pt; font-weight:bold; text-align:center; margin:0 0 5mm; }
      .cover-divider{ height:5mm; background:#000; margin:0 -20mm 6mm -10mm; }
      .cover-address{ font-family:'Times New Roman',Times,serif; font-size:16pt; font-weight:bold; text-align:center; margin:0 0 3mm; }
      .cover-tel,.cover-email{ font-family:'Times New Roman',Times,serif; font-size:18pt; font-weight:bold; text-align:center; margin:0 0 2mm; }
      .cover-email a{ color:#0563C1; }
      .cover-motto{ font-family:'Times New Roman',Times,serif; font-size:16pt; font-weight:bold; text-align:center; margin:0 0 4mm; }
      .cover-motto .motto-ar{ font-family:'Sakkal Majalla','Traditional Arabic','Amiri',serif; }
      .cover-exam-period{ font-size:20pt; font-weight:bold; text-align:center; margin:0 0 5mm; }
      .cover-info-table{ width:100%; border-collapse:collapse; margin:0 0 1mm; }
      .cover-info-table td{ font-size:20pt; font-weight:bold; border:none; padding:.5mm 2px; }
      .blank-line{ border-bottom:2px solid #000; }
      .blank-line-short{ border-bottom:2px solid #000; width:45mm; }
      .cover-instructions p{ font-size:20pt; font-weight:bold; margin:0; }
      .cover-footer{ margin-top:12mm; }
      .cover-footer .cover-wish{ font-size:14pt; text-align:left; }
      .cover-footer .cover-code{ font-family:'Times New Roman',Times,serif; font-weight:bold; text-align:center; }
      ol{ list-style-type:arabic-indic; }
      table{ border-collapse:collapse; }
      td,th{ border:1px solid #000; padding:4px; }
    `;

    const doc =
        `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Exam</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>@page Section1 { size:595.3pt 841.9pt; margin:36pt; } div.Section1 { page:Section1; } ${css}</style>
</head><body><div class="Section1">${pageHtml}</div></body></html>`;

    const raw = (document.getElementById("examTitle") || {}).value || "exam";
    const safe = (raw.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) || "exam");
    const blob = new Blob(["\ufeff", doc], { type: "application/msword" }); // BOM => Arabic reads right in Word
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = safe + ".doc";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    if (window.amsToast) {
        window.amsToast("Word file downloaded — open it in Word/WPS to edit, then print from there.", "success", 6000);
    }
}

/* ==========================================================================
   NEW (pack 27 - owner: "Can we build ai inside the project"):
   AI EXAM QUESTION GENERATOR.
   --------------------------------------------------------------------------
   The teacher types a TOPIC; the AI (server route /api/ai/exam-questions)
   drafts numbered questions which are inserted into the paper as ordinary
   paragraphs - indistinguishable from typed text, so pagination, auto-fit,
   printing, saving and downloading all work on them exactly as before.
   Numbering CONTINUES from the questions already on the paper (adding
   10 AI questions after 14 hand-written ones gives questions 15-24).
   AI proposes, the teacher disposes: everything stays editable.
   ========================================================================== */
function amsAiEsc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

/* The content zone new questions go to: the LAST question page's zone
   (the pagination engine spreads them across pages from there). */
function amsAiTargetZone() {
    var zones = document.querySelectorAll("#examFlow .exam-page .page-content");
    return zones.length ? zones[zones.length - 1] : null;
}

/* Highest hand-typed question number on the paper so far (so AI questions
   continue the sequence instead of restarting at 1). */
function amsAiNextNumber() {
    var max = 0;
    document.querySelectorAll("#examFlow .page-content p, #examFlow .page-content li, #examFlow .page-content div")
        .forEach(function (el) {
            var m = (el.textContent || "").match(/^\s*(\d{1,3})\s*[.)]/);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
    return max + 1;
}

window.amsOpenAiModal = function () {
    var flow = document.getElementById("examFlow");
    if (!flow || !flow.querySelector(".exam-page")) {
        if (window.amsToast) window.amsToast("Generate the cover page first (Step 1), then let the AI write questions.", "info");
        return;
    }
    // Show which exam the AI is writing for (read-only, taken from Step 1).
    var clsSel = document.getElementById("examClass");
    var subSel = document.getElementById("examSubject");
    var clsTxt = clsSel && clsSel.selectedIndex >= 0 ? clsSel.options[clsSel.selectedIndex].text : "";
    var subTxt = subSel && subSel.selectedIndex >= 0 ? subSel.options[subSel.selectedIndex].text : "";
    var who = [subTxt && subTxt.indexOf("Select") !== 0 ? subTxt : "", clsTxt && clsTxt.indexOf("Select") !== 0 ? clsTxt : ""]
        .filter(Boolean).join(" · ");
    document.getElementById("amsAiFor").textContent = who ? ("for " + who) : "for this exam";

    var modal = document.getElementById("amsAiModal");
    modal.style.display = "flex";
    if (!modal.dataset.boundClose) { // click the dim area = close (bind once)
        modal.dataset.boundClose = "1";
        modal.addEventListener("click", function (ev) { if (ev.target === modal) window.amsCloseAiModal(); });
    }
    var st = document.getElementById("amsAiStatus");
    st.textContent = "";
    st.className = "ams-ai-status";
    setTimeout(function () { document.getElementById("amsAiTopic").focus(); }, 60);
};

window.amsCloseAiModal = function () {
    document.getElementById("amsAiModal").style.display = "none";
};

window.amsGenerateAiQuestions = function () {
    var topic = (document.getElementById("amsAiTopic").value || "").trim();
    var st = document.getElementById("amsAiStatus");
    if (!topic) {
        st.textContent = "Type a topic first - e.g. Surah Al-Fatihah, or Fractions.";
        st.className = "ams-ai-status err";
        return;
    }
    var clsSel = document.getElementById("examClass");
    var subSel = document.getElementById("examSubject");
    var payload = {
        className: clsSel && clsSel.selectedIndex >= 0 ? clsSel.options[clsSel.selectedIndex].text : "",
        subject: subSel && subSel.selectedIndex >= 0 ? subSel.options[subSel.selectedIndex].text : "",
        topic: topic,
        count: parseInt(document.getElementById("amsAiCount").value, 10) || 5,
        qtype: document.getElementById("amsAiType").value,
        marks: (document.getElementById("amsAiMarks").value || "").trim()
    };
    var go = document.getElementById("amsAiGo");
    go.disabled = true;
    st.textContent = "The AI is writing " + payload.count + " question(s)\u2026 (usually under 20 seconds)";
    st.className = "ams-ai-status busy";

    fetch("/api/ai/exam-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
            if (!res.ok) {
                st.textContent = res.d && res.d.error ? res.d.error : "The AI stumbled - try again.";
                st.className = "ams-ai-status err";
                return;
            }
            var list = res.d.questions || [];
            var zone = amsAiTargetZone();
            if (!zone) {
                st.textContent = "Generate the cover page first.";
                st.className = "ams-ai-status err";
                return;
            }
            var marksTxt = payload.marks ? " (" + payload.marks + (/\d/.test(payload.marks) && !/mark/i.test(payload.marks) ? " marks" : "") + ")" : "";
            var n = amsAiNextNumber();
            var added = 0;
            list.forEach(function (q) {
                var p = document.createElement("p");
                var html = "<b>" + n + ".</b> " + amsAiEsc(q.question) + amsAiEsc(marksTxt);
                if (q.options && q.options.length) {
                    // normalise option labels to A. B. C. D. whatever the AI sent
                    var opts = q.options.map(function (o, j) {
                        var clean = String(o).replace(/^\s*[A-Fa-f]\s*[.)]\s*/, "");
                        return "<b>" + String.fromCharCode(65 + j) + ".</b> " + amsAiEsc(clean);
                    });
                    html += "<br>&nbsp;&nbsp;&nbsp;" + opts.join("&nbsp;&nbsp;&nbsp;&nbsp;");
                }
                p.innerHTML = html;
                zone.appendChild(p); // typed-text look: the engine takes it from here
                n++;
                added++;
            });
            window.amsCloseAiModal();
            paginateExam(); // reflow pages with the new questions included
            var pagesNow = document.querySelectorAll("#examFlow .exam-page");
            if (pagesNow.length) pagesNow[pagesNow.length - 1].scrollIntoView({ behavior: "smooth", block: "start" });
            if (window.amsToast) {
                window.amsToast(added + " AI question(s) added \u2713 read through and edit before printing.", "success", 6000);
            }
        })
        .catch(function () {
            st.textContent = "Network error - check your connection and try again.";
            st.className = "ams-ai-status err";
        })
        .finally(function () { go.disabled = false; });
};
