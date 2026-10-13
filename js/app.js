console.log("APP.JS LOADED");
console.log(typeof loadSubjects);

// One-time cleanup: older versions of this app cached score data in the
// browser's localStorage. That's no longer used (all data lives in MySQL now),
// so remove any leftover cached copy to avoid confusion.
localStorage.removeItem("scores");

// Tracks the DB id of the result currently being edited (null = adding new)
let editingResultId = null;

function checkAuth() {
    fetch("/me")
        .then(response => response.json())
        .then(data => {
            const welcome = document.getElementById("welcomeMessage");
            if (!welcome) return;

            if (data.loggedIn) {
                welcome.textContent = `Welcome, ${data.username} (${data.role})`;

                const dangerZone = document.getElementById("adminDangerZone");
                if (dangerZone && data.role === "admin") {
                    dangerZone.style.display = "block";
                }
            } else {
                window.location.href = "login.html";
            }
        })
        .catch(error => console.log(error));
}

function logout() {
    fetch("/logout", { method: "POST" })
        .then(() => {
            window.location.href = "login.html";
        })
        .catch(error => console.log(error));
}

document.addEventListener("DOMContentLoaded", function () {

    let table = document.getElementById("scoreTable");

    if (!table) return;

});

function deleteAllResultsForStudent() {
    const studentId = document.getElementById("loadStudentId").value.trim();

    if (studentId === "") {
        alert("Please enter a Student ID first.");
        return;
    }

    const confirmed = confirm(
        `This will permanently delete ALL results for student ID "${studentId}" from the database. This cannot be undone.\n\nAre you sure you want to continue?`
    );

    if (!confirmed) {
        return;
    }

    const typed = prompt(
        `To confirm, type the Student ID exactly as shown to proceed: ${studentId}`
    );

    if (typed !== studentId) {
        alert("Student ID did not match. Deletion cancelled.");
        return;
    }

    fetch(`/delete-results-by-student/${studentId}`, {
        method: "DELETE"
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);

        // remove any matching rows currently shown in the table
        let table = document.getElementById("scoreTable");
        let rows = table.querySelectorAll("tr");
        rows.forEach(row => {
            if (row.cells.length > 0 && row.cells[0].innerHTML === studentId) {
                row.remove();
            }
        });
    })
    .catch(error => {
        console.log(error);
        alert("Error deleting results.");
    });
}

function wipeAllData() {
    const confirmed = confirm(
        "This will PERMANENTLY delete ALL results and ALL student records from the database. This cannot be undone.\n\nAre you sure you want to continue?"
    );

    if (!confirmed) {
        return;
    }

    const typed = prompt(
        'To confirm, type exactly: DELETE ALL'
    );

    if (typed !== "DELETE ALL") {
        alert("Confirmation text did not match. Wipe cancelled.");
        return;
    }

    fetch("/wipe-all-data", {
        method: "DELETE"
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
        window.location.reload();
    })
    .catch(error => {
        console.log(error);
        alert("Error wiping data.");
    });
}

function loadExistingResults() {
    const studentId = document.getElementById("loadStudentId").value.trim();

    if (studentId === "") {
        alert("Please enter a Student ID to load.");
        return;
    }

    fetch(`/search-result/${encodeURIComponent(studentId)}`)
        .then(response => response.json())
        .then(results => {

            if (!Array.isArray(results) || results.length === 0) {
                alert("No existing results found for that Student ID.");
                return;
            }

            // CHANGED (pack 112): drawn by the shared renderer, which keeps one
            // row per term/session/subject (newest wins) so a score the old
            // /save-result duplicated is not listed twice here either.
            amsDrawResultRows(results);
        })
        .catch(error => {
            console.log(error);
            alert("Error loading results.");
        });
}

