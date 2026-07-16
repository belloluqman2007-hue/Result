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
    newPage.innerHTML = `<div class="exam-body spacing-${currentSpacing}" contenteditable="true" dir="rtl"><p><br></p></div>`;

    pagesContainer.appendChild(newPage);
    preventToolbarFocusLoss();

    newPage.scrollIntoView({ behavior: "smooth", block: "start" });
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
                newPage.innerHTML = `<div class="exam-body spacing-${document.getElementById("spacingSelect").value}" contenteditable="true" dir="rtl">${html}</div>`;
                examPages.appendChild(newPage);
            });

            preventToolbarFocusLoss();
            closeLoadPanel();
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