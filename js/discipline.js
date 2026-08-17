/* ==========================================================================
   js/discipline.js
   Log warnings / suspensions / commendations per student (GET/POST/DELETE
   /discipline). csrf.js already patches window.fetch. Delete is admin-only
   on the server.
   ========================================================================== */
"use strict";

var dcStudents = [];

function dcNotify(text, ok) {
    var msg = document.getElementById("dcMsg");
    msg.textContent = text;
    msg.className = "mg-msg " + (ok ? "ok" : "err");
    setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function typeChip(type) {
    if (type === "commendation") return '<span class="sc-chip sc-chip-live">commendation</span>';
    if (type === "suspension") return '<span class="sc-chip" style="background:#FDF0EF;color:#B3261E;">suspension</span>';
    return '<span class="sc-chip sc-chip-soon">warning</span>';
}

function initDiscipline() {
    document.getElementById("dcDate").value = todayStr();
    fetch("/students", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
            dcStudents = Array.isArray(rows) ? rows : [];
            fillSelects(dcStudents);
        })
        .catch(function () {});
    loadDiscipline();
}

function fillSelects(list) {
    var sel = document.getElementById("dcStudent");
    var filter = document.getElementById("dcFilter");
    var sorted = list.slice().sort(function (a, b) { return String(a.full_name || "").localeCompare(String(b.full_name || "")); });
    sel.innerHTML = '<option value="">Select Student</option>' + sorted.map(function (s) {
        return '<option value="' + esc(s.student_id) + '">' + esc(s.full_name) + " (" + esc(s.student_id) + ")</option>";
    }).join("");
    filter.innerHTML = '<option value="">All Students</option>' + sorted.map(function (s) {
        return '<option value="' + esc(s.student_id) + '">' + esc(s.full_name) + " (" + esc(s.student_id) + ")</option>";
    }).join("");
}

function saveDiscipline() {
    var body = {
        student_id: document.getElementById("dcStudent").value,
        type: document.getElementById("dcType").value,
        title: document.getElementById("dcTitle").value.trim(),
        description: document.getElementById("dcDesc").value.trim(),
        record_date: document.getElementById("dcDate").value
    };
    if (!body.student_id || !body.description) { dcNotify("Pick the student and write a description.", false); return; }

    fetch("/discipline", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
            if (res.ok) {
                dcNotify("✅ " + (res.d.message || "Record saved."), true);
                document.getElementById("dcTitle").value = "";
                document.getElementById("dcDesc").value = "";
                loadDiscipline();
            } else {
                dcNotify(res.d.message || "Could not save.", false);
            }
        })
        .catch(function () { dcNotify("Network error — NOT saved.", false); });
}

function loadDiscipline() {
    var tbody = document.querySelector("#dcTable tbody");
    var sid = document.getElementById("dcFilter").value;
    var url = "/discipline" + (sid ? "?student_id=" + encodeURIComponent(sid) : "");
    fetch(url, { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
            rows = Array.isArray(rows) ? rows : [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#5B6B62;">No records yet.</td></tr>';
                return;
            }
            tbody.innerHTML = "";
            rows.forEach(function (r) {
                var tr = document.createElement("tr");
                var dtTd = document.createElement("td");
                dtTd.textContent = r.record_date ? String(r.record_date).slice(0, 10) : "-";
                tr.appendChild(dtTd);
                var nmTd = document.createElement("td");
                nmTd.innerHTML = "<b>" + esc(r.full_name || r.student_id) + "</b>" +
                    (r.class_name ? '<br><span style="font-size:11px;color:#93a19a;">' + esc(r.class_name) + "</span>" : "");
                tr.appendChild(nmTd);
                var tyTd = document.createElement("td");
                tyTd.innerHTML = typeChip(r.type);
                tr.appendChild(tyTd);
                var tiTd = document.createElement("td");
                tiTd.textContent = r.title || "-";
                tr.appendChild(tiTd);
                var deTd = document.createElement("td");
                deTd.textContent = r.description || "-";
                deTd.style.maxWidth = "320px";
                tr.appendChild(deTd);
                var byTd = document.createElement("td");
                byTd.textContent = r.recorded_by || "-";
                tr.appendChild(byTd);
                var actTd = document.createElement("td");
                var btnDel = document.createElement("button");
                btnDel.className = "mg-btn-light mg-btn-danger"; btnDel.type = "button"; btnDel.textContent = "🗑";
                btnDel.title = "Delete record (admin only)";
                btnDel.addEventListener("click", function () {
                    if (!confirm("Delete this record for " + (r.full_name || r.student_id) + "?")) return;
                    fetch("/discipline/" + r.id, { method: "DELETE", credentials: "same-origin" })
                        .then(function (rr) { return rr.json(); })
                        .then(function (d) { dcNotify(d.message || "Deleted.", true); loadDiscipline(); })
                        .catch(function () { dcNotify("Network error.", false); });
                });
                actTd.appendChild(btnDel);
                tr.appendChild(actTd);
                tbody.appendChild(tr);
            });
        })
        .catch(function () {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#B3261E;">Could not load records.</td></tr>';
        });
}
