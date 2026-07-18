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

  /* NEW (pack 17 - owner request): the moment a class AND a date are
     picked, the register loads BY ITSELF and, if that date was marked
     before, the saved marks appear with the "date already marked"
     warning - no extra button press needed. */
  function autoLoadRegister() {
    if (document.getElementById("attClass").value && document.getElementById("attDate").value) {
      loadRegister();
    }
    attFillStudentPick(); // NEW (pack 17): keep the history picker in step
  }
  document.getElementById("attClass").addEventListener("change", autoLoadRegister);
  document.getElementById("attDate").addEventListener("change", autoLoadRegister);
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

/* ======================== NEW (pack 17) ===============================
   Student Attendance History: every day attendance was marked for ONE
   student, dates in compact rows + a matching PDF download.
   Route: GET /attendance/student (created in pack 17).
   ==================================================================== */
var attStudentsCache = null; // all students (for the picker)
var attStuRows = [];         // last history rows (for the PDF)
var attStuMeta = null;       // { name, id, className }

function attEnsureStudents(cb) {
  if (attStudentsCache) { cb(attStudentsCache); return; }
  fetch("/students")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      attStudentsCache = Array.isArray(rows) ? rows : [];
      cb(attStudentsCache);
    })
    .catch(function () { cb([]); });
}

function attFillStudentPick() {
  var sel = document.getElementById("attStuPick");
  if (!sel) return;
  var cls = document.getElementById("attClass").value;
  attEnsureStudents(function (list) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">Pick a student</option>';
    list
      .filter(function (s) { return !cls || s.class_name === cls; })
      .forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = s.student_id;
        opt.textContent = (s.full_name || s.student_id) + " (" + s.student_id + ")";
        sel.appendChild(opt);
      });
    if (cur) sel.value = cur;
  });
}

var ATT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function attDayName(dateStr) {
  var d = new Date(String(dateStr).slice(0, 10) + "T12:00:00");
  return isNaN(d) ? "-" : ATT_DAYS[d.getDay()];
}

function loadStudentHistory() {
  var sid = document.getElementById("attStuPick").value;
  if (!sid) { attNotify("Pick the student first.", false); return; }
  var tbody = document.querySelector("#attStuTable tbody");
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#5B6B62;">Loading...</td></tr>';

  fetch("/attendance/student?student_id=" + encodeURIComponent(sid))
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      attStuRows = rows;
      var picked = (attStudentsCache || []).find(function (s) { return s.student_id === sid; }) || {};
      attStuMeta = {
        name: rows[0] && rows[0].full_name ? rows[0].full_name : (picked.full_name || sid),
        id: sid,
        className: (rows[0] && rows[0].class_name) || picked.class_name || document.getElementById("attClass").value || "-"
      };

      var p = 0, a = 0, l = 0;
      rows.forEach(function (r) {
        if (r.status === "present") p++; else if (r.status === "absent") a++; else if (r.status === "late") l++;
      });
      var total = rows.length;
      var pct = total ? Math.round((p + 0.5 * l) / total * 100) : 0;
      document.getElementById("attStuSummary").textContent = total
        ? (attStuMeta.name + "  -  Present: " + p + "   Absent: " + a + "   Late: " + l + "   Days: " + total + "   Present %: " + pct + "%")
        : "";

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#5B6B62;">No attendance has been marked for this student yet.</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      rows.forEach(function (r, i) {
        var tr = document.createElement("tr");
        var dateStr = String(r.att_date).slice(0, 10);
        [String(i + 1), dateStr, attDayName(r.att_date), String(r.status || "-").toUpperCase()].forEach(function (v, ci) {
          var td = document.createElement("td");
          td.textContent = v;
          td.style.textAlign = "center";
          if (ci === 3) {
            td.style.fontWeight = "800";
            td.style.color = r.status === "present" ? "#0E7A46" : r.status === "absent" ? "#B3261E" : "#B26A00";
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#B3261E;">Could not load history. Check your internet.</td></tr>';
    });
}

function downloadStudentHistoryPDF() {
  if (!attStuRows.length || !attStuMeta) { attNotify("Load the student's history first.", false); return; }
  var p = 0, a = 0, l = 0;
  attStuRows.forEach(function (r) {
    if (r.status === "present") p++; else if (r.status === "absent") a++; else if (r.status === "late") l++;
  });
  var total = attStuRows.length;
  var d = window.amsStudentAttendancePDF({
    studentName: attStuMeta.name,
    studentId: attStuMeta.id,
    className: attStuMeta.className,
    summary: { present: p, absent: a, late: l, total: total, pct: total ? Math.round((p + 0.5 * l) / total * 100) : 0 },
    rows: attStuRows.map(function (r, i) {
      return [i + 1, String(r.att_date).slice(0, 10), attDayName(r.att_date), String(r.status || "-").toUpperCase()];
    })
  });
  d.save("attendance-history-" + attStuMeta.id + ".pdf");
}
