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

            var isPortSingle = (typeof amsCardOrient !== 'undefined' && amsCardOrient === 'portrait');
            var wSingle = isPortSingle ? 53.98 : 85.6;
            var hSingle = isPortSingle ? 85.6 : 53.98;
            var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
            canvases.forEach(function (cv, i) {
                var w = wSingle;                                     // real ID-card width (orientation-aware)
                var h = Math.min((cv.height * w) / cv.width, hSingle); // keep proportion, cap at card height
                var y = 20 + i * (hSingle + 10);                    // front, then back below it
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

/* ====================================================================
   NEW (pack 40 - owner picked "Bulk ID cards"): build every card of a
   WHOLE CLASS into one PDF, at the real card size, several per A4 page.
   The current orientation toggle is respected (landscape 8/page,
   portrait 9/page). Front sides only; photos come from the student
   profiles (photo_path), falling back to the school crest.
   ==================================================================== */
(function () {
    var clsSel = document.getElementById("bulkClass");
    var btn = document.getElementById("bulkPdf");
    var prog = document.getElementById("bulkProg");
    if (!clsSel || !btn) return;

    /* FIX (pack 44 - owner: "the id is just saying loading classes ..."):
       the old loader died SILENTLY whenever /classes did not come back as
       a clean JSON array (session expired -> 401 JSON object, server
       waking up -> 500 text, flaky data, etc.), leaving the box frozen on
       "Loading classes..." forever. Now: non-OK responses throw, the
       payload shape is guarded, and any failure shows a friendly
       "tap to retry" message (plus one quiet auto-retry after 4s). */
    var loadTries = 0;
    function fillClasses(rows) {
        var arr = Array.isArray(rows) ? rows : ((rows && rows.classes) || []);
        var names = arr.map(function (c) {
            return (typeof c === "string") ? c : (c.class_name || c.name || "");
        }).filter(Boolean);
        if (!names.length) {
            clsSel.innerHTML = '<option value="">No classes yet - add classes first</option>';
            return;
        }
        clsSel.innerHTML = '<option value="">Pick a class…</option>';
        names.forEach(function (name) {
            var o = document.createElement("option");
            o.value = name; o.textContent = name;
            clsSel.appendChild(o);
        });
    }
    function loadClasses() {
        loadTries++;
        clsSel.innerHTML = '<option value="">Loading classes...</option>';
        fetch("/classes", { credentials: "same-origin" })
            .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
            .then(fillClasses)
            .catch(function () {
                clsSel.innerHTML = '<option value="">&#9888; Could not load - tap to retry</option>';
                if (loadTries < 2) setTimeout(loadClasses, 4000); // one quiet auto-retry
            });
    }
    // TAP TO RETRY: if the failure message is showing, tapping the select reloads
    ["mousedown", "touchstart", "focus"].forEach(function (ev) {
        clsSel.addEventListener(ev, function () {
            if (clsSel.options.length === 1 && /retry/i.test(clsSel.options[0].textContent)) loadClasses();
        });
    });
    loadClasses();

    function say(t) { prog.style.display = t ? "" : "none"; prog.textContent = t || ""; }

    /* FIX (pack 83): stage now clones BOTH front and back so the class
       PDF shows the back side as well (owner: "back is not showing in class
       download"). The holder keeps both stacked vertically; bulk capture
       photographs front and back separately and places both in the PDF. */
    function stageFor(stu, school, issueText) {
        var isPort = amsCardOrient === "portrait";
        var wrap = document.createElement("div");
        wrap.style.cssText = "position:fixed; left:-13000px; top:0; background:#fff; z-index:-1;";
        var holder = document.createElement("div");
        // FIX (pack 40): ams-pdf-flat pins the cloned card to the exact
        // card height (same flattening the single-card PDF relies on).
        holder.className = "card ams-pdf-flat" + (isPort ? " card--portrait" : "");
        var front = document.querySelector("#card .card-front").cloneNode(true);
        front.querySelector("#schoolName").textContent = school;
        front.querySelector("#studentName").textContent = stu.full_name || "-";
        front.querySelector("#regNo").textContent = stu.student_id || "-";
        front.querySelector("#class").textContent = stu.class_name || "-";
        front.querySelector("#issueDate").textContent = issueText;
        var img = front.querySelector("#photoImg");
        img.src = stu.photo_path || "images/LOGO.JPG";
        img.style.transform = "";
        holder.appendChild(front);
        var back = document.querySelector("#card .card-back").cloneNode(true);
        holder.appendChild(back);
        wrap.appendChild(holder);
        document.body.appendChild(wrap);
        return wrap;
    }

    btn.addEventListener("click", function () {
        var cls = clsSel.value;
        if (!cls) { if (window.amsToast) amsToast("Pick a class first.", "info"); return; }
        if (!window.jspdf || !window.html2canvas) { if (window.amsToast) amsToast("PDF generator is still loading - try again in a moment.", "info"); return; }
        btn.disabled = true;
        say("Loading students…");

        fetch("/students").then(function (r) { return r.json(); }).then(function (rows) {
            var list = (rows || []).filter(function (s) { return s.class_name === cls; })
                .sort(function (a, b) { return String(a.full_name).localeCompare(String(b.full_name)); });
            if (!list.length) { btn.disabled = false; say(""); window.amsToast && amsToast("No students in that class.", "error"); return; }

            var school = (document.getElementById("school").value || "").trim() || "AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES";
            var issueText = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
            var isPort = amsCardOrient === "portrait";
            var cw = isPort ? 53.98 : 85.6, ch = isPort ? 85.6 : 53.98;   // real card mm
            var cols = isPort ? 3 : 2, rows = isPort ? 3 : 4, perPage = cols * rows;
            var gapX = 8, gapY = 8, top = 12;
            var offX = (210 - cols * cw - (cols - 1) * gapX) / 2;
            var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
            var page = pdf.internal.pageSize;
            void page;

            var totalCards = list.length * 2; // front + back per student
            var cardIdx = 0; // counts every physical card side placed
            var i = 0;
            (function next() {
                if (i >= list.length) {
                    var safe = cls.replace(/[\\/:*?"<>|]+/g, "_");
                    pdf.save("ID-Cards-" + safe + ".pdf");
                    btn.disabled = false; say("");
                    window.amsToast && amsToast("Class PDF downloaded ✓ " + list.length + " students (front+back)", "success", 6000);
                    return;
                }
                var stu = list[i];
                say("Building " + (i + 1) + "/" + list.length + " - " + (stu.full_name || "").split(" ")[0] + "…");
                var stage = stageFor(stu, school, issueText);
                // give the photo a beat to load
                setTimeout(function () {
                    var frontEl = stage.querySelector(".card-front");
                    var backEl = stage.querySelector(".card-back");
                    Promise.all([
                        html2canvas(frontEl, { scale: 3, backgroundColor: "#ffffff", useCORS: true }),
                        html2canvas(backEl, { scale: 3, backgroundColor: "#ffffff", useCORS: true })
                    ]).then(function(cvs){
                            document.body.removeChild(stage);
                            cvs.forEach(function(cv){
                                var slot = cardIdx % perPage;
                                if (cardIdx > 0 && slot === 0) pdf.addPage("a4", "portrait");
                                var col = slot % cols, row = Math.floor(slot / cols);
                                var x = offX + col * (cw + gapX);
                                var y = top + row * (ch + gapY);
                                var h = Math.min((cv.height * cw) / cv.width, ch);
                                pdf.addImage(cv.toDataURL("image/png"), "PNG", x, y, cw, h);
                                cardIdx++;
                            });
                            i++; next();
                    }).catch(function () {
                            try{ document.body.removeChild(stage); }catch(e){}
                            i++; next();   // skip a broken student, keep going
                    });
                }, 80);
            })();
        }).catch(function () {
            btn.disabled = false; say("");
            window.amsToast && amsToast("Could not load students - try again.", "error");
        });
    });
})();

/* ====================================================================
   NEW (pack 39 - owner: "likewise the id card also" - two versions):
   portrait / landscape toggle. amsCardOrient drives the preview class
   (.card--portrait on #card) and the PDF placement math above.
   (Re-appended: a mid-session file restore swallowed the first copy.)
   ==================================================================== */
var amsCardOrient = "landscape";
(function () {
    var toggle = document.getElementById("orientToggle");
    if (!toggle) return;
    toggle.addEventListener("click", function (ev) {
        var b = ev.target.closest("button[data-o]");
        if (!b) return;
        amsCardOrient = b.getAttribute("data-o") === "portrait" ? "portrait" : "landscape";
        document.getElementById("card").classList.toggle("card--portrait", amsCardOrient === "portrait");
        toggle.querySelectorAll("button").forEach(function (x) {
            x.classList.toggle("active", x === b);
        });
    });
})();
