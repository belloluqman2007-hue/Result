/* ==========================================================================
   js/bulk-results.js
   Bulk result import from Excel (POST /bulk-import-results). Class /
   session / term come from the form; Student ID + Subject come from each
   Excel row. csrf.js already patches window.fetch.
   ========================================================================== */
"use strict";

function brNotify(text, ok) {
    var msg = document.getElementById("brMsg");
    msg.textContent = text;
    msg.className = "mg-msg " + (ok ? "ok" : "err");
    setTimeout(function () { msg.className = "mg-msg"; }, 6000);
}

function initBulk() {
    fetch("/classes", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (classes) {
            var sel = document.getElementById("brClass");
            sel.innerHTML = '<option value="">Select Class</option>';
            (Array.isArray(classes) ? classes : []).forEach(function (c) {
                var opt = document.createElement("option");
                opt.value = c.class_name;
                opt.textContent = c.class_name;
                sel.appendChild(opt);
            });
        })
        .catch(function () {
            document.getElementById("brClass").innerHTML = '<option value="">Could not load classes</option>';
        });
}

function importBulk() {
    var fileInput = document.getElementById("brFile");
    var cls = document.getElementById("brClass").value;
    var session = document.getElementById("brSession").value;
    var term = document.getElementById("brTerm").value;

    if (!cls || !session || !term) { brNotify("Pick the class, session and term first.", false); return; }
    if (!fileInput.files || !fileInput.files[0]) { brNotify("Choose the Excel file first.", false); return; }

    var fd = new FormData();
    fd.append("class_name", cls);
    fd.append("session", session);
    fd.append("term", term);
    fd.append("file", fileInput.files[0]);

    var box = document.getElementById("brResult");
    box.innerHTML = '<span style="color:#5B6B62;">Importing...</span>';
    brNotify("Importing results, please wait...", true);

    fetch("/bulk-import-results", { method: "POST", credentials: "same-origin", body: fd })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
            if (!res.ok) {
                brNotify(res.d.message || "Import failed.", false);
                box.innerHTML = "";
                return;
            }
            var d = res.d;
            var html = '<div style="background:#E2F4EA; border:1px solid #A5D6A7; border-radius:8px; padding:10px 14px; color:#157347; font-weight:700;">' +
                (d.message || "Done") + "</div>";
            if (d.errors && d.errors.length) {
                html += '<div style="margin-top:10px; font-size:13px; color:#8a6a08; background:#FBF3D9; border:1px solid #eeda9a; border-radius:8px; padding:10px 14px;">' +
                    "<b>Skipped rows:</b><br>" + d.errors.map(function (e) { return "&bull; " + e; }).join("<br>") + "</div>";
            }
            box.innerHTML = html;
            brNotify("Import finished.", true);
            fileInput.value = "";
        })
        .catch(function () {
            box.innerHTML = "";
            brNotify("Network error — NOT imported.", false);
        });
}

function downloadBulkTemplate() {
    var header = ["Student ID", "Subject", "Class", "First Test", "Second Test", "Note", "Attendance", "CA", "Exam", "Total", "Grade"];
    var sample = ["AM/24/001", "Mathematics", "Primary Two", "8", "9", "10", "9", "", "48", "", ""];
    var csv = "\ufeff" + [header.join(","), sample.join(",")].join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "result-import-template.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 100);
}
