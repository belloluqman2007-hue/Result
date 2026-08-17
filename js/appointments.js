/* ==========================================================================
   js/appointments.js
   Review parent-teacher appointment requests (GET /api/appointments,
   POST /api/appointments/:id/status, DELETE /api/appointments/:id).
   csrf.js already patches window.fetch.
   ========================================================================== */
"use strict";

function apNotify(text, ok) {
    var msg = document.getElementById("apMsg");
    msg.textContent = text;
    msg.className = "mg-msg " + (ok ? "ok" : "err");
    setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

function initAppts() {
    loadAppts();
}

function statusChip(st) {
    if (st === "approved") return '<span class="sc-chip sc-chip-live">approved</span>';
    if (st === "rejected") return '<span class="sc-chip" style="background:#FDF0EF;color:#B3261E;">rejected</span>';
    return '<span class="sc-chip sc-chip-soon">pending</span>';
}

function loadAppts() {
    var tbody = document.querySelector("#apTable tbody");
    var status = document.getElementById("apFilter").value;
    var url = "/api/appointments" + (status ? "?status=" + encodeURIComponent(status) : "");
    fetch(url, { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
            rows = Array.isArray(rows) ? rows : [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#5B6B62;">No appointment requests.</td></tr>';
                return;
            }
            tbody.innerHTML = "";
            rows.forEach(function (a) {
                var tr = document.createElement("tr");
                var t1 = document.createElement("td");
                t1.innerHTML = "<b>" + esc(a.student_name || a.student_id) + "</b>";
                tr.appendChild(t1);
                var t2 = document.createElement("td"); t2.textContent = a.class_name || "-"; tr.appendChild(t2);
                var t3 = document.createElement("td"); t3.textContent = a.parent_name || "-"; tr.appendChild(t3);
                var t4 = document.createElement("td");
                t4.textContent = (a.requested_date ? String(a.requested_date).slice(0,10) : "-") + (a.requested_time ? " " + a.requested_time : "");
                tr.appendChild(t4);
                var t5 = document.createElement("td"); t5.textContent = a.reason || "-"; t5.style.maxWidth = "260px"; tr.appendChild(t5);
                var t6 = document.createElement("td"); t6.innerHTML = statusChip(a.status || "pending"); tr.appendChild(t6);
                var t7 = document.createElement("td"); t7.style.whiteSpace = "nowrap";

                if ((a.status || "pending") === "pending") {
                    var btnOk = document.createElement("button");
                    btnOk.className = "mg-btn-light"; btnOk.type = "button"; btnOk.textContent = "✓ Approve";
                    btnOk.addEventListener("click", function () { setApptStatus(a.id, "approved"); });
                    t7.appendChild(btnOk);
                    var btnNo = document.createElement("button");
                    btnNo.className = "mg-btn-light mg-btn-danger"; btnNo.type = "button"; btnNo.textContent = "✕ Reject";
                    btnNo.style.marginLeft = "6px";
                    btnNo.addEventListener("click", function () {
                        var note = prompt("Rejection note (optional):");
                        if (note === null) return;
                        setApptStatus(a.id, "rejected", note);
                    });
                    t7.appendChild(btnNo);
                } else {
                    var btnDel = document.createElement("button");
                    btnDel.className = "mg-btn-light mg-btn-danger"; btnDel.type = "button"; btnDel.textContent = "🗑";
                    btnDel.addEventListener("click", function () {
                        if (!confirm("Delete this appointment request?")) return;
                        fetch("/api/appointments/" + a.id, { method: "DELETE", credentials: "same-origin" })
                            .then(function (r) { return r.json(); })
                            .then(function (d) { apNotify(d.message || "Deleted.", true); loadAppts(); })
                            .catch(function () { apNotify("Network error.", false); });
                    });
                    t7.appendChild(btnDel);
                }
                tr.appendChild(t7);
                tbody.appendChild(tr);
            });
        })
        .catch(function () {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#B3261E;">Could not load appointments.</td></tr>';
        });
}

function setApptStatus(id, status, note) {
    fetch("/api/appointments/" + id + "/status", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: status, admin_note: note || "" })
    })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) { apNotify(res.d.message || "Updated.", res.ok); loadAppts(); })
        .catch(function () { apNotify("Network error.", false); });
}
