/* ==========================================================================
   NEW FILE (pack 14) - js/school-settings.js
   Admin edits the school profile (shown publicly on the website footer)
   and creates academic sessions (with a "current" marker).
   Endpoints: GET/POST /school-settings, GET /sessions, POST /session.
   ========================================================================== */
"use strict";

function setNotify(text, ok) {
  var msg = document.getElementById("setMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function initSettings() {
  // load profile
  fetch("/school-settings")
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (d) {
      d = d || {};
      document.getElementById("setName").value = d.school_name || "AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES";
      document.getElementById("setNameAr").value = d.school_name_ar || "مدرسة أمين اللّه للعلوم العربيّة الإسلاميّة";
      document.getElementById("setMotto").value = d.motto || "KNOWLEDGE AND WORSHIP";
      document.getElementById("setMottoAr").value = d.motto_ar || "العلم والعبادة";
      document.getElementById("setAddress").value = d.address || "3, Temidire street, Off Ondo Road, Ijebu-Ode, Ogun State.";
      document.getElementById("setPhone1").value = d.phone1 || "08062445559";
      document.getElementById("setPhone2").value = d.phone2 || "08058306889";
      document.getElementById("setEmail").value = d.email || "madrasatuameenillah22@gmail.com";
    })
    .catch(function () { /* defaults stay */ });

  loadSessions();
}

function saveSettings() {
  var body = {
    school_name: document.getElementById("setName").value,
    school_name_ar: document.getElementById("setNameAr").value,
    motto: document.getElementById("setMotto").value,
    motto_ar: document.getElementById("setMottoAr").value,
    address: document.getElementById("setAddress").value,
    phone1: document.getElementById("setPhone1").value,
    phone2: document.getElementById("setPhone2").value,
    email: document.getElementById("setEmail").value
  };
  fetch("/school-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      setNotify(res.ok ? "\u2705 " + (res.d.message || "Saved") : (res.d.message || "Could not save."), res.ok);
    })
    .catch(function () { setNotify("Network error - NOT saved.", false); });
}

function loadSessions() {
  var tbody = document.querySelector("#sessTable tbody");
  fetch("/sessions")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#5B6B62;">No sessions created yet. Create your first one above (e.g. 2027/2028).</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      rows.forEach(function (row) {
        var tr = document.createElement("tr");

        var td1 = document.createElement("td");
        var b = document.createElement("b");
        b.textContent = row.session;
        td1.appendChild(b);
        tr.appendChild(td1);

        var td2 = document.createElement("td");
        var isCur = Number(row.is_current) === 1;
        td2.innerHTML = isCur
          ? '<span class="sc-chip sc-chip-live">Current</span>'
          : '<span class="sc-chip sc-chip-soon">Not current</span>';
        tr.appendChild(td2);

        var td3 = document.createElement("td");
        if (!isCur) {
          var btn = document.createElement("button");
          btn.className = "mg-btn-light";
          btn.type = "button";
          btn.textContent = "Set as current";
          btn.addEventListener("click", function () { saveSession(row.session, 1); });
          td3.appendChild(btn);
        }
        tr.appendChild(td3);
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#B3261E;">Could not load sessions.</td></tr>';
    });
}

function addSession() {
  var session = document.getElementById("newSession").value.trim();
  if (!session) { setNotify("Type the session first (e.g. 2027/2028).", false); return; }
  saveSession(session, 0);
}

function saveSession(session, makeCurrent) {
  fetch("/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: session, is_current: makeCurrent })
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) {
        setNotify("\u2705 " + session + (makeCurrent ? " set as current session" : " created"), true);
        document.getElementById("newSession").value = "";
        loadSessions();
      } else {
        setNotify(res.d.message || "Could not save.", false);
      }
    })
    .catch(function () { setNotify("Network error - NOT saved.", false); });
}