function saveScore() {
    let studentId = document.getElementById("studentId").value;
    let studentClass = document.getElementById("studentClass").value;
    let term = document.getElementById("term").value;
    let session = document.getElementById("session").value;    
    let studentName = document.getElementById("studentName").value;
    let subject = document.getElementById("subject").value;
    let firstTest = Number(document.getElementById("firstTest").value);
    let secondTest = Number(document.getElementById("secondTest").value);
    let noteScore = Number(document.getElementById("noteScore").value);
    let attendanceScore = Number(document.getElementById("attendanceScore").value);
    let caScore = Number(document.getElementById("caScore").value);
    let examScore = Number(document.getElementById("examScore").value);
    let totalScore = Number(document.getElementById("totalScore").value);
    let grade = document.getElementById("grade").value;

    if (
        studentId.trim() === "" ||
        studentName.trim() === "" ||
        studentClass === "" ||
        session === "" ||
        term === "" ||
        subject === ""
    ) {
        alert("Please fill in Student ID, Name, Class, Session, Term, and Subject before saving.");
        return;
    }

    if (
        firstTest > 10||
        secondTest > 10||
        noteScore >10||
        attendanceScore > 10||
        examScore > 60
    ) {
        alert("One or more scores exceed the maximum allowed marks.");
        return;
    }

    const payload = {
        student_id: studentId,
        student_name: studentName,
        class_name: studentClass,
        term: term,
        session: session,
        subject: subject,
        first_test: firstTest,
        second_test: secondTest,
        note_score: noteScore,
        attendance_score: attendanceScore,
        ca_score: caScore,
        exam_score: examScore,
        total_score: totalScore,
        grade: grade
    };

    const isEditing = editingResultId !== null;

    const url = isEditing
        ? `/update-result/${editingResultId}`
        : "/save-result";

    const method = isEditing ? "PUT" : "POST";

    fetch(url, {
        method: method,
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);

        let table = document.getElementById("scoreTable");
        let row = null;
        const savedId = data && data.id != null ? data.id : null;

        /* FIX (pack 112): the server upserts now, so `data.id` is ALWAYS the row
           that was written - inserted or updated. The table is looked up by
           that id first, so a save can never leave two rows for the same
           student/term/session/subject on the page (nor in the database). */
        if (savedId != null && table) {
            row = table.querySelector(`tr[data-id="${savedId}"]`);
        }
        if (!row && isEditing && table) {
            row = table.querySelector(`tr[data-id="${editingResultId}"]`);
        }
        if (!row) {
            row = table.insertRow();
            if (savedId != null) row.dataset.id = savedId;
        }

        row.dataset.session = session;
        row.innerHTML = "";
        row.insertCell(0).innerHTML = studentId;
        row.insertCell(1).innerHTML = studentName;
        row.insertCell(2).innerHTML = studentClass;
        row.insertCell(3).innerHTML = term;
        row.insertCell(4).innerHTML = subject;
        row.insertCell(5).innerHTML = firstTest;
        row.insertCell(6).innerHTML = secondTest;
        row.insertCell(7).innerHTML = noteScore;
        row.insertCell(8).innerHTML = attendanceScore;
        row.insertCell(9).innerHTML = caScore;
        row.insertCell(10).innerHTML = examScore;
        row.insertCell(11).innerHTML = totalScore;
        row.insertCell(12).innerHTML = grade;
        row.insertCell(13).innerHTML =
            '<button onclick="editRow(this)">Edit</button>';
        row.insertCell(14).innerHTML =
            '<button onclick="deleteRow(this)">Delete</button>';

        exitEditMode();
        clearScoreForm();
    })
    .catch(error => {
        console.log(error);
        alert(isEditing ? "Error updating score." : "Error saving score.");
    });
}

function clearScoreForm() {
    // The "loaded that saved score" banner belongs to the row that was just
    // saved / cancelled - it goes with the cleared form.
    if (typeof amsHideScoreNote === "function") amsHideScoreNote();
    if (typeof amsResetPrefillCache === "function") amsResetPrefillCache();
    document.getElementById("studentId").value = "";
    document.getElementById("studentName").value = "";
    document.getElementById("studentClass").value = "";
    document.getElementById("term").value = "";
    document.getElementById("session").value = "";
    document.getElementById("subject").value = "";
    document.getElementById("firstTest").value = "";
    document.getElementById("secondTest").value = "";
    document.getElementById("noteScore").value = "";
    document.getElementById("attendanceScore").value = "";
    document.getElementById("caScore").value = "";
    document.getElementById("examScore").value = "";
    document.getElementById("totalScore").value = "";
    document.getElementById("grade").value = "";
}

function exitEditMode() {
    editingResultId = null;
    const saveButton = document.getElementById("saveScoreBtn");
    const cancelButton = document.getElementById("cancelEditBtn");
    if (saveButton) saveButton.textContent = "Save Score";
    if (cancelButton) cancelButton.style.display = "none";
}

function cancelEdit() {
    exitEditMode();
    clearScoreForm();
}

function deleteRow(button) {

    let row = button.parentElement.parentElement;

    let id = row.dataset.id;

    fetch(`/delete-result/${id}`,{
        method: "DELETE"
    })
    .then(response => response.json())
    .then( data => {
        alert(data.message);
        row.remove();
    })
    .catch(error => {
        console.log(error);
    });
}

function editRow(button) {

    let row = button.parentElement.parentElement;

    editingResultId = row.dataset.id;

    document.getElementById("studentId").value = row.cells[0].innerHTML;
    document.getElementById("studentName").value = row.cells[1].innerHTML;
    document.getElementById("studentClass").value = row.cells[2].innerHTML;
    document.getElementById("term").value = row.cells[3].innerHTML;
    document.getElementById("session").value = row.dataset.session || "";
    document.getElementById("subject").value = row.cells[4].innerHTML;

    document.getElementById("firstTest").value = row.cells[5].innerHTML;
    document.getElementById("secondTest").value = row.cells[6].innerHTML;
    document.getElementById("noteScore").value = row.cells[7].innerHTML;
    document.getElementById("attendanceScore").value = row.cells[8].innerHTML;
    document.getElementById("examScore").value = row.cells[10].innerHTML;

    calculateScore();

    const saveButton = document.getElementById("saveScoreBtn");
    const cancelButton = document.getElementById("cancelEditBtn");
    if (saveButton) saveButton.textContent = "Update Score";
    if (cancelButton) cancelButton.style.display = "inline-block";

    document.getElementById("scoreForm").scrollIntoView({ behavior: "smooth" });
}


