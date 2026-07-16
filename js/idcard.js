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
/* ====================================================================
   NEW (PDF download - the fix for printing on phones):
   Phone browsers silently block window.print(), so this button renders
   BOTH sides of the ID card into a real PDF file. On a phone the PDF
   simply downloads / opens - from there it can be printed or shared on
   WhatsApp. On computers the old "Print Card" button keeps working.
   The 3D flip is flattened temporarily (class .ams-pdf-flat) so the
   back side can be captured.
   ==================================================================== */
document.getElementById("downloadPdf").addEventListener("click", function () {
    if (!window.jspdf || !window.html2canvas) {
        if (window.amsToast) window.amsToast("PDF generator is still loading - try again in a moment.", "info");
        return;
    }

    var card = document.getElementById("card");
    var btn = this;
    btn.disabled = true;
    card.classList.add("ams-pdf-flat"); // undo the 3D flip while capturing

    var captureOpts = { scale: 3, backgroundColor: "#ffffff", useCORS: true };
    var front = card.querySelector(".card-front");
    var back = card.querySelector(".card-back");

    Promise.all([html2canvas(front, captureOpts), html2canvas(back, captureOpts)])
        .then(function (canvases) {
            card.classList.remove("ams-pdf-flat");
            btn.disabled = false;

            var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
            canvases.forEach(function (cv, i) {
                var w = 85.6;                                     // real ID-card width
                var h = Math.min((cv.height * w) / cv.width, 53.98); // keep proportion, cap at card height
                var y = 20 + i * (53.98 + 10);                    // front, then back below it
                pdf.addImage(cv.toDataURL("image/png"), "PNG", (210 - w) / 2, y, w, h);
            });

            var reg = (document.getElementById("regNo").textContent || "student").trim().replace(/[^\w-]/g, "_");
            pdf.save("ID-Card-" + reg + ".pdf");
            if (window.amsToast) window.amsToast("PDF downloaded \u2713 open it and print/share from your phone", "success", 6000);
        })
        .catch(function (err) {
            console.warn("PDF error:", err);
            card.classList.remove("ams-pdf-flat");
            btn.disabled = false;
            if (window.amsToast) window.amsToast("Could not create the PDF - please try again.", "error");
        });
});
