/* ==========================================================================
   js/lesson-planner.js
   Weekly lesson planning per subject (GET/POST/DELETE /lesson-plans).
   The teacher is auto-set to the logged-in user on save; the admin can
   filter by teacher. csrf.js already patches window.fetch.
   ========================================================================== */
"use strict";

function lpNotify(text, ok) {
    var msg = document.getElementById("lpMsg");
    msg.textContent = text;
    msg.className = "mg-msg " + (ok ? "ok" : "err");
    setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

function currentWeek() {
    var d = new Date();
    var day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function fmtWeek(w) {
    if (!w) return "-";
    var d = new Date(w.slice(0, 10) + "T12:00:00");
    if (isNaN(d)) return w;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function initPlanner() {
    document.getElementById("lpWeek").value = currentWeek();

    fetch("/classes", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (classes) {
            var sel = document.getElementById("lpClass");
            sel.innerHTML = '<option value="">Select Class</option>';
            (Array.isArray(classes) ? classes : []).forEach(function (c) {
                var opt = document.createElement("option");
                opt.value = c.class_name;
                opt.textContent = c.class_name;
                sel.appendChild(opt);
            });
        })
        .catch(function () {});

    // subject suggestions
    fetch("/subjects", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (subs) {
            var dl = document.getElementById("lpSubjectList");
            dl.innerHTML = "";
            var seen = {};
            (Array.isArray(subs) ? subs : []).forEach(function (s) {
                var n = s.subject_name || s.name;
                if (n && !seen[n]) { seen[n] = 1; dl.insertAdjacentHTML("beforeend", '<option value="' + esc(n) + '">'); }
            });
        })
        .catch(function () {});

    loadPlans();
}

function savePlan() {
    var body = {
        subject: document.getElementById("lpSubject").value.trim(),
        class_name: document.getElementById("lpClass").value,
        week_start: document.getElementById("lpWeek").value,
        topic: document.getElementById("lpTopic").value.trim(),
        objectives: document.getElementById("lpObjectives").value.trim(),
        activities: document.getElementById("lpActivities").value.trim(),
        notes: document.getElementById("lpNotes").value.trim()
    };
    if (!body.subject || !body.week_start || !body.topic) {
        lpNotify("Subject, week and topic are required.", false);
        return;
    }
    fetch("/lesson-plans", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
            if (res.ok) {
                lpNotify("✅ " + (res.d.message || "Plan saved."), true);
                document.getElementById("lpTopic").value = "";
                document.getElementById("lpObjectives").value = "";
                document.getElementById("lpActivities").value = "";
                document.getElementById("lpNotes").value = "";
                loadPlans();
            } else {
                lpNotify(res.d.message || "Could not save.", false);
            }
        })
        .catch(function () { lpNotify("Network error — NOT saved.", false); });
}

function loadPlans() {
    var box = document.getElementById("lpList");
    var teacher = document.getElementById("lpTeacherFilter").value;
    var url = "/lesson-plans" + (teacher ? "?teacher=" + encodeURIComponent(teacher) : "");
    fetch(url, { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
            rows = Array.isArray(rows) ? rows : [];

            // remember the teacher filter options (only teachers who have plans)
            var seen = {};
            rows.forEach(function (p) { if (p.teacher && !seen[p.teacher]) seen[p.teacher] = 1; });
            var filter = document.getElementById("lpTeacherFilter");
            var cur = filter.value;
            filter.innerHTML = '<option value="">All Teachers</option>' +
                Object.keys(seen).sort().map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("");
            filter.value = cur;

            if (!rows.length) {
                box.innerHTML = '<span style="color:#93a19a;font-size:13px;">No lesson plans yet.</span>';
                return;
            }
            box.innerHTML = rows.map(function (p) {
                return '<div style="background:#fff; border:1px solid #e1e9e3; border-radius:12px; padding:12px 14px; margin-bottom:10px;">' +
                    '<div style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap;">' +
                        '<div style="flex:1; min-width:200px;">' +
                            '<b style="font-size:14px; color:#14291c;">' + esc(p.topic) + '</b>' +
                            '<div style="font-size:12px; color:#5B6B62; margin-top:2px;">' + esc(p.subject) +
                                (p.class_name ? " &middot; " + esc(p.class_name) : "") + " &middot; Week of " + fmtWeek(p.week_start) + "</div>" +
                        '</div>' +
                        '<div style="font-size:11px; color:#93a19a; text-align:right;">' + esc(p.teacher || "") +
                            '<button class="mg-btn-light mg-btn-danger" type="button" style="margin-left:8px; padding:4px 8px; font-size:12px;" onclick="deletePlan(' + p.id + ')">🗑</button></div>' +
                    '</div>' +
                    (p.objectives ? '<div style="font-size:12.5px; color:#3a5441; margin-top:6px;"><b>Objectives:</b> ' + esc(p.objectives) + "</div>" : "") +
                    (p.activities ? '<div style="font-size:12.5px; color:#3a5441; margin-top:3px;"><b>Activities:</b> ' + esc(p.activities) + "</div>" : "") +
                    (p.notes ? '<div style="font-size:12.5px; color:#3a5441; margin-top:3px;"><b>Notes:</b> ' + esc(p.notes) + "</div>" : "") +
                "</div>";
            }).join("");
        })
        .catch(function () {
            box.innerHTML = '<span style="color:#B3261E;font-size:13px;">Could not load plans.</span>';
        });
}

function deletePlan(id) {
    if (!confirm("Delete this lesson plan?")) return;
    fetch("/lesson-plans/" + id, { method: "DELETE", credentials: "same-origin" })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
            lpNotify(res.d.message || (res.ok ? "Deleted." : "Could not delete."), res.ok);
            if (res.ok) loadPlans();
        })
        .catch(function () { lpNotify("Network error.", false); });
}