/* FIX (pack 21 - owner: "student search is not working"): the lookup used
   to fire only when the box LOST focus (onblur) - on phones that moment
   often never comes, so it looked broken. Now it fires WHILE TYPING
   (debounced) and shows a quick-info card: photo, name, admission number,
   class, gender, date of birth, parent info and the current fee balance.
   loadStudent() keeps its old name + behaviour for the onblur hook. */
let amsStudentLookupTimer = null;

function loadStudent() {
    amsLookupStudent(false);
}

function amsLookupStudent(fromTyping) {
    const idEl = document.getElementById("studentId");
    const card = document.getElementById("studentQuickCard");
    const studentId = (idEl.value || "").trim();
    if (!studentId) { if (card) card.style.display = "none"; return; }

    fetch(`/student/${encodeURIComponent(studentId)}`)
    .then(response => response.json())
    .then(data => {
        if (data.length > 0) {
            const st = data[0];
            document.getElementById("studentName").value = st.full_name;
            document.getElementById("studentClass").value = st.class_name;
            loadSubjects();
            if (card) amsFillQuickCard(card, st);
            // FIX (pack 112): typing/blurring a Student ID also brings that
            // student's saved score back onto the form (and the results table)
            // instead of leaving the boxes empty.
            amsSchedulePrefill(80);
        } else {
            if (card) card.style.display = "none";
            if (!fromTyping) alert("Student not found.");
        }
    })
    .catch(error => {
        console.log(error);
    });
}

function amsFillQuickCard(card, st) {
    const esc = v => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const row = (label, value) =>
        `<div class="ams-qc-row"><span>${label}</span><b>${esc(value || "-")}</b></div>`;
    card.innerHTML =
        `<div class="ams-qc-head">
            <img class="ams-qc-photo" alt="" ${st.photo_path ? `src="/${esc(st.photo_path)}"` : "style=\"display:none;\""}>
            <div>
                <div class="ams-qc-name">${esc(st.full_name)}</div>
                <div class="ams-qc-sub">ID: ${esc(st.student_id)} &nbsp;•&nbsp; ${esc(st.gender || "-")}</div>
            </div>
         </div>` +
        row("Class", st.class_name) +
        row("Date of Birth", st.date_of_birth ? String(st.date_of_birth).slice(0, 10) : "-") +
        row("Parent", st.parent_name) +
        row("Parent Phone", st.parent_phone) +
        `<div class="ams-qc-balance" id="amsQcBalance">Fee balance: checking…</div>`;
    card.style.display = "block";
    const img = card.querySelector(".ams-qc-photo");
    if (img) img.onerror = () => { img.style.display = "none"; };

    // Fee balance for the term/session currently picked on the form
    // (admin-only API - teachers just see "—" instead of an error).
    const term = (document.getElementById("term") || {}).value || "";
    const session = (document.getElementById("session") || {}).value || "";
    const balEl = document.getElementById("amsQcBalance");
    if (!balEl) return;
    if (!term || !session) { balEl.textContent = "Fee balance: pick Term + Session above to see it"; return; }
    fetch(`/fee-balance-v2?term=${encodeURIComponent(term)}&session=${encodeURIComponent(session)}&student_id=${encodeURIComponent(st.student_id)}`)
    .then(r => r.ok ? r.json() : [])
    .then(rows => {
        if (!Array.isArray(rows) || !rows.length) { balEl.textContent = "Fee balance: no fees set for this term"; return; }
        const fee = rows.reduce((a, r) => a + Number(r.fee || 0), 0);
        const paid = rows.reduce((a, r) => a + Number(r.paid || 0), 0);
        const bal = rows.reduce((a, r) => a + Number(r.balance || 0), 0);
        balEl.textContent = `${term}, ${session} — Fees: ₦${fee.toLocaleString()} • Paid: ₦${paid.toLocaleString()} • Balance: ₦${bal.toLocaleString()}`;
    })
    .catch(() => { balEl.textContent = "Fee balance: —"; });
}

/* ------------------------------------------------------------------
   FIX (pack 112 - owner: "If student is picking in both batch entry and
   single student score it must automatically display scores that has been
   input before not just empty space and to avoid duplicate").

   What used to happen the moment a teacher picked a student from the
   Quick-Pick list:
     * the score boxes (First Test ... Exam) stayed EMPTY. The old code did
       call loadExistingResults(), but that function reads the SEPARATE
       "Student ID to load their results" box at the bottom of the page -
       which the picker never filled - so it only ever raised "Please enter a
       Student ID to load." The score that was already in the database was
       never put back on the form;
     * so the teacher typed it again, and /save-result (which INSERTED every
       time) stored a SECOND row for the same student/term/session/subject:
       the duplicate.

   Now the picked student's saved rows are loaded ONCE and used for BOTH
   * the results table at the bottom of the page, and
   * the entry form: the saved marks go back into the boxes, and the row is
     opened for editing, so pressing "Save Score" UPDATES that row instead of
     adding another one. The server (/save-result) upserts too, so a
     duplicate can no longer be created even if the form was not pre-filled.
------------------------------------------------------------------ */

