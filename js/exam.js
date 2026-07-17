let currentExamId = null;

const TERM_ARABIC = {
    "1st Term": "الْأُولَى",
    "2nd Term": "الثَّانِيَة",
    "3rd Term": "الثَّالِثَة"
};

function initExam() {
    loadExamClasses();
    preventToolbarFocusLoss();

    document.getElementById("examClass").addEventListener("change", loadExamSubjects);

    // NEW (requests #2 & #6): draw the automatic page headers right away
    // (they show placeholders until the exam details are chosen) and start
    // watching for pages that get too full to fit one printed A4 sheet.
    refreshAllPageHeaders();
    var pagesBox = document.getElementById("examPages");
    if (pagesBox) {
        var overflowTimer = null;
        pagesBox.addEventListener("input", function () {
            clearTimeout(overflowTimer);
            overflowTimer = setTimeout(checkAllPagesOverflow, 400);
        });
    }
    checkAllPagesOverflow();
}

/* ====================================================================
   NEW (sidebar layout - user request): opens/closes the tools sidebar.
   On wide screens the sidebar is pinned and this barely matters; on
   phones it slides the panel in/out over the exam pages.
==================================================================== */
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

// Comfort: on small screens the sidebar closes by itself after the
// wizard moves on, revealing the whole exam page immediately.
function examCloseSidebarOnMobile() {
    if (window.innerWidth <= 1100) toggleExamSidebar(false);
}

