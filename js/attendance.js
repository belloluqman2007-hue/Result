/* ==========================================================================
   NEW FILE (pack 13) - js/attendance.js
   Daily student attendance register + date-range report.
   Endpoints used: GET /attendance/class, POST /attendance/save,
   GET /attendance/report (all created in pack 13; existing data untouched).
   ========================================================================== */
"use strict";

var attState = {}; // student_id -> status (present/absent/late)
// NEW (pack 14): last loaded register / report rows for the PDF downloads
var attRegisterRows = [];
var attReportRows = [];

function attNotify(text, ok) {
  var msg = document.getElementById("attMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function todayStr() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function attSwitchTab(name, btn) {
  document.querySelectorAll(".mg-tab").forEach(function (t) { t.classList.remove("active"); });
  document.querySelectorAll(".mg-panel").forEach(function (p) { p.classList.remove("active"); });
  btn.classList.add("active");
  document.getElementById(name === "mark" ? "attPanelMark" : "attPanelReport").classList.add("active");
}

function initAttendance() {
  document.getElementById("attDate").value = todayStr();
  document.getElementById("attRepFrom").value = todayStr().slice(0, 8) + "01";
  document.getElementById("attRepTo").value = todayStr();

  fetch("/classes")
    .then(function (r) { return r.json(); })
    .then(function (classes) {
      var sel = document.getElementById("attClass");
      sel.innerHTML = '<option value="">Select Class</option>';
      (classes || []).forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c.class_name;
        opt.textContent = c.class_name;
        sel.appendChild(opt);
      });
    })
    .catch(function () {
      document.getElementById("attClass").innerHTML = '<option value="">Could not load classes</option>';
    });
}

function loadRegister() {
  var className = document.getElementById("attClass").value;
  var date = document.getElementById("attDate").value;
  if (!className || !date) { attNotify("Pick a class and a date first.", false); return; }

  var tbody = document.querySelector("#attTable tbody");
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#5B6B62;">Loading...</td></tr>';

  fetch("/attendance/class?class_name=" + encodeURIComponent(className) + "&date=" + encodeURIComponent(date))
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      attState = {};
      attRegisterRows = rows; // NEW (pack 14): kept for the PDF
      loadTakenSummary(className, date); // NEW (pack 14): "already taken" warning
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#5B6B62;">No students in this class yet.</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      rows.forEach(function (row, i) {
        attState[row.student_id] = row.status || "present"; // default present
        var tr = document.createElement("tr");

        var tdNum = document.createElement("td");
        tdNum.textContent = i + 1;
        tr.appendChild(tdNum);

        var tdName = document.createElement("td");
        var b = document.createElement("b");
        b.textContent = row.full_name || "-";
        tdName.appendChild(b);
        tr.appendChild(tdName);

        var tdId = document.createElement("td");
        tdId.textContent = row.student_id;
        tr.appendChild(tdId);

        var tdSeg = document.createElement("td");
        var seg = document.createElement("div");
        seg.className = "seg";
        [["present", "P"], ["absent", "A"], ["late", "L"]].forEach(function (pair) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = pair[1];
          btn.title = pair[0];
          updateSegBtn(btn, pair[0], attState[row.student_id]);
          btn.addEventListener("click", function () {
            attState[row.student_id] = pair[0];
            seg.querySelectorAll("button").forEach(function (b2) {
              updateSegBtn(b2, b2.title, attState[row.student_id]);
            });
          });
          seg.appendChild(btn);
        });
        tdSeg.appendChild(seg);
        tr.appendChild(tdSeg);
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#B3261E;">Could not load. Check your internet.</td></tr>';
    });
}

function updateSegBtn(btn, status, current) {
  btn.className = "";
  if (status === current) btn.className = status === "present" ? "on-p" : status === "absent" ? "on-a" : "on-l";
}

function markAllPresent() {
  var tbody = document.querySelector("#attTable tbody");
  if (!Object.keys(attState).length) return;
  Object.keys(attState).forEach(function (sid) { attState[sid] = "present"; });
  tbody.querySelectorAll(".seg").forEach(function (seg) {
    seg.querySelectorAll("button").forEach(function (b2) { updateSegBtn(b2, b2.title, "present"); });
  });
}