/* Mirrors the server's normalizeClassName: case, extra spaces and Arabic
   tashkeel must never hide a score that is already saved. */
function amsScoreKey(v) {
    return String(v == null ? "" : v)
        .trim().toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
        .replace(/\s+/g, " ");
}

/* 45.00 -> 45, 8.5 -> 8.5 (the boxes are plain number inputs). */
function amsScoreText(v) {
    if (v == null || v === "") return "";
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    return String(Math.round(n * 100) / 100);
}

/* ONE row per student + term + session + subject, newest id wins - the exact
   duplicate rule the server applies now. */
function amsDedupeResultRows(rows) {
    const seen = Object.create(null);
    const order = [];
    (rows || []).forEach(function (row) {
        if (!row) return;
        const key = amsScoreKey(row.student_id) + "|" + amsScoreKey(row.term) + "|" +
            amsScoreKey(row.session) + "|" + amsScoreKey(row.subject);
        if (!seen[key]) { seen[key] = row; order.push(key); return; }
        if (Number(row.id) > Number(seen[key].id)) seen[key] = row;
    });
    return order.map(function (k) { return seen[k]; });
}

/* Draws saved rows into the "Student Scores" table. A row already on screen
   (same row id) is left alone, so picking the same student twice - or
   pressing "Load Results" after the pick - never doubles the table. */
function amsDrawResultRows(results) {
    const table = document.getElementById("scoreTable");
    if (!table) return 0;
    let added = 0;
    amsDedupeResultRows(results).forEach(function (item) {
        if (item && item.id != null && table.querySelector(`tr[data-id="${item.id}"]`)) return;

        let row = table.insertRow();
        if (item.id != null) row.dataset.id = item.id;
        row.dataset.session = item.session;
        row.insertCell(0).innerHTML = item.student_id;
        row.insertCell(1).innerHTML = item.student_name;
        row.insertCell(2).innerHTML = item.class_name;
        row.insertCell(3).innerHTML = item.term;
        row.insertCell(4).innerHTML = item.subject;
        row.insertCell(5).innerHTML = item.first_test;
        row.insertCell(6).innerHTML = item.second_test;
        row.insertCell(7).innerHTML = item.note_score;
        row.insertCell(8).innerHTML = item.attendance_score;
        row.insertCell(9).innerHTML = item.ca_score;
        row.insertCell(10).innerHTML = item.exam_score;
        row.insertCell(11).innerHTML = item.total;
        row.insertCell(12).innerHTML = item.grade;
        row.insertCell(13).innerHTML =
            '<button onclick="editRow(this)">Edit</button>';
        row.insertCell(14).innerHTML =
            '<button onclick="deleteRow(this)">Delete</button>';
        added++;
    });
    if (added && typeof amsFilterScoreTable === "function") amsFilterScoreTable();
    return added;
}

/* The little banner above the form that says what was loaded / what will
   happen when Save Score is pressed. */
function amsScoreNoteEl(create) {
    let el = document.getElementById("amsPrefillNote");
    if (!el && create) {
        el = document.createElement("div");
        el.id = "amsPrefillNote";
        el.className = "ams-prefill-note";
        const anchor = document.getElementById("studentId");
        const host = anchor && (anchor.parentNode || anchor.parentElement);
        if (host && host.insertBefore) host.insertBefore(el, anchor.nextSibling);
        else if (anchor && anchor.parentNode) anchor.parentNode.appendChild(el);
    }
    return el;
}

function amsShowScoreNote(kind, html) {
    const el = amsScoreNoteEl(true);
    if (!el) return;
    el.className = "ams-prefill-note ams-prefill-" + kind;
    el.innerHTML = html;
    if (el.style) el.style.display = "block";
}

function amsHideScoreNote() {
    const el = amsScoreNoteEl(false);
    if (!el) return;
    if (el.style) el.style.display = "none";
    el.innerHTML = "";
}

/* Sets a <select> to a saved value, retrying briefly: the option list may
   still be loading (subjects are fetched when the class is picked) or its
   redraw may be waiting for the teacher's picker to close. Gives up as soon
   as the teacher picks something themselves. */
function amsSetSelectValue(el, value, tries) {
    if (!el || value == null || value === "") return false;
    el.value = value;
    if (el.value === value) return true;
    if ((tries || 0) >= 20) return false;                 // ~4s, then quietly stop
    setTimeout(function () {
        if (document.activeElement === el) return;         // picker is open
        if (el.value) return;                              // teacher already chose
        amsSetSelectValue(el, value, (tries || 0) + 1);
    }, 200);
    return false;
}

function amsScoreFormContext() {
    const val = (id) => {
        const el = document.getElementById(id);
        return el ? String(el.value == null ? "" : el.value) : "";
    };
    return {
        sid: val("studentId").trim(),
        cls: val("studentClass").trim(),
        term: val("term").trim(),
        session: val("session").trim(),
        subject: val("subject").trim()
    };
}

