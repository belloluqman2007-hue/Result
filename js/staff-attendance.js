/* ==========================================================================
   NEW FILE (pack 13) - js/staff-attendance.js
   Staff attendance (present/absent per day) + weekly evaluations
   (teaching / punctuality / conduct out of 10 + comment).
   Saving is ADMIN-only on the server - management tools.
   ========================================================================== */
"use strict";

var saState = {}; // username -> present/absent

function stNotify(text, ok) {
  var msg = document.getElementById("stMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function todayStr2() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function mondayStr() {
  var d = new Date();
  var day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function initStaffTools() {
  document.getElementById("saDate").value = todayStr2();
  document.getElementById("evWeek").value = mondayStr();

  // rating dropdowns 1..10 (default 8)
  ["evTeaching", "evPunctuality", "evConduct"].forEach(function (id) {
    var sel = document.getElementById(id);
    for (var i = 1; i <= 10; i++) {
      var opt = document.createElement("option");
      opt.value = i;
      opt.textContent = i;
      if (i === 8) opt.selected = true;
      sel.appendChild(opt);
    }
  });

  fetch("/staff-list")
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      var evSel = document.getElementById("evStaff");
      evSel.innerHTML = "";
      rows.forEach(function (u) {
        var opt = document.createElement("option");
        opt.value = u.username;
        opt.textContent = u.username + " (" + u.role + ")";
        evSel.appendChild(opt);
      });
      renderStaffDay(rows, {});
      loadEvaluations();
    })
    .catch(function () {
      document.querySelector("#saTable tbody").innerHTML =
        '<tr><td colspan="3" style="text-align:center; color:#B3261E;">Could not load staff list.</td></tr>';
    });
}

function renderStaffDay(rows, saved) {
  saState = {};
  var tbody = document.querySelector("#saTable tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#5B6B62;">No staff accounts found.</td></tr>';
    return;
  }
  rows.forEach(function (u) {
    saState[u.username] = saved[u.username] || "present";
    var tr = document.createElement("tr");

    var td1 = document.createElement("td");
    var b = document.createElement("b");
    b.textContent = u.username;
    td1.appendChild(b);
    tr.appendChild(td1);

    var td2 = document.createElement("td");
    td2.textContent = u.role;
    tr.appendChild(td2);

    var td3 = document.createElement("td");
    var seg = document.createElement("div");
    seg.className = "seg";
    [["present", "P"], ["absent", "A"]].forEach(function (pair) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = pair[1];
      btn.title = pair[0];
      updateSaBtn(btn, pair[0], saState[u.username]);
      btn.addEventListener("click", function () {
        saState[u.username] = pair[0];
        seg.querySelectorAll("button").forEach(function (b2) { updateSaBtn(b2, b2.title, saState[u.username]); });
      });
      seg.appendChild(btn);
    });
    td3.appendChild(seg);
    tr.appendChild(td3);
    tbody.appendChild(tr);
  });
}

function updateSaBtn(btn, status, current) {
  btn.className = status === current ? (status === "present" ? "on-p" : "on-a") : "";
}

function loadStaffDay() {
  var date = document.getElementById("saDate").value;
  if (!date) return;
  fetch("/staff-attendance?date=" + encodeURIComponent(date))
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      var saved = {};
      rows.forEach(function (r2) { if (r2.status) saved[r2.username] = r2.status; });
      renderStaffDay(rows.map(function (r2) { return { username: r2.username, role: r2.role }; }), saved);
    })
    .catch(function () { stNotify("Could not load that day.", false); });
}

function saveStaffDay() {
  var date = document.getElementById("saDate").value;
  var records = Object.keys(saState).map(function (u) { return { username: u, status: saState[u] }; });
  if (!date || !records.length) { stNotify("Pick a date first.", false); return; }

  fetch("/staff-attendance/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: date, records: records })
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      stNotify(res.ok ? "\u2705 " + (res.d.message || "Saved") + " - " + date : (res.d.message || "Could not save (admin required)."), res.ok);
    })
    .catch(function () { stNotify("Network error - NOT saved.", false); });
}

function saveEvaluation() {
  var body = {
    username: document.getElementById("evStaff").value,
    week_start: document.getElementById("evWeek").value,
    teaching: document.getElementById("evTeaching").value,
    punctuality: document.getElementById("evPunctuality").value,
    conduct: document.getElementById("evConduct").value,
    comment: document.getElementById("evComment").value.trim()
  };
  if (!body.username || !body.week_start) { stNotify("Pick the staff and week first.", false); return; }

  fetch("/staff-evaluation/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) {
        stNotify("\u2705 Evaluation saved for " + body.username, true);
        document.getElementById("evComment").value = "";
        loadEvaluations();
      } else {
        stNotify(res.d.message || "Could not save (admin required).", false);
      }
    })
    .catch(function () { stNotify("Network error - NOT saved.", false); });
}

function loadEvaluations() {
  var tbody = document.querySelector("#evTable tbody");
  fetch("/staff-evaluations")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#5B6B62;">No evaluations recorded yet.</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      rows.forEach(function (row) {
        var tr = document.createElement("tr");
        var week = row.week_start ? String(row.week_start).slice(0, 10) : "-";
        [week, row.staff_username, row.teaching, row.punctuality, row.conduct, row.comment, row.created_by].forEach(function (v) {
          var td = document.createElement("td");
          td.textContent = (v === null || v === undefined || v === "") ? "-" : v;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#B3261E;">Could not load evaluations.</td></tr>';
    });
}
