/* ==========================================================
   CLASSES & SUBJECTS page logic.
   CHANGED (redesign + subject editing, requests #3 & #5):
     - class/subject lists render as modern cards (.mng-row)
     - subjects can be EDITED via the new modal -> PUT /update-subject/:id
     - deletes ask for confirmation (amsConfirm when available)
     - live search box filters the subject list
   Everything original is KEPT: same route names, same function
   names (addClass, loadAllClasses, deleteClass, addSubject,
   loadAllSubjects, deleteSubject, toggleCustomSubject,
   loadClassesIntoSelects), same request/response shapes.
========================================================== */

// Small helper: toast when the shared UI is loaded, else alert().
function amsNotify(message, type) {
    if (window.amsToast) {
        window.amsToast(message, type || "info", 4200);
    } else {
        alert(message);
    }
}

// NEW: confirmation that uses the modern dialog when available.
function amsAsk(title, message) {
    if (window.amsConfirm) {
        return window.amsConfirm(title, message, { confirmText: "Yes, delete", cancelText: "Cancel" });
    }
    return Promise.resolve(confirm(title + "\n\n" + message));
}

// Keep the latest fetched lists in memory so the search box and the
// edit modal can re-render instantly without extra requests.
var amsClassesCache = [];
var amsSubjectsCache = [];

// ===== CLASSES =====

function addClass() {
    const className = document.getElementById("newClassName").value.trim();

    if (className === "") {
        amsNotify("Please enter a class name.", "error");
        return;
    }

    fetch("/add-class", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_name: className })
    })
    .then(response => response.json())
    .then(data => {
        amsNotify(data.message, data.message.toLowerCase().includes("success") ? "success" : "error");
        document.getElementById("newClassName").value = "";
        loadAllClasses();
        loadClassesIntoSelects();
    })
    .catch(error => {
        console.log(error);
        amsNotify("Error adding class.", "error");
    });
}

function loadAllClasses() {
    fetch("/classes")
        .then(response => response.json())
        .then(classes => {
            amsClassesCache = classes || [];
            renderClassesList();
            renderAssignClassList(); // NEW (request #3): subject->classes checkboxes
        })
        .catch(error => console.log(error));
}

/* ---------- NEW (request #3): "Assign to classes" tick boxes ---------- */
function renderAssignClassList() {
    const box = document.getElementById("assignClassList");
    if (!box) return;
    box.innerHTML = "";

    if (!amsClassesCache.length) {
        box.innerHTML = '<div class="mng-empty">Add a class first - subjects are assigned to classes.</div>';
        return;
    }

    amsClassesCache.forEach(cls => {
        const label = document.createElement("label");
        label.className = "mng-assign-chip";
        label.innerHTML =
            '<input type="checkbox" value="' + String(cls.class_name).replace(/"/g, "&quot;") + '">' +
            '<span lang="ar" dir="auto"></span>';
        label.querySelector("span").textContent = cls.class_name;
        box.appendChild(label);
    });
}

// CHANGED: card-style rows instead of a bare table. The container
// keeps its original id (allClassesTable) - only the markup inside
// the rows changed.
function renderClassesList() {
    const box = document.getElementById("allClassesTable");
    if (!box) return;

    if (!amsClassesCache.length) {
        box.innerHTML = '<div class="mng-empty">No classes yet - add your first class above.</div>';
    } else {
        box.innerHTML = "";
        amsClassesCache.forEach(cls => {
            const row = document.createElement("div");
            row.className = "mng-row";

            const main = document.createElement("div");
            main.className = "mng-row-main";
            main.textContent = cls.class_name;
            main.setAttribute("lang", "ar"); // class names are Arabic - proper font & direction safety

            const actions = document.createElement("div");
            actions.className = "mng-row-actions";
            actions.innerHTML =
                '<button type="button" class="mng-icon-btn mng-danger" title="Delete class" ' +
                'onclick="deleteClass(' + cls.id + ')">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
                "</svg></button>";

            row.appendChild(main);
            row.appendChild(actions);
            box.appendChild(row);
        });
    }

    const countLine = document.getElementById("classCountLine");
    if (countLine) {
        countLine.textContent = amsClassesCache.length + " class(es) registered.";
    }
}

function deleteClass(id) {
    amsAsk(
        "Delete this class?",
        "Subjects and students already linked to it keep the old class name as plain text, but it will no longer appear in dropdowns."
    ).then(function (confirmed) {
        if (!confirmed) return;

        fetch(`/delete-class/${id}`, { method: "DELETE" })
        .then(response => response.json())
        .then(data => {
            amsNotify(data.message, "success");
            loadAllClasses();
            loadClassesIntoSelects();
        })
        .catch(error => {
            console.log(error);
            amsNotify("Error deleting class.", "error");
        });
    });
}

// Populates every <select> on the page that's meant to hold class options.
// Looks for the specific ids used across the app (studentClass, className,
// subjectClass) so this works on add-student.html, add-subject.html, and
// teacher-dashboard.html alike.
function loadClassesIntoSelects() {
    const targetIds = ["studentClass", "className", "subjectClass"];

    fetch("/classes")
        .then(response => response.json())
        .then(classes => {
            targetIds.forEach(id => {
                const select = document.getElementById(id);
                if (!select) return;

                const previousValue = select.value;

                select.innerHTML = '<option value="" disabled selected>Select Class</option>';

                classes.forEach(cls => {
                    select.innerHTML += `<option value="${cls.class_name}">${cls.class_name}</option>`;
                });

                // restore previous selection if it still exists in the list
                if (previousValue) {
                    select.value = previousValue;
                }
            });
        })
        .catch(error => console.log(error));
}

// ===== SUBJECTS =====

// Kept for backward compatibility with the pre-redesign page: the old
// "Other (type manually)" dropdown no longer exists, so this is now a
// guarded no-op. (Subjects are typed freely from the start - request #3.)
function toggleCustomSubject() {
    return;
}

// CHANGED (request #3): type ANY subject name (nothing hardcoded),
// tick ONE OR MORE classes, and the subject is assigned to all of them.
function addSubject() {
    const nameInput = document.getElementById("subjectName");
    const subjectName = nameInput.value.trim();

    const checked = Array.from(
        document.querySelectorAll("#assignClassList input[type=checkbox]:checked")
    ).map(cb => cb.value);

    if (!subjectName) {
        amsNotify("Please type a subject name.", "error");
        nameInput.focus();
        return;
    }
    if (!checked.length) {
        amsNotify("Please tick at least one class for this subject.", "error");
        return;
    }

    // Skip class assignments that already exist (avoids duplicates).
    const wanted = checked.filter(cls =>
        !amsSubjectsCache.some(s =>
            s.class_name === cls &&
            String(s.subject_name).trim().toLowerCase() === subjectName.toLowerCase()
        )
    );
    const skipped = checked.length - wanted.length;

    if (!wanted.length) {
        amsNotify(`"${subjectName}" is already assigned to the selected class(es).`, "info");
        return;
    }

    // Reuse the existing /add-subject route once per class (additive).
    let done = 0;
    let failed = 0;
    wanted.forEach(cls => {
        fetch("/add-subject", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject_name: subjectName, class_name: cls })
        })
        .then(response => response.json())
        .then(() => { done++; })
        .catch(() => { failed++; })
        .finally(() => {
            if (done + failed === wanted.length) {
                if (failed) {
                    amsNotify(`Saved ${done} of ${wanted.length} assignment(s). Please retry.`, "error");
                } else {
                    amsNotify(
                        skipped > 0
                            ? `"${subjectName}" assigned to ${done} class(es). ${skipped} duplicate(s) skipped.`
                            : `"${subjectName}" assigned to ${done} class(es).`,
                        "success"
                    );
                }
                nameInput.value = "";
                document.querySelectorAll("#assignClassList input[type=checkbox]:checked")
                    .forEach(cb => { cb.checked = false; });
                loadAllSubjects();
            }
        });
    });
}

function loadAllSubjects() {
    fetch("/all-subjects")
        .then(response => response.json())
        .then(subjects => {
            amsSubjectsCache = subjects || [];
            renderSubjectsList();
            fillSubjectSuggestions(); // NEW (request #3): datalist from the DB
        })
        .catch(error => console.log(error));
}

// NEW (request #3): name suggestions come from REAL subjects already
// in the database - not from a hardcoded list.
function fillSubjectSuggestions() {
    const dl = document.getElementById("subjectNameSuggestions");
    if (!dl) return;
    const unique = [];
    amsSubjectsCache.forEach(s => {
        if (s.subject_name && unique.indexOf(s.subject_name) === -1) {
            unique.push(s.subject_name);
        }
    });
    unique.sort((a, b) => String(a).localeCompare(String(b)));
    dl.innerHTML = "";
    unique.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        dl.appendChild(opt);
    });
}

// CHANGED: modern, searchable card rows with Edit + Delete buttons.
// The container keeps its original id (allSubjectsTable).
function renderSubjectsList() {
    const box = document.getElementById("allSubjectsTable");
    if (!box) return;

    const query = (document.getElementById("subjSearchInput") || { value: "" }).value.trim().toLowerCase();
    const list = amsSubjectsCache.filter(s => {
        if (!query) return true;
        return (s.subject_name || "").toLowerCase().includes(query) ||
               (s.class_name || "").toLowerCase().includes(query);
    });

    if (!list.length) {
        box.innerHTML = '<div class="mng-empty">' +
            (query ? "No subjects match your search." : "No subjects yet - add one above.") +
            "</div>";
    } else {
        box.innerHTML = "";
        list.forEach(subject => {
            const row = document.createElement("div");
            // NEW (request #3): disabled subjects are dimmed and get a switch.
            const isActive = subject.is_active === undefined || subject.is_active === null
                ? true
                : Number(subject.is_active) === 1;
            row.className = "mng-row" + (isActive ? "" : " mng-row-off");

            const main = document.createElement("div");
            main.className = "mng-row-main";
            main.textContent = subject.subject_name;
            // Subjects can be Arabic or English - dir="auto" keeps both tidy.
            main.setAttribute("dir", "auto");
            if (!isActive) {
                const offTag = document.createElement("span");
                offTag.className = "mng-off-tag";
                offTag.textContent = "disabled";
                main.appendChild(offTag);
            }

            const chip = document.createElement("span");
            chip.className = "mng-chip";
            chip.textContent = subject.class_name || "(no class)";

            const actions = document.createElement("div");
            actions.className = "mng-row-actions";

            // NEW (request #3): Enable/Disable switch
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "mng-switch" + (isActive ? " mng-switch-on" : "");
            toggle.title = isActive ? "Disable subject (hide from dropdowns)" : "Enable subject";
            toggle.setAttribute("aria-pressed", isActive ? "true" : "false");
            toggle.innerHTML = "<span></span>";
            toggle.addEventListener("click", function () {
                toggleSubjectActive(subject, !isActive);
            });
            actions.appendChild(toggle);

            // NEW (request #3): Edit button -> opens the edit modal.
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "mng-icon-btn";
            editBtn.title = "Edit subject";
            editBtn.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
            editBtn.addEventListener("click", function () { openSubjectEdit(subject); });

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "mng-icon-btn mng-danger";
            delBtn.title = "Delete subject";
            delBtn.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
            delBtn.addEventListener("click", function () { deleteSubject(subject.id); });

            actions.appendChild(editBtn);
            actions.appendChild(delBtn);

            row.appendChild(main);
            row.appendChild(chip);
            row.appendChild(actions);
            box.appendChild(row);
        });
    }

    const countLine = document.getElementById("subjCountLine");
    if (countLine) {
        countLine.textContent = list.length + " subject(s)" + (query ? " match your search." : " in total.");
    }
}