let amsPrefillToken = 0;
let amsPrefillTimer = null;
let amsPrefillDone = "";        // "sid|term|session|subject" already applied
let amsShownStudent = "";       // the student the form is currently holding

/* Switching to ANOTHER student must never leave the previous student's marks
   in the boxes (they would be saved onto the new student). They are emptied
   before the newly picked student's saved score is loaded. */
function amsClearScoreBoxes() {
    ["firstTest", "secondTest", "noteScore", "attendanceScore", "examScore",
        "caScore", "totalScore", "grade"].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
}

function amsSchedulePrefill(delay) {
    clearTimeout(amsPrefillTimer);
    amsPrefillTimer = setTimeout(function () { amsPrefillExistingScore(); }, delay == null ? 200 : delay);
}

/* The form was cleared (saved / cancelled): the same student may be picked
   again straight away and must be re-read from the database, not skipped. */
function amsResetPrefillCache() {
    amsPrefillDone = "";
}

function amsPrefillExistingScore() {
    // Only the score-entry form has these; other pages load js/app.js too.
    if (!document.getElementById("firstTest")) return;

    const form = amsScoreFormContext();
    if (!form.sid) return;

    if (amsShownStudent && amsScoreKey(amsShownStudent) !== amsScoreKey(form.sid)) {
        amsClearScoreBoxes();
        exitEditMode();
        amsHideScoreNote();
    }
    amsShownStudent = form.sid;

    const sig = amsScoreKey(form.sid) + "|" + amsScoreKey(form.term) + "|" +
        amsScoreKey(form.session) + "|" + amsScoreKey(form.subject);
    if (sig === amsPrefillDone) return;      // same pick, same answer, no refetch
    amsPrefillDone = sig;                    // set now so a second caller shares this one request

    const token = ++amsPrefillToken;
    fetch(`/search-result/${encodeURIComponent(form.sid)}`)
        .then(response => (response && response.ok === false ? [] : response.json()))
        .catch(() => [])
        .then(rows => {
            if (token !== amsPrefillToken) return;             // a newer pick answered first
            const now = amsScoreFormContext();
            if (now.sid !== form.sid) return;                  // the teacher moved on
            if (!Array.isArray(rows)) { amsPrefillDone = ""; return; }   // let a later attempt retry
            const list = amsDedupeResultRows(rows);
            amsDrawResultRows(list);
            amsApplySavedScore(form, list, (rows || []).length - list.length);
        })
        .catch(error => { amsPrefillDone = ""; console.log(error); });
}

/* Puts the saved score for the current picks back into the form and opens
   that row for editing, so "Save Score" updates it instead of inserting a
   duplicate. */
function amsApplySavedScore(form, rows, mergedCount) {
    const val = (id) => {
        const el = document.getElementById(id);
        return el ? String(el.value == null ? "" : el.value) : "";
    };
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = amsScoreText(v); };
    const boxEmpty = () => ["firstTest", "secondTest", "noteScore", "attendanceScore", "examScore"]
        .every(id => val(id).trim() === "");

    const list = (rows || []).slice().sort(function (a, b) { return Number(b.id || 0) - Number(a.id || 0); });
    const complete = !!(form.term && form.session && form.subject);

    function fits(row) {
        if (form.term && amsScoreKey(row.term) !== amsScoreKey(form.term)) return false;
        if (form.session && amsScoreKey(row.session) !== amsScoreKey(form.session)) return false;
        if (form.subject && amsScoreKey(row.subject) !== amsScoreKey(form.subject)) return false;
        return true;
    }

    // A complete pick (term + session + subject) means the teacher wants THAT
    // score; otherwise the newest row matching what is picked so far is shown.
    const target = list.filter(fits)[0] || null;

    if (!target || target.id == null) {
        // Nothing saved for this student yet -> a plain new entry.
        exitEditMode();
        amsHideScoreNote();
        if (complete) {
            amsShowScoreNote("info",
                "🆕 No score saved yet for <b>" + val("studentClass") + " · " + form.term + " · " + form.session +
                " · " + form.subject + "</b> — the marks you type now will be added as a NEW entry.");
        } else if (!list.length) {
            amsShowScoreNote("info", "🆕 Nothing saved for this student yet — this will be a NEW entry.");
        }
        return;
    }

    // Adopt the picks the saved row carries (only where the form is still blank).
    if (!form.term) amsSetSelectValue(document.getElementById("term"), target.term);
    if (!form.session) amsSetSelectValue(document.getElementById("session"), target.session);
    if (!form.cls && target.class_name) {
        amsSetSelectValue(document.getElementById("studentClass"), target.class_name);
        if (typeof loadSubjects === "function") loadSubjects();
    }
    if (!form.subject) amsSetSelectValue(document.getElementById("subject"), target.subject);

    // The saved marks go back into the boxes. While the pick is incomplete
    // they only fill blank boxes - marks the teacher is typing are never wiped.
    if (complete || boxEmpty()) {
        setVal("firstTest", target.first_test);
        setVal("secondTest", target.second_test);
        setVal("noteScore", target.note_score);
        setVal("attendanceScore", target.attendance_score);
        setVal("examScore", target.exam_score);
        if (typeof calculateScore === "function") calculateScore();
    }

    // Open the saved row for editing - this is what stops the duplicate.
    editingResultId = target.id;
    const saveButton = document.getElementById("saveScoreBtn");
    const cancelButton = document.getElementById("cancelEditBtn");
    if (saveButton) saveButton.textContent = "Update Score";
    if (cancelButton) cancelButton.style.display = "inline-block";

    const where = [target.class_name || form.cls, target.term, target.session, target.subject]
        .filter(Boolean).join(" · ");
    amsShowScoreNote("ok",
        "📄 Loaded the score entered before" + (where ? " for <b>" + where + "</b>" : "") +
        " — the boxes show the saved marks and <b>Save Score updates this row</b>, so no duplicate is created." +
        (mergedCount ? " (" + mergedCount + " older duplicate row" + (mergedCount === 1 ? "" : "s") + " ignored — the newest is shown.)" : ""));
}