/* ====================================================================
   NEW (exam wizard - request #6): two guided steps.
   Step 1 collects the details; Step 2 is the question editor. All the
   original fields/buttons keep working - this only shows/hides the two
   sections and, when moving forward, generates the cover page and the
   automatic page headers.
==================================================================== */
function examGotoStep(step) {
    var step1 = document.getElementById("examStep1");
    var step2 = document.getElementById("examStep2");
    if (!step1 || !step2) return;

    if (step === 2) {
        // Validates the details (generateCoverPage already alerts if any
        // are missing). Only move on when all four are chosen.
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
        generateCoverPage(); // also refreshes every page header + summary
        step1.style.display = "none";
        step2.style.display = "block";
        examCloseSidebarOnMobile(); // NEW (sidebar layout)
        var firstBody = document.querySelector(".body-page");
        if (firstBody) firstBody.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
        step2.style.display = "none";
        step1.style.display = "block";
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

// NEW: one-line summary of the chosen exam, shown at the top of Step 2.
function updateWizardSummary() {
    var el = document.getElementById("examWizardSummary");
    if (!el) return;
    var cls = document.getElementById("examClass").value;
    var subject = document.getElementById("examSubject").value;
    var term = document.getElementById("examTerm").value;
    var session = document.getElementById("examSession").value;
    if (cls && subject && term && session) {
        el.textContent = cls + " \u00B7 " + subject + " \u00B7 " + term + " \u00B7 " + session +
            " \u2014 every page automatically carries the exam header.";
    }
}

/* ====================================================================
   NEW (automatic exam header on EVERY question page - request #6):
   the header is NOT editable (so it can't be damaged while typing) and
   it is NOT part of what saveExam() stores - it is rebuilt from the
   exam details every time, so editing the details updates all pages.
==================================================================== */
function examPageHeaderHTML() {
    var cls = document.getElementById("examClass").value || "\u2026";
    var subject = document.getElementById("examSubject").value || "\u2026";
    var term = document.getElementById("examTerm").value || "\u2026";
    var session = document.getElementById("examSession").value || "\u2026";

    return '<div class="eph-names">' +
        '<span class="eph-name-ar" lang="ar">مَدْرَسَةُ أَمِينِ اللهِ لِلْعُلُومِ الْعَرَبِيَّةِ الْإِسْلَامِيَّةِ</span>' +
        '<span class="eph-name-en">AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES</span>' +
        '</div>' +
        '<div class="eph-line" dir="rtl">' +
        '<span><b>الْفَصْلُ:</b> ' + cls + '</span>' +
        '<span><b>الْمَادَّةُ:</b> ' + subject + '</span>' +
        '<span><b>الْفَتْرَةُ:</b> ' + term + '</span>' +
        '<span><b>الْعَامُ:</b> ' + session + '</span>' +
        '</div>';
}

// Writes the same header into every .exam-page-header block.
function refreshAllPageHeaders() {
    var html = examPageHeaderHTML();
    document.querySelectorAll(".exam-page-header").forEach(function (el) {
        el.innerHTML = html;
    });
    updateWizardSummary();
}

/* ====================================================================
   NEW (layout guard - request #2): a question page holds a fixed amount
   of text. When the writer passes that, the page would have to shrink
   to fit A4 - instead, we warn early on screen so they can continue on
   a fresh page. Screen-only: the chip never prints and never lands in
   the exported PDF.
==================================================================== */
function checkAllPagesOverflow() {
    // 297mm sheet minus the body-page padding (20mm top + 20mm bottom)
    var BODY_BUDGET_MM = 257;
    document.querySelectorAll(".exam-page.body-page").forEach(function (page) {
        var body = page.querySelector(".exam-body");
        if (!body) return;
        // page.offsetWidth corresponds to 210mm (or proportionally less
        // on a phone), so this budget scales correctly on every screen.
        var budgetPx = (BODY_BUDGET_MM / 210) * page.offsetWidth;
        var header = page.querySelector(".exam-page-header");
        if (header) budgetPx -= header.offsetHeight;

        var over = body.scrollHeight > budgetPx + 4;
        page.classList.toggle("page-overfull", over);

        var chip = page.querySelector(".page-warn-chip");
        if (over) {
            if (!chip) {
                chip = document.createElement("div");
                chip.className = "page-warn-chip";
                chip.contentEditable = "false";
                chip.textContent = "\u26A0 This page is getting too full - tap '+ Next Page' to continue neatly on a fresh page.";
                page.appendChild(chip);
            }
        } else if (chip) {
            chip.remove();
        }
    });
}

// Prevent toolbar/harakat button clicks from stealing focus away from the
// editable area, so the text cursor position is preserved when formatting.
function preventToolbarFocusLoss() {
    document.querySelectorAll(".exam-format-toolbar button, .harakat-palette button")
        .forEach(btn => {
            btn.addEventListener("mousedown", e => e.preventDefault());
        });
}

// ===== CLASS / SUBJECT LOADING (self-contained, doesn't touch dashboard selects) =====

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

// ===== COVER PAGE GENERATION =====

function generateCoverPage() {
    const cls = document.getElementById("examClass").value;
    const subject = document.getElementById("examSubject").value;
    const term = document.getElementById("examTerm").value;
    const session = document.getElementById("examSession").value;
    const duration = document.getElementById("examDuration").value.trim();

    if (!cls || !subject || !term || !session) {
        alert("Please select Class, Subject, Term, and Session before generating the cover page.");
        return;
    }

    document.getElementById("coverClass").textContent = cls;
    document.getElementById("coverSubject").textContent = subject;
    document.getElementById("coverDuration").textContent = duration || "-";

    const termArabic = TERM_ARABIC[term] || term;
    document.getElementById("coverExamPeriod").textContent =
        `امْتِحَانُ الْفَتْرَةِ ${termArabic} لِلْعَامِ الدِّرَاسِيِّ ${session}`;

    document.getElementById("coverCode").textContent = `AMSAIS@${session}`;

    // NEW (request #6): keep every question page header in sync with the
    // freshly chosen details, and update the Step-2 summary line.
    refreshAllPageHeaders();
}

// ===== RICH TEXT TOOLBAR =====

function format(command) {
    document.execCommand(command, false, null);
}

function setFontSize() {
    const size = document.getElementById("fontSizeSelect").value;
    document.execCommand("fontSize", false, size);
}

function setSpacing() {
    const spacing = document.getElementById("spacingSelect").value;
    document.querySelectorAll(".exam-body").forEach(body => {
        body.classList.remove("spacing-compact", "spacing-normal", "spacing-relaxed", "spacing-spacious");
        body.classList.add(`spacing-${spacing}`);
    });
}

function toggleDirection() {
    // Applies to whichever body page currently has focus; falls back to the first one.
    const active = document.activeElement;
    const body = active && active.classList && active.classList.contains("exam-body")
        ? active
        : document.querySelector(".exam-body");

    if (!body) return;

    body.dir = body.dir === "rtl" ? "ltr" : "rtl";
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
}

// ===== HARAKAT PALETTE (manual diacritic insertion) =====

function insertHarakat(char) {
    document.execCommand("insertText", false, char);
}

// ===== VOICE NOTE (browser-native speech recognition, no API key needed) =====

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
        voiceBtn.textContent = "\u23F9 Stop Recording";
    };

    recognition.onresult = function (event) {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        if (transcript.trim() !== "") {
            document.execCommand("insertText", false, transcript + " ");
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
        voiceBtn.innerHTML = "&#127908; Voice Note";
    };

    recognition.start();
}

// ===== PAGE MANAGEMENT =====

function insertPageBreak() {
    const pagesContainer = document.getElementById("examPages");
    const currentSpacing = document.getElementById("spacingSelect").value;

    const newPage = document.createElement("div");
    newPage.className = "exam-page body-page";
    // CHANGED (request #6): new pages are born WITH the automatic exam
    // header (filled just below) - one consistent look on every page.
    newPage.innerHTML =
        `<div class="exam-page-header" contenteditable="false"></div>` +
        `<div class="exam-body spacing-${currentSpacing}" contenteditable="true" dir="rtl"><p><br></p></div>`;

    pagesContainer.appendChild(newPage);
    refreshAllPageHeaders(); // fill the new page's header immediately
    preventToolbarFocusLoss();
    checkAllPagesOverflow();
    examCloseSidebarOnMobile(); // NEW (sidebar layout): reveal the new page on phones

    newPage.scrollIntoView({ behavior: "smooth", block: "start" });
    // Put the cursor straight into the new page so typing can continue.
    const newBody = newPage.querySelector(".exam-body");
    if (newBody) newBody.focus();
}

function removeLastPage() {
    const bodyPages = document.querySelectorAll(".body-page");
    if (bodyPages.length <= 1) {
        alert("At least one exam page is required.");
        return;
    }
    bodyPages[bodyPages.length - 1].remove();
}

// ===== SAVE / LOAD =====

function saveExam() {
    const title = document.getElementById("examTitle").value.trim();
    const cls = document.getElementById("examClass").value;
    const subject = document.getElementById("examSubject").value;
    const term = document.getElementById("examTerm").value;
    const session = document.getElementById("examSession").value;
    const duration = document.getElementById("examDuration").value.trim();
    const instructions = document.getElementById("coverInstructions").innerHTML;

    if (!title || !cls || !subject || !term || !session) {
        alert("Please fill in the Exam Title and all the fields in the top bar before saving.");
        return;
    }

    const bodyPages = Array.from(document.querySelectorAll(".body-page .exam-body"))
        .map(el => el.innerHTML);

    const payload = {
        id: currentExamId,
        title,
        class_name: cls,
        subject,
        term,
        session,
        duration,
        instructions,
        body_html: JSON.stringify(bodyPages)
    };

    fetch("/save-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
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
                    <button type="button" onclick="loadExam(${exam.id})">Open</button>
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

function loadExam(id) {
    fetch(`/exam/${id}`)
        .then(response => response.json())
        .then(exam => {
            currentExamId = exam.id;

            document.getElementById("examTitle").value = exam.title;
            document.getElementById("examTerm").value = exam.term;
            document.getElementById("examSession").value = exam.session;
            document.getElementById("examDuration").value = exam.duration || "";

            document.getElementById("examClass").value = exam.class_name;

            // Load subjects for this class, then select the saved subject once loaded
            fetch(`/subjects?class=${encodeURIComponent(exam.class_name)}`)
                .then(response => response.json())
                .then(subjects => {
                    const subjectSelect = document.getElementById("examSubject");
                    subjectSelect.innerHTML = '<option value="" disabled>Select Subject</option>';
                    subjects.forEach(subject => {
                        subjectSelect.innerHTML += `<option value="${subject.subject_name}">${subject.subject_name}</option>`;
                    });
                    subjectSelect.value = exam.subject;
                });

            if (exam.instructions) {
                document.getElementById("coverInstructions").innerHTML = exam.instructions;
            }

            generateCoverPage();

            // Rebuild body pages
            let bodyPagesData;
            try {
                bodyPagesData = JSON.parse(exam.body_html);
            } catch (e) {
                bodyPagesData = [exam.body_html];
            }

            const examPages = document.getElementById("examPages");
            document.querySelectorAll(".body-page").forEach(el => el.remove());

            bodyPagesData.forEach(html => {
                const newPage = document.createElement("div");
                newPage.className = "exam-page body-page";
                // CHANGED (request #6): loaded pages also get the automatic
                // header (rebuilt from the exam details, not stored in the DB).
                newPage.innerHTML =
                    `<div class="exam-page-header" contenteditable="false"></div>` +
                    `<div class="exam-body spacing-${document.getElementById("spacingSelect").value}" contenteditable="true" dir="rtl">${html}</div>`;
                examPages.appendChild(newPage);
            });

            refreshAllPageHeaders();
            preventToolbarFocusLoss();
            checkAllPagesOverflow();
            closeLoadPanel();

            // NEW (wizard): opening a saved exam jumps straight into the editor.
            examGotoStep(2);
        })
        .catch(error => {
            console.log(error);
            alert("Error loading exam.");
        });
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
/* ====================================================================
   NEW (print fix): called by the "Print / Save as PDF" button.
   Identical to window.print() on computers. On phones - where browsers
   silently ignore window.print() - it shows a helpful tip instead of
   leaving the user with a dead button.
   ==================================================================== */
function examPrint() {
    window.print();
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && window.amsToast) {
        window.amsToast(
            "Phone tip: on mobile use the browser menu (\u22EE) \u2192 Share \u2192 Print.",
            "info",
            6500
        );
    }
}

/* ====================================================================
   NEW (PDF download - the fix for printing on phones):
   Phone browsers block window.print(), so this renders EVERY exam page
   into one real PDF (one A4 page per exam page). Works fully on phones:
   the PDF downloads/opens and can be printed or shared from there.
   Pages are captured one after another to keep phone memory low.
   ==================================================================== */
function downloadExamPDF() {
    if (!window.jspdf || !window.html2canvas) {
        if (window.amsToast) window.amsToast("PDF generator is still loading - try again in a moment.", "info");
        return;
    }
    var pages = document.querySelectorAll(".exam-page");
    if (!pages.length) {
        if (window.amsToast) window.amsToast("Generate the exam page first.", "info");
        return;
    }
    if (window.amsToast) window.amsToast("Building PDF\u2026 please wait.", "info", 2500);

    /* CHANGED (consistent one-document PDF - requests #2 & #6):
       BEFORE, every page was fitted individually, so a slightly too-full
       page came out with a different scale than the rest (inconsistent
       pages). Now:
         1) every page is captured first,
         2) ONE global fit factor is computed (the smallest any page needs),
         3) every page is drawn at that SAME scale, top-aligned and
            horizontally centered.
       Result: all pages share identical margins and text size, nothing
       is ever cut off, and page 2 looks exactly like page 1. */
    var pagesBox = document.getElementById("examPages");
    if (pagesBox) pagesBox.classList.add("ams-capturing"); // hides screen-only warning chips

    var canvases = [];
    var i = 0;

    function captureNext() {
        if (i >= pages.length) {
            finishPdf();
            return;
        }
        html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true })
            .then(function (cv) { canvases.push(cv); i++; captureNext(); })
            .catch(function () { i++; captureNext(); }); // skip a bad page, keep the rest
    }

    function finishPdf() {
        if (pagesBox) pagesBox.classList.remove("ams-capturing");

        if (!canvases.length) {
            if (window.amsToast) window.amsToast("Could not build the PDF - please try again.", "error");
            return;
        }

        // One global fit for ALL pages: start at full A4 width (210mm).
        var fits = canvases.map(function (cv) {
            var hMmAtFullWidth = (cv.height * 210) / cv.width;
            return hMmAtFullWidth > 297 ? 297 / hMmAtFullWidth : 1; // <1 means "page too tall"
        });
        var globalFit = Math.min.apply(null, fits.concat([1]));
        var shrunkPages = fits.filter(function (f) { return f < 0.999; }).length;

        var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });

        canvases.forEach(function (cv, idx) {
            var hMmAtFullWidth = (cv.height * 210) / cv.width;
            var finalW = 210 * globalFit;
            var finalH = Math.min(hMmAtFullWidth * globalFit, 297);
            if (idx > 0) pdf.addPage();
            // Top-aligned like a normal document, centered left/right.
            pdf.addImage(cv.toDataURL("image/jpeg", 0.95), "JPEG", (210 - finalW) / 2, 0, finalW, finalH);
        });

        pdf.save("exam.pdf");

        if (window.amsToast) {
            if (shrunkPages > 0) {
                window.amsToast(
                    "PDF downloaded \u2713 Note: " + shrunkPages + " page(s) were very full, so all pages were slightly shrunk to keep one consistent look. Next time use '+ Next Page' a little earlier for the largest print.",
                    "info", 8000
                );
            } else {
                window.amsToast("PDF downloaded \u2713 open it and print/share from your phone", "success", 6000);
            }
        }
    }

    captureNext();
}
