function applyToCard() {
    const school = document.getElementById("school").value.trim();
    const name = document.getElementById("name").value.trim();
    const reg = document.getElementById("reg").value.trim();
    const cls = document.getElementById("cls").value.trim();
    const issue = document.getElementById("issue").value;

    document.getElementById("schoolName").textContent = school || "-";
    document.getElementById("studentName").textContent = name || "Student Name";
    document.getElementById("regNo").textContent = reg || "-";
    document.getElementById("class").textContent = cls || "-";

    if (issue) {
        const dateObj = new Date(issue + "T00:00:00");
        document.getElementById("issueDate").textContent = dateObj.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        });
    } else {
        document.getElementById("issueDate").textContent = "-";
    }
}

function applyPhoto() {
    const fileInput = document.getElementById("photo");
    const flipCheckbox = document.getElementById("flipPhoto");
    const photoImg = document.getElementById("photoImg");

    if (fileInput.files.length > 0) {
        const reader = new FileReader();
        reader.onload = function (e) {
            photoImg.src = e.target.result;
            photoImg.style.transform = flipCheckbox.checked ? "scaleX(-1)" : "scaleX(1)";
        };
        reader.readAsDataURL(fileInput.files[0]);
    } else {
        // No new photo chosen - just apply the flip setting to whatever is already there
        photoImg.style.transform = flipCheckbox.checked ? "scaleX(-1)" : "scaleX(1)";
    }
}

document.getElementById("apply").addEventListener("click", function () {
    applyToCard();
    applyPhoto();
});

document.getElementById("flipPhoto").addEventListener("change", function () {
    const photoImg = document.getElementById("photoImg");
    photoImg.style.transform = this.checked ? "scaleX(-1)" : "scaleX(1)";
});

document.getElementById("print").addEventListener("click", function () {
    window.print();
    // NEW (print fix): phone browsers ignore window.print(), so remind
    // mobile users where the real print option lives on their phone.
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && window.amsToast) {
        window.amsToast(
            "Phone tip: the print button can't open print on mobile - use your browser menu (\u22EE) \u2192 Share \u2192 Print instead.",
            "info",
            7000
        );
    }
});

document.getElementById("card").addEventListener("click", function () {
    this.classList.toggle("flipped");
});

// Fill in today's date as a sensible default for Issue Date
document.getElementById("issue").value = new Date().toISOString().split("T")[0];
applyToCard();