// Attach the as-you-type search once the DOM is ready (keeps onblur too).
document.addEventListener("DOMContentLoaded", function () {
    const idEl = document.getElementById("studentId");
    if (!idEl) return;
    idEl.addEventListener("input", function () {
        clearTimeout(amsStudentLookupTimer);
        amsStudentLookupTimer = setTimeout(function () { amsLookupStudent(true); }, 500);
    });
    // Refresh the balance inside the card when term/session change.
    ["term", "session"].forEach(function (selId) {
        const sel = document.getElementById(selId);
        if (sel) sel.addEventListener("change", function () {
            const card = document.getElementById("studentQuickCard");
            if (card && card.style.display !== "none") amsLookupStudent(true);
        });
    });

    // FIX (pack 112): changing ANY of the scores a row is keyed by re-reads the
    // saved score for the new pick. So picking the term / session / subject
    // AFTER the student - the normal way round on the phone - still brings the
    // marks that were entered before onto the form, and the form stays in
    // "update that row" mode instead of risking a duplicate.
    ["studentClass", "term", "session", "subject"].forEach(function (selId) {
        const sel = document.getElementById(selId);
        if (sel) sel.addEventListener("change", function () { amsSchedulePrefill(250); });
    });
});

function calculateScore() {

    let firstTest = Number(document.getElementById("firstTest").value) || 0;
    let secondTest = Number(document.getElementById("secondTest").value) || 0;
    let noteScore = Number(document.getElementById("noteScore").value) || 0;
    let attendanceScore = Number(document.getElementById("attendanceScore").value) || 0;
    let examScore = Number(document.getElementById("examScore").value) || 0;

    // Prevent scores above the maximum
    if (firstTest > 10) firstTest = 10;
    if (secondTest > 10) secondTest = 10;
    if (noteScore > 10) noteScore = 10;
    if (attendanceScore > 10) attendanceScore = 10;
    if (examScore > 60) examScore = 60;

    let caScore = firstTest + secondTest + noteScore + attendanceScore;
    let total = caScore + examScore;

    let grade;

    if (total >= 70) {
        grade = "A";
    } else if (total >= 60) {
        grade = "B";
    } else if (total >= 50) {
        grade = "C";
    } else if (total >= 45) {
        grade = "D";
    } else if (total >= 40) {
        grade = "E";
    } else {
        grade = "F";
    }

    document.getElementById("caScore").value = caScore;
    document.getElementById("totalScore").value = total;
    document.getElementById("grade").value = grade;
}


/* ------------------------------------------------------------------
   FIX (pack 111 - owner: "if I want to select student it will display
   and disappear same time for 3 times before it stay likewise picking
   subjects also").
   A <select> is never rebuilt while the teacher's native picker is open:
   on phones that closes the list under the finger and the choice looks
   like it "disappeared". The redraw waits for blur/change (with a 2s
   safety net) and the signature checks inside the callers mean the
   deferred draw usually turns out to be a no-op.
------------------------------------------------------------------ */
function amsQueueSelectRender(el, render) {
    if (!el || document.activeElement !== el) { render(); return; }
    let done = false;
    function flush() {
        if (done) return;
        done = true;
        el.removeEventListener("blur", flush);
        el.removeEventListener("change", flush);
        render();
    }
    el.addEventListener("blur", flush);
    el.addEventListener("change", flush);
    setTimeout(flush, 2000);
}

// What the subject <select> currently shows (class + option list). Used to
// skip redraws that would only rebuild the identical options.
let amsSubjectDropSignature = null;
// Guards against an older /subjects answer overwriting a newer class pick.
let amsSubjectRequestId = 0;