function deleteSubject(id) {
    amsAsk("Delete this subject?", "This cannot be undone.")
        .then(function (confirmed) {
            if (!confirmed) return;

            fetch(`/delete-subject/${id}`, { method: "DELETE" })
            .then(response => response.json())
            .then(data => {
                amsNotify(data.message, "success");
                loadAllSubjects();
            })
            .catch(error => {
                console.log(error);
                amsNotify("Error deleting subject.", "error");
            });
        });
}

/* ---------- NEW (request #3): Enable / Disable a subject ---------- */
function toggleSubjectActive(subject, makeActive) {
    fetch(`/update-subject/${subject.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            subject_name: subject.subject_name,
            class_name: subject.class_name,
            is_active: makeActive ? 1 : 0
        })
    })
    .then(response => response.json())
    .then(data => {
        amsNotify(
            makeActive ? `"${subject.subject_name}" is now visible in dropdowns.` :
                         `"${subject.subject_name}" is hidden from dropdowns (kept in the database).`,
            "success"
        );
        loadAllSubjects();
    })
    .catch(error => {
        console.log(error);
        amsNotify("Error updating subject.", "error");
    });
}

/* ---------- NEW (request #3): Edit Subject modal ---------- */

function openSubjectEdit(subject) {
    document.getElementById("editSubjectId").value = subject.id;
    document.getElementById("editSubjectName").value = subject.subject_name || "";

    // Fill the class dropdown from the live class list, then preselect
    // the subject's current class so the form "auto-loads" existing data.
    const classSelect = document.getElementById("editSubjectClass");
    fetch("/classes")
        .then(r => r.json())
        .then(classes => {
            classSelect.innerHTML = '<option value="" disabled>Select Class</option>';
            (classes || []).forEach(cls => {
                classSelect.innerHTML += `<option value="${cls.class_name}">${cls.class_name}</option>`;
            });
            // If the saved class no longer exists in the dropdown (e.g.
            // its class was deleted), add it as an option so nothing is lost.
            if (subject.class_name && !Array.from(classSelect.options).some(o => o.value === subject.class_name)) {
                classSelect.innerHTML += `<option value="${subject.class_name}">${subject.class_name}</option>`;
            }
            classSelect.value = subject.class_name || "";
        })
        .catch(() => { /* dropdown keeps whatever it had */ });

    document.getElementById("subjectEditOverlay").style.display = "flex";
}

function closeSubjectEdit() {
    document.getElementById("subjectEditOverlay").style.display = "none";
}

function saveSubjectEdit() {
    const id = document.getElementById("editSubjectId").value;
    const name = document.getElementById("editSubjectName").value.trim();
    const cls = document.getElementById("editSubjectClass").value;

    if (!name || !cls) {
        amsNotify("Please enter a subject name and choose a class.", "error");
        return;
    }

    fetch(`/update-subject/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject_name: name, class_name: cls })
    })
    .then(response => response.json())
    .then(data => {
        amsNotify(data.message, data.message.toLowerCase().includes("success") || data.message.toLowerCase().includes("updated") ? "success" : "error");
        closeSubjectEdit();
        loadAllSubjects();
    })
    .catch(error => {
        console.log(error);
        amsNotify("Error updating subject.", "error");
    });
}

// Close the edit modal with Escape (comfort, purely client-side).
document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
        const overlay = document.getElementById("subjectEditOverlay");
        if (overlay && overlay.style.display !== "none") closeSubjectEdit();
    }
});
