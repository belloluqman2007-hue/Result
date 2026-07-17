/* ==========================================================
   ADD STUDENT page logic.
   CHANGED (redesign, request #5): added inline field
   validation, toast feedback, photo preview and a Clear
   button. The core behaviour is UNCHANGED:
     - same function names: saveStudent(), uploadBulkStudents()
     - same requests: POST /save-student, POST /bulk-add-students
     - same FormData field names as before
   NEW: optional parent_name / parent_phone / address are
   appended ONLY when the inputs exist and are filled - the
   server falls back to the original insert when they don't.
========================================================== */

// Small helper: prefer a toast when the shared UI is loaded,
// otherwise fall back to the original alert().
function amsNotify(message, type) {
    if (window.amsToast) {
        window.amsToast(message, type || "info", 4200);
    } else {
        alert(message);
    }
}

// NEW: mark/unmark a field as invalid (shows the inline red note)
function setFieldInvalid(inputId, invalid) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const field = input.closest(".mng-field");
    if (field) field.classList.toggle("mng-invalid", !!invalid);
}

function saveStudent() {

    let studentId = document.getElementById("studentId").value;
    let fullName = document.getElementById("fullName").value;
    let gender = document.getElementById("gender").value;
    let className = document.getElementById("className").value;
    let dateOfBirth = document.getElementById("dateOfBirth").value;
    let photoInput = document.getElementById("photo");

    // CHANGED: per-field validation with inline error notes
    let valid = true;
    setFieldInvalid("studentId", !studentId.trim());
    setFieldInvalid("fullName", !fullName.trim());
    setFieldInvalid("gender", !gender);
    setFieldInvalid("className", !className);

    if (!studentId.trim() || !fullName.trim() || !gender || !className) {
        valid = false;
    }

    if (!valid) {
        amsNotify("Please fill all required fields (marked red).", "error");
        return;
    }

    let formData = new FormData();
    formData.append("student_id", studentId);
    formData.append("full_name", fullName);
    formData.append("gender", gender);
    formData.append("class_name", className);
    formData.append("date_of_birth", dateOfBirth);

    // NEW (request #4/#5): optional parent/guardian fields.
    // Guarded: only sent when the inputs exist on the page.
    const parentNameEl = document.getElementById("parentName");
    const parentPhoneEl = document.getElementById("parentPhone");
    const addressEl = document.getElementById("address");
    if (parentNameEl) formData.append("parent_name", parentNameEl.value.trim());
    if (parentPhoneEl) formData.append("parent_phone", parentPhoneEl.value.trim());
    if (addressEl) formData.append("address", addressEl.value.trim());

    // Photo must come AFTER the text fields: multer names the saved
    // file using the student_id field it already received.
    if (photoInput.files.length > 0) {
        formData.append("photo", photoInput.files[0]);
    }

    fetch("/save-student", {
        method: "POST",
        body: formData
    })
    .then(response => response.text())
    .then(message => {
        // CHANGED: alert() -> toast; form resets after a real success.
        if (message.toLowerCase().includes("success")) {
            amsNotify(message + " \u2713", "success");
            clearStudentForm();
        } else {
            amsNotify(message, "error");
        }
    })
    .catch(error => {
        console.log(error);
        amsNotify("Error saving student.", "error");
    });

}

// NEW (redesign): reset every input and the photo preview.
function clearStudentForm() {
    ["studentId", "fullName", "dateOfBirth", "parentName", "parentPhone", "address"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    const gender = document.getElementById("gender");
    if (gender) gender.value = "";
    const className = document.getElementById("className");
    if (className) className.value = "";
    const photo = document.getElementById("photo");
    if (photo) photo.value = "";
    const preview = document.getElementById("photoPreview");
    if (preview) preview.src = "images/default.png";
    ["studentId", "fullName", "gender", "className"].forEach(id => setFieldInvalid(id, false));
}

// NEW (redesign): live photo preview + clear the red state as the
// user fixes fields. Purely client-side, no behaviour changes.
document.addEventListener("DOMContentLoaded", function () {
    const photo = document.getElementById("photo");
    const preview = document.getElementById("photoPreview");
    if (photo && preview) {
        photo.addEventListener("change", function () {
            if (photo.files && photo.files[0]) {
                preview.src = URL.createObjectURL(photo.files[0]);
            }
        });
    }
    ["studentId", "fullName", "gender", "className"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", () => setFieldInvalid(id, false));
            el.addEventListener("change", () => setFieldInvalid(id, false));
        }
    });
    // Show the chosen Excel file name on its styled label.
    const bulkFile = document.getElementById("bulkFile");
    const bulkLabel = document.getElementById("bulkFileLabel");
    if (bulkFile && bulkLabel) {
        bulkFile.addEventListener("change", function () {
            bulkLabel.textContent = bulkFile.files.length
                ? bulkFile.files[0].name
                : "Choose Filled Template (.xlsx)";
        });
    }
});

function uploadBulkStudents() {
    const fileInput = document.getElementById("bulkFile");
    const resultsBox = document.getElementById("bulkResults");
    const summaryEl = document.getElementById("bulkSummary");
    const errorListEl = document.getElementById("bulkErrorList");

    if (fileInput.files.length === 0) {
        amsNotify("Please choose a filled-in template file first.", "error");
        return;
    }

    let formData = new FormData();
    formData.append("file", fileInput.files[0]);

    fetch("/bulk-add-students", {
        method: "POST",
        body: formData
    })
    .then(response => response.json().then(data => ({ ok: response.ok, data })))
    .then(({ ok, data }) => {
        resultsBox.style.display = "block";

        if (!ok) {
            summaryEl.textContent = data.message || "Something went wrong.";
            summaryEl.style.color = "#8C3B2E";
            errorListEl.innerHTML = "";
            return;
        }

        summaryEl.textContent = data.message;
        summaryEl.style.color = data.errors.length > 0 ? "#8C3B2E" : "#1B5E20";

        errorListEl.innerHTML = "";
        data.errors.forEach(errMsg => {
            const li = document.createElement("li");
            li.textContent = errMsg;
            errorListEl.appendChild(li);
        });

        fileInput.value = "";
        const bulkLabel = document.getElementById("bulkFileLabel");
        if (bulkLabel) bulkLabel.textContent = "Choose Filled Template (.xlsx)";
        amsNotify(data.message, data.errors.length > 0 ? "info" : "success");
    })
    .catch(error => {
        console.log(error);
        amsNotify("Error uploading the file. Please check your connection and try again.", "error");
    });
}