function loadSubjects() {

    const classSelect = document.getElementById("studentClass");
    const selectedClass = classSelect ? classSelect.value : "";
    if (typeof populateStudentDropdown === "function") {
        populateStudentDropdown(selectedClass);
    }

    let subjectSelect = document.getElementById("subject");
    if (!subjectSelect) return;

    // FIX (pack 26 - owner: "very stressful"): this list is rebuilt on
    // every class change AND on every quick-card refresh, which silently
    // WIPED a subject the teacher had already chosen (the form then
    // refused to save). Remember the current choice and restore it if it
    // still exists in the refreshed list - same pattern
    // loadClassesIntoSelects() already used for classes.
    const previousSubject = subjectSelect.value;

    function restoreSubject() {
        // FIX (pack 26): restore the teacher's earlier choice if it is
        // still in the refreshed list (no wipe on quick-card refresh).
        if (!previousSubject) return;
        const stillThere = Array.from(subjectSelect.options)
            .some(o => o.value === previousSubject);
        if (stillThere) subjectSelect.value = previousSubject;
    }

    function drawSubjects(subjects) {
        // FIX (pack 111): the same list was drawn 3+ times while the page
        // finished loading (onload, quick-card refresh, class fill) and every
        // redraw reset the picker. Identical class + options -> touch nothing.
        const sig = "class:" + selectedClass + "|" + (subjects || []).map(s => s.subject_name).join("|");
        if (sig === amsSubjectDropSignature) {
            restoreSubject();
            return;
        }
        amsQueueSelectRender(subjectSelect, function () {
            if (sig === amsSubjectDropSignature) { restoreSubject(); return; }
            amsSubjectDropSignature = sig;
            if (!subjects.length) {
                subjectSelect.innerHTML =
                    '<option value="" disabled selected>No subjects set up for this class yet</option>';
                return;
            }
            // FIX (pack 111): built as ONE string. The old
            // `innerHTML += ...` re-parsed the whole <select> for every
            // subject, which reset the selection to the first row each time -
            // the "picking subjects also disappears" half of the report.
            subjectSelect.innerHTML =
                '<option value="" disabled selected>Select Subject</option>' +
                subjects.map(subject =>
                    `<option value="${subject.subject_name}">${subject.subject_name}</option>`
                ).join("");
            restoreSubject();
        });
    }

    if (!selectedClass) {
        drawSubjects([]);
        return;
    }

    const url = `/subjects?class=${encodeURIComponent(selectedClass)}`;
    const requestId = ++amsSubjectRequestId;

    fetch(url)
        .then(response => response.json())
        .then(subjects => {
            // A newer class pick already answered - this one is stale.
            if (requestId !== amsSubjectRequestId) return;
            drawSubjects(Array.isArray(subjects) ? subjects : []);
        })
        .catch(error => console.log(error));

}


// NEW (Pack 56/60/80): Quick-pick student dropdown for score entry
// FIX (pack 111 - owner: "if I want to select student it will display and
// disappear same time for 3 times before it stay"): the list used to be asked
// for from four places at once (body onload, onDOMReady, a 50ms timer and the
// DOMContentLoaded handler) and _every_ answer replaced the <select> with
// innerHTML, so a student the teacher had just picked was thrown away again -
// it really did appear and vanish about three times before it stayed. Now the
// request is shared, identical lists are not redrawn, the current choice is
// always carried over and a redraw waits until the picker is closed.
let amsCachedStudentList = null;
let amsCachedStudentListAt = 0;   // freshness stamp for the cached list
let amsStudentListRequest = null; // shared in-flight /students request
let amsStudentDropSignature = null;

