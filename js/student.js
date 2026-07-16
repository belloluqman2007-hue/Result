function saveStudent() {

    let studentId = document.getElementById("studentId").value;
    let fullName = document.getElementById("fullName").value;
    let gender = document.getElementById("gender").value;
    let className = document.getElementById("className").value;
    let dateOfBirth = document.getElementById("dateOfBirth").value;
    let photoInput = document.getElementById("photo");

    if (
        studentId === "" ||
        fullName === "" ||
        gender === "" ||
        className === ""
    ) {
        alert("Please fill all required fields.");
        return;
    }

    let formData = new FormData();
    formData.append("student_id", studentId);
    formData.append("full_name", fullName);
    formData.append("gender", gender);
    formData.append("class_name", className);
    formData.append("date_of_birth", dateOfBirth);

    if (photoInput.files.length > 0) {
        formData.append("photo", photoInput.files[0]);
    }

    fetch("/save-student", {
        method: "POST",
        body: formData
    })
    .then(response => response.text())
    .then(message => {
        alert(message);
    })
    .catch(error => {
        console.log(error);
        alert("Error saving student.");
    });

}

function uploadBulkStudents() {
    const fileInput = document.getElementById("bulkFile");
    const resultsBox = document.getElementById("bulkResults");
    const summaryEl = document.getElementById("bulkSummary");
    const errorListEl = document.getElementById("bulkErrorList");

    if (fileInput.files.length === 0) {
        alert("Please choose a filled-in template file first.");
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
    })
    .catch(error => {
        console.log(error);
        alert("Error uploading the file. Please check your connection and try again.");
    });
}