/* ==========================================================================
   NEW FILE (pack 25): staff timetable builder - exam + class timetables
   with an ADMIN-only publish gate (students see published rows only).
   ========================================================================== */
(function () {
  "use strict";
  var isAdmin = false;
  var kind = "exam"; // active tab

  function esc(v){ return String(v == null ? "" : v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function note(msg, ok) {
    var el = document.getElementById("ttNote");
    el.textContent = msg || "";
    el.style.color = ok === false ? "#C0392B" : "#14532d";
  }
  function curClass() { return document.getElementById("ttClass").value || ""; }

  /* ---------- auth + class list ---------- */
  fetch("/me").then(function (r) { return r.json(); }).then(function (me) {
    if (!me || !me.loggedIn) { window.location.replace("login.html"); return; }
    isAdmin = me.role === "admin";
    fetch("/classes").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
      var sel = document.getElementById("ttClass");
      sel.innerHTML = '<option value="">- pick a class -</option>' +
        (Array.isArray(rows) ? rows : []).map(function (c) { return '<option value="' + esc(c.class_name) + '">' + esc(c.class_name) + "</option>"; }).join("");
      sel.addEventListener("change", loadAll);
    });
  }).catch(function () { window.location.replace("login.html"); });

  /* ---------- tabs ---------- */
  function setTab(k) {
    kind = k;
    document.getElementById("ttTabExam").classList.toggle("on", k === "exam");
    document.getElementById("ttTabClass").classList.toggle("on", k === "class");
    document.getElementById("ttExamPane").style.display = k === "exam" ? "block" : "none";
    document.getElementById("ttClassPane").style.display = k === "class" ? "block" : "none";
    loadAll();
  }
  document.getElementById("ttTabExam").addEventListener("click", function () { setTab("exam"); });
  document.getElementById("ttTabClass").addEventListener("click", function () { setTab("class"); });

  /* ---------- load + render ---------- */
  function loadAll() { loadExam(); loadClass(); }

  function publishBar(rows, pubBtn, unpubBtn, stateEl) {
    var anyRows = rows.length > 0;
    var allPub = anyRows && rows.every(function (r) { return r.published; });
    stateEl.innerHTML = !anyRows ? "" : allPub
      ? '<span class="tt-pub yes">PUBLISHED - students can see it</span>'
      : '<span class="tt-pub no">DRAFT - students CANNOT see it yet</span>';
    pubBtn.style.display = (isAdmin && anyRows && !allPub) ? "inline-block" : "none";
    unpubBtn.style.display = (isAdmin && anyRows && allPub) ? "inline-block" : "none";
  }

  function loadExam() {
    var cls = curClass();
    var box = document.getElementById("ttExList");
    if (!cls) { box.innerHTML = ""; publishBar([], document.getElementById("ttExPublish"), document.getElementById("ttExUnpublish"), document.getElementById("ttExState")); return; }
    fetch("/api/timetable/exam?class_name=" + encodeURIComponent(cls))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];
        box.innerHTML = rows.length
          ? "<table><thead><tr><th>Subject</th><th>Date</th><th>Time</th><th></th></tr></thead><tbody>" +
            rows.map(function (e) {
              return "<tr><td><b>" + esc(e.subject) + "</b></td><td>" + (e.exam_date ? esc(String(e.exam_date).slice(0, 10)) : "-") + "</td>" +
                "<td>" + esc(e.start_time || "") + (e.end_time ? " - " + esc(e.end_time) : "") + "</td>" +
                '<td><button class="tt-del" data-id="' + e.id + '">&#10005;</button></td></tr>';
            }).join("") + "</tbody></table>"
          : '<div style="color:#93a19a; font-size:13px; padding:6px 0;">No exam entries for this class yet.</div>';
        Array.from(box.querySelectorAll(".tt-del")).forEach(function (b) {
          b.addEventListener("click", function () { delRow("exam", b.getAttribute("data-id")); });
        });
        publishBar(rows, document.getElementById("ttExPublish"), document.getElementById("ttExUnpublish"), document.getElementById("ttExState"));
      }).catch(function () {});
  }

  function loadClass() {
    var cls = curClass();
    var box = document.getElementById("ttClList");
    if (!cls) { box.innerHTML = ""; publishBar([], document.getElementById("ttClPublish"), document.getElementById("ttClUnpublish"), document.getElementById("ttClState")); return; }
    fetch("/api/timetable/class?class_name=" + encodeURIComponent(cls))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];
        box.innerHTML = rows.length
          ? "<table><thead><tr><th>Day</th><th>Period</th><th>Subject</th><th>Time</th><th></th></tr></thead><tbody>" +
            rows.map(function (e) {
              return "<tr><td>" + esc(e.day_of_week) + "</td><td>" + esc(e.period_no) + "</td><td><b>" + esc(e.subject) + "</b></td>" +
                "<td>" + esc(e.start_time || "") + (e.end_time ? " - " + esc(e.end_time) : "") + "</td>" +
                '<td><button class="tt-del" data-id="' + e.id + '">&#10005;</button></td></tr>';
            }).join("") + "</tbody></table>"
          : '<div style="color:#93a19a; font-size:13px; padding:6px 0;">No periods yet for this class.</div>';
        Array.from(box.querySelectorAll(".tt-del")).forEach(function (b) {
          b.addEventListener("click", function () { delRow("class", b.getAttribute("data-id")); });
        });
        publishBar(rows, document.getElementById("ttClPublish"), document.getElementById("ttClUnpublish"), document.getElementById("ttClState"));
      }).catch(function () {});
  }

  /* ---------- add / delete / publish ---------- */
  function post(url, data) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
  }

  document.getElementById("ttExAdd").addEventListener("click", function () {
    var data = {
      class_name: curClass(),
      subject: document.getElementById("ttExSubject").value.trim(),
      exam_date: document.getElementById("ttExDate").value || null,
      start_time: document.getElementById("ttExStart").value,
      end_time: document.getElementById("ttExEnd").value
    };
    post("/api/timetable/exam", data).then(function (res) {
      note(res.d.message, res.ok);
      if (res.ok) { document.getElementById("ttExSubject").value = ""; loadExam(); }
    }).catch(function () { note("Network error.", false); });
  });

  document.getElementById("ttClAdd").addEventListener("click", function () {
    var data = {
      class_name: curClass(),
      day_of_week: document.getElementById("ttClDay").value,
      period_no: document.getElementById("ttClPeriod").value,
      subject: document.getElementById("ttClSubject").value.trim(),
      start_time: document.getElementById("ttClStart").value,
      end_time: document.getElementById("ttClEnd").value
    };
    post("/api/timetable/class", data).then(function (res) {
      note(res.d.message, res.ok);
      if (res.ok) { document.getElementById("ttClSubject").value = ""; loadClass(); }
    }).catch(function () { note("Network error.", false); });
  });

  function delRow(k, id) {
    if (!confirm("Remove this row?")) return;
    fetch("/api/timetable/" + k + "/" + id, { method: "DELETE" })
      .then(function (r) { return r.json(); })
      .then(function (d) { note(d.message, true); k === "exam" ? loadExam() : loadClass(); })
      .catch(function () { note("Network error.", false); });
  }

  function publish(k, on) {
    post("/api/timetable/" + k + "/publish", { class_name: curClass(), published: on ? 1 : 0 })
      .then(function (res) { note(res.d.message, res.ok); k === "exam" ? loadExam() : loadClass(); })
      .catch(function () { note("Network error.", false); });
  }
  document.getElementById("ttExPublish").addEventListener("click", function () { publish("exam", true); });
  document.getElementById("ttExUnpublish").addEventListener("click", function () { publish("exam", false); });
  document.getElementById("ttClPublish").addEventListener("click", function () { publish("class", true); });
  document.getElementById("ttClUnpublish").addEventListener("click", function () { publish("class", false); });
})();