function amsEscOption(v) {
    return String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizeArClass(str) {
    return String(str || "")
        .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // remove Tashkeel / diacritics
        .replace(/[إأآٱ]/g, "ا")                     // normalize Alef
        .replace(/\s+/g, "")                         // strip whitespace
        .toLowerCase();
}

function populateStudentDropdown(className, force) {
    const drop = document.getElementById("studentSelectDropdown");
    if (!drop) return;

    const normTarget = normalizeArClass(className);

    function renderList(list) {
        const arr = Array.isArray(list) ? list : [];
        const inClass = normTarget ? arr.filter(s => normalizeArClass(s.class_name) === normTarget) : arr.slice();
        inClass.sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
        const label = normTarget
            ? ('-- Select Student in ' + (className || "").trim() + ' (' + inClass.length + ' found) --')
            : ('-- All Students (' + inClass.length + ' found) - pick class to filter --');

        // The teacher's current pick - never lose it silently.
        const keep = drop.value || "";
        const keepInList = keep && inClass.some(s => String(s.student_id) === keep);
        // The signature describes the OPTIONS only: a selection change inside
        // an unchanged list must never trigger a redraw.
        const sig = normTarget + "|" + label + "|" +
            inClass.map(s => s.student_id).join(",") +
            (keep && !keepInList ? "|extra:" + keep : "");

        // FIX (pack 111): exactly the same options as last time -> leave the
        // DOM (and the selection) alone instead of redrawing it.
        if (sig === amsStudentDropSignature) return;

        amsQueueSelectRender(drop, function () {
            // Something newer may have been drawn while we waited for the
            // picker to close.
            if (sig === amsStudentDropSignature) return;
            let html = '<option value="">' + amsEscOption(label) + '</option>';
            inClass.forEach(s => {
                html += '<option value="' + amsEscOption(s.student_id) + '">' +
                    amsEscOption((s.student_id || "") + " - " + (s.full_name || "") +
                        (normTarget ? "" : " (" + (s.class_name || "-") + ")")) +
                    '</option>';
            });
            // If the picked student is not part of this filtered list, keep a
            // row for them so the choice stays visible in the dropdown.
            if (keep && !keepInList) {
                html += '<option value="' + amsEscOption(keep) + '">' +
                    amsEscOption(keep + " (selected)") + '</option>';
            }
            drop.innerHTML = html;
            if (keep) drop.value = keep;
            if (drop.value !== keep && keep) {
                // Browser refused the value (option missing) - make sure at
                // least the placeholder is selected, never a random student.
                drop.value = "";
            }
            amsStudentDropSignature = sig;
        });
    }

    if (amsCachedStudentList && !force && (Date.now() - amsCachedStudentListAt) < 60000) {
        renderList(amsCachedStudentList);
        return;
    }

    if (!amsStudentListRequest) {
        const pending = fetch("/students")
            .then(r => r.ok ? r.json() : null)
            .then(list => (Array.isArray(list) ? list : null))
            .catch(() => null);
        amsStudentListRequest = pending;
        // Calls made while this request is in flight share it, then it is
        // released so a later call can refresh (and so a failure can retry).
        pending.then(() => { if (amsStudentListRequest === pending) amsStudentListRequest = null; });
    }

    amsStudentListRequest.then(list => {
        if (!list) {
            if (amsStudentDropSignature === null) {
                amsStudentDropSignature = "error";
                drop.innerHTML = '<option value="">Could not load students list - check connection</option>';
            }
            return;
        }
        amsCachedStudentList = list;
        amsCachedStudentListAt = Date.now();
        renderList(list);
    });
}

window.pickStudentFromDropdown = function(sid) {
    if (!sid) return;
    const idEl = document.getElementById("studentId");
    if (idEl) {
        idEl.value = sid;
        if (typeof loadStudent === "function") loadStudent();

        /* FIX (pack 112 - owner: "If student is picking in both batch entry and
           single student score it must automatically display scores that has
           been input before not just empty space and to avoid duplicate").
           The picker now also fills the "load their results" box (that is the
           box loadExistingResults() reads - the old code left it empty, which
           is why the pick only ever raised "Please enter a Student ID"), loads
           every saved row into the results table, and puts the saved marks for
           the current pick back into the form inside that same row's edit
           session. */
        const loadIdEl = document.getElementById("loadStudentId");
        if (loadIdEl) loadIdEl.value = sid;
        amsSchedulePrefill(0);
    }
};

function onDOMReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(fn, 10);
    } else {
        document.addEventListener("DOMContentLoaded", fn);
    }
}

/* FIX (pack 111): the three separate fills that used to sit here are folded
   into one scheduler. populateStudentDropdown() now shares a single /students
   request and skips redrawing an unchanged list, so an extra call is harmless
   (and a page that builds the <select> a moment later is still covered). */
function amsScheduleStudentDropdown() {
    let tries = 0;
    (function attempt() {
        const drop = document.getElementById("studentSelectDropdown");
        if (drop) {
            const cls = document.getElementById("studentClass");
            populateStudentDropdown(cls ? cls.value : "");
            return;
        }
        if (++tries < 12) setTimeout(attempt, 150);
    })();
}

onDOMReady(amsScheduleStudentDropdown);

document.addEventListener("DOMContentLoaded", function () {
    amsScheduleStudentDropdown();

    fetch("/dashboard-summary")
        .then(response => response.json())
        .then(data => {

            if (document.getElementById("studentCount")) {
                document.getElementById("studentCount").textContent = data.students;
            }

            if (document.getElementById("subjectCount")) {
                document.getElementById("subjectCount").textContent = data.subjects;
            }

            if (document.getElementById("resultCount")) {
                document.getElementById("resultCount").textContent = data.results;
            }

        })
        .catch(error => console.log(error));

});


function promoteStudents() {

    let currentClass =
        document.getElementById("currentClass").value;
    let nextClassEl = document.getElementById("targetNextClass");
    let nextClass = nextClassEl ? nextClassEl.value : "";
    let modeEl = document.getElementById("promoteMode");
    let mode = modeEl ? modeEl.value : "merit";

    fetch("/promote-class", {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            currentClass: currentClass,
            nextClass: nextClass,
            mode: mode
        })

    })

    .then(response => response.text())

    .then(message => {

        alert(message);

    })

    .catch(error => {

        console.log(error);
        alert("Error promoting class.");

    });

}

function deleteStudent(button) {
    let row = button.parentElement.parentElement;
    let studentId = row.cells[0].innerHTML;

fetch(`/delete-student/${studentId}`,{
    method:"DELETE"
})
.then(response => response.json())
.then(data => {
    alert(data.message);
    row.remove();
})
.catch(error => console.log(error));
}