function saveRegister() {
  var className = document.getElementById("attClass").value;
  var date = document.getElementById("attDate").value;
  var records = Object.keys(attState).map(function (sid) { return { student_id: sid, status: attState[sid] }; });
  if (!className || !date || !records.length) { attNotify("Load the register first.", false); return; }

  fetch("/attendance/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ class_name: className, date: date, records: records })
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      attNotify(res.ok ? "\u2705 " + (res.d.message || "Attendance saved") + " - " + date : (res.d.message || "Could not save."), res.ok);
      if (res.ok) loadTakenSummary(className, date); // NEW (pack 14): keep the banner accurate after saving
    })
    .catch(function () { attNotify("Network error - NOT saved.", false); });
}

function loadAttReport() {
  var className = document.getElementById("attClass").value;
  var from = document.getElementById("attRepFrom").value;
  var to = document.getElementById("attRepTo").value;
  if (!className || !from || !to) { attNotify("Pick the class (above) and the date range.", false); return; }

  var tbody = document.querySelector("#attRepTable tbody");
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#5B6B62;">Loading...</td></tr>';

  fetch("/attendance/report?class_name=" + encodeURIComponent(className) +
        "&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to))
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      attReportRows = rows; // NEW (pack 14)
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#5B6B62;">No attendance marked in this range.</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      rows.forEach(function (row) {
        var marked = Number(row.marked) || 0;
        var pct = marked ? Math.round((Number(row.present) + 0.5 * Number(row.late)) / marked * 100) : 0;
        var tr = document.createElement("tr");
        [row.full_name, row.student_id, row.present, row.absent, row.late, row.marked, pct + "%"].forEach(function (v) {
          var td = document.createElement("td");
          td.textContent = v == null ? "-" : v;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#B3261E;">Could not load report.</td></tr>';
    });
}


/* ======================== NEW (pack 14) ===============================
   1. "Already taken" warning that shows whenever this class+date was
      marked before (prevents accidental duplicate taking; editing and
      saving again stays fully allowed).
   2. Clean A4 PDF download of the register and of the range report.
   ==================================================================== */
function loadTakenSummary(className, date) {
  var banner = document.getElementById("attTaken");
  var text = document.getElementById("attTakenText");
  fetch("/attendance/summary?class_name=" + encodeURIComponent(className) + "&date=" + encodeURIComponent(date))
    .then(function (r) { return r.ok ? r.json() : { taken: false }; })
    .then(function (sum) {
      if (sum && sum.taken) {
        text.textContent = " " + sum.total + " students marked (Present: " + sum.present +
          ", Absent: " + sum.absent + ", Late: " + sum.late + ")" +
          (sum.marked_by ? " - by " + sum.marked_by : "") + ".";
        banner.classList.add("show");
      } else {
        banner.classList.remove("show");
      }
    })
    .catch(function () { banner.classList.remove("show"); });
}

function downloadRegisterPDF() {
  if (!attRegisterRows.length) { attNotify("Load the register first.", false); return; }
  var className = document.getElementById("attClass").value;
  var date = document.getElementById("attDate").value;
  var counts = { present: 0, absent: 0, late: 0, total: attRegisterRows.length };
  var rows = attRegisterRows.map(function (r, i) {
    var st = attState[r.student_id] || "present";
    counts[st] = (counts[st] || 0) + 1;
    return [i + 1, r.student_id, r.full_name || "-", st.toUpperCase()];
  });
  var d = window.amsAttendanceRegisterPDF({
    className: className, date: date, rows: rows,
    summary: { present: counts.present, absent: counts.absent, late: counts.late, total: counts.total }
  });
  d.save("attendance-" + className.replace(/\s+/g, "_") + "-" + date + ".pdf");
}

function downloadReportPDF() {
  if (!attReportRows.length) { attNotify("Load the report first.", false); return; }
  var className = document.getElementById("attClass").value;
  var from = document.getElementById("attRepFrom").value;
  var to = document.getElementById("attRepTo").value;
  var rows = attReportRows.map(function (r, i) {
    var marked = Number(r.marked) || 0;
    var pct = marked ? Math.round((Number(r.present) + 0.5 * Number(r.late)) / marked * 100) : 0;
    return [i + 1, r.full_name || "-", r.present, r.absent, r.late, r.marked, pct + "%"];
  });
  var d = window.amsAttendanceReportPDF({ className: className, from: from, to: to, rows: rows });
  d.save("attendance-report-" + className.replace(/\s+/g, "_") + ".pdf");
}
