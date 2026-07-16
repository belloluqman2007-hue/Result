// ===== CLASSES =====

function addClass() {
    const className = document.getElementById("newClassName").value.trim();

    if (className === "") {
        alert("Please enter a class name.");
        return;
    }

    fetch("/add-class", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_name: className })
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
        document.getElementById("newClassName").value = "";
        loadAllClasses();
        loadClassesIntoSelects();
    })
    .catch(error => {
        console.log(error);
        alert("Error adding class.");
    });
}

function loadAllClasses() {
    fetch("/classes")
        .then(response => response.json())
        .then(classes => {
            let table = document.getElementById("allClassesTable");

            table.innerHTML = `
                <tr>
                    <th>Class</th>
                    <th>Action</th>
                </tr>
            `;

            classes.forEach(cls => {
                let row = table.insertRow();
                row.insertCell(0).innerHTML = cls.class_name;
                row.insertCell(1).innerHTML =
                    `<button onclick="deleteClass(${cls.id})">Delete</button>`;
            });
        })
        .catch(error => console.log(error));
}

function deleteClass(id) {
    const confirmed = confirm(
        "Delete this class? Subjects and students already linked to it will keep the old class name as plain text, but it will no longer appear in dropdowns."
    );
    if (!confirmed) return;

    fetch(`/delete-class/${id}`, {
        method: "DELETE"
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
        loadAllClasses();
        loadClassesIntoSelects();
    })
    .catch(error => {
        console.log(error);
        alert("Error deleting class.");
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

function toggleCustomSubject() {
    const select = document.getElementById("subjectName");
    const customInput = document.getElementById("customSubjectName");

    if (select.value === "__other__") {
        customInput.style.display = "inline-block";
        customInput.focus();
    } else {
        customInput.style.display = "none";
        customInput.value = "";
    }
}

function addSubject() {
    const select = document.getElementById("subjectName");
    let subjectName = select.value;

    if (subjectName === "__other__") {
        subjectName = document.getElementById("customSubjectName").value.trim();
    }

    const subjectClass = document.getElementById("subjectClass").value;

    if (!subjectName || subjectName === "" || subjectClass === "") {
        alert("Please select (or type) a subject name and select a class.");
        return;
    }

    fetch("/add-subject", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            subject_name: subjectName,
            class_name: subjectClass
        })
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
        document.getElementById("subjectName").value = "";
        document.getElementById("customSubjectName").value = "";
        document.getElementById("customSubjectName").style.display = "none";
        document.getElementById("subjectClass").value = "";
        loadAllSubjects();
    })
    .catch(error => {
        console.log(error);
        alert("Error adding subject.");
    });
}

function loadAllSubjects() {
    fetch("/all-subjects")
        .then(response => response.json())
        .then(subjects => {

            let table = document.getElementById("allSubjectsTable");

            table.innerHTML = `
                <tr>
                    <th>Subject</th>
                    <th>Class</th>
                    <th>Action</th>
                </tr>
            `;

            subjects.forEach(subject => {
                let row = table.insertRow();
                row.insertCell(0).innerHTML = subject.subject_name;
                row.insertCell(1).innerHTML = subject.class_name || "(no class set)";
                row.insertCell(2).innerHTML =
                    `<button onclick="deleteSubject(${subject.id})">Delete</button>`;
            });
        })
        .catch(error => console.log(error));
}

function deleteSubject(id) {
    const confirmed = confirm("Delete this subject? This cannot be undone.");
    if (!confirmed) return;

    fetch(`/delete-subject/${id}`, {
        method: "DELETE"
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
        loadAllSubjects();
    })
    .catch(error => {
        console.log(error);
        alert("Error deleting subject.");
    });
}