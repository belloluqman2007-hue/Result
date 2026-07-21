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

    fetch(`/search-result/${studentId}`)
        .then(response => response.json())
        .then(results => {

            if (results.length === 0) {
                alert("No existing results found for that Student ID.");
                return;
            }

            let table = document.getElementById("scoreTable");

            results.forEach(item => {
                // avoid loading the same row twice if it's already in the table
                if (table.querySelector(`tr[data-id="${item.id}"]`)) {
                    return;
                }

                let row = table.insertRow();
                row.dataset.id = item.id;
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
            });
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
        let row;

        if (isEditing) {
            // find the existing row by its stored id and update it in place
            row = table.querySelector(`tr[data-id="${editingResultId}"]`);
            if (!row) {
                row = table.insertRow();
            }
        } else {
            row = table.insertRow();
            row.dataset.id = data.id;
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


function loadSubjects() {

    const classSelect = document.getElementById("studentClass");
    const selectedClass = classSelect ? classSelect.value : "";

    let subjectSelect = document.getElementById("subject");
    if (!subjectSelect) return;

    if (!selectedClass) {
        subjectSelect.innerHTML =
            '<option value="" disabled selected>Select a class first</option>';
        return;
    }

    const url = `/subjects?class=${encodeURIComponent(selectedClass)}`;

    fetch(url)
        .then(response => response.json())
        .then(subjects => {

            if (subjects.length === 0) {
                subjectSelect.innerHTML =
                    '<option value="" disabled selected>No subjects set up for this class yet</option>';
                return;
            }

            subjectSelect.innerHTML =
                '<option value="" disabled selected>Select Subject</option>';

            subjects.forEach(subject => {

                subjectSelect.innerHTML +=
                    `<option value="${subject.subject_name}">
                        ${subject.subject_name}
                    </option>`;

            });

        })
        .catch(error => console.log(error));

}


document.addEventListener("DOMContentLoaded", function () {

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

    fetch("/promote-class", {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            currentClass: currentClass
        })

    })

    .then(response => response.text())

    .then(message => {

        alert(message);

    })

    .catch(error => {

        console.log(error);

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