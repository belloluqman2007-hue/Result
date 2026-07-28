/* ==========================================================================
   NEW (pack 40 - owner: "let it display all students if i press total
   student and display each class with their subject if i press subject
   and others too"):
   makes the six dashboard stat cards TAPPABLE - each opens a clean modal
   with the live detail behind that number:
     Total Students   -> every student (searchable, with class & gender)
     Subjects         -> every class with its subject list
     Results Recorded -> grade distribution + latest saved results
     Classes          -> each class with its student count
     Staff Accounts   -> staff list (admins only - the API is admin-only)
     Saved Exams      -> every saved exam bank entry
   Purely additive: reads the SAME existing endpoints, one shared modal,
   no server/route/ID changes. Styles live in css/dashboard-beauty.css
   (only this page loads it).
========================================================================== */
"use strict";

(function () {
  var esc = function (v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  var j = function (url) {
    return fetch(url).then(function (r) {
      if (r.status === 403) { var e = new Error("admin"); e.admin = true; throw e; }
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  };

  /* ---------- shared modal shell ---------- */
  var scrim, modal, bodyEl, titleEl;
  function ensureModal() {
    if (scrim) return;
    scrim = document.createElement("div");
    scrim.className = "dd-scrim";
    scrim.style.display = "none";
    scrim.innerHTML =
      '<div class="dd-modal" role="dialog" aria-modal="true">' +
        '<div class="dd-head"><h3 id="ddTitle"></h3>' +
        '<button type="button" class="dd-close" aria-label="Close">&times;</button></div>' +
        '<div class="dd-body" id="ddBody"></div>' +
      "</div>";
    document.body.appendChild(scrim);
    modal = scrim.querySelector(".dd-modal");
    bodyEl = scrim.querySelector("#ddBody");
    titleEl = scrim.querySelector("#ddTitle");
    scrim.addEventListener("click", function (ev) { if (ev.target === scrim) closeModal(); });
    scrim.querySelector(".dd-close").addEventListener("click", closeModal);
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeModal(); });
  }
  function openModal(title) {
    ensureModal();
    titleEl.textContent = title;
    bodyEl.innerHTML = '<div class="dd-loading">Loading… ⏳</div>';
    scrim.style.display = "flex";
  }
  function closeModal() { if (scrim) scrim.style.display = "none"; }
  function failBox(err) {
    bodyEl.innerHTML = err && err.admin
      ? '<div class="dd-empty">🔒 This list is for <b>admin accounts</b> only.</div>'
      : '<div class="dd-empty">Could not load - please try again.</div>';
  }

  /* ---------- search helper ---------- */
  function searchBar(placeholder) {
    return '<input type="text" class="dd-search" placeholder="' + esc(placeholder) + '" oninput="ddSearch(this)">';
  }
  window.ddSearch = function (input) {
    var q = input.value.trim().toLowerCase();
    var rows = bodyEl.querySelectorAll("[data-dd-row]");
    rows.forEach(function (r) {
      r.style.display = !q || r.textContent.toLowerCase().indexOf(q) !== -1 ? "" : "none";
    });
  };

  /* ---------- the six drill-downs ---------- */
  var builders = {

    students: function () {
      openModal("👨‍🎓 All Students");
      Promise.all([j("/students"), j("/dashboard-stats")]).then(function (rs) {
        var students = rs[0] || [], stats = rs[1] || {};
        var chipHtml = (stats.studentsPerClass || []).map(function (c) {
          return '<span class="dd-chip">' + esc(c.class_name || "No class") + " · <b>" + c.count + "</b></span>";
        }).join("");
        var rowsHtml = students.map(function (s) {
          return '<tr data-dd-row><td><b>' + esc(s.full_name) + "</b></td><td>" + esc(s.student_id) +
                 "</td><td>" + esc(s.class_name || "—") + "</td><td>" + esc(s.gender || "—") + "</td></tr>";
        }).join("");
        bodyEl.innerHTML =
          '<div class="dd-chips">' + chipHtml + "</div>" +
          searchBar("Search name, admission no, class…") +
          '<div class="dd-count">' + students.length + " student(s)</div>" +
          '<table class="dd-table"><thead><tr><th>Name</th><th>Adm. No</th><th>Class</th><th>Gender</th></tr></thead>' +
          "<tbody>" + (rowsHtml || '<tr><td colspan="4">No students yet.</td></tr>') + "</tbody></table>";
      }).catch(failBox);
    },

    subjects: function () {
      openModal("📚 Subjects per Class");
      Promise.all([j("/subjects"), j("/classes")]).then(function (rs) {
        var subjects = rs[0] || [], classes = rs[1] || [];
        var byClass = {};
        subjects.forEach(function (s) {
          var c = s.class_name || "General / not assigned";
          (byClass[c] = byClass[c] || []).push(s.subject_name);
        });
        var names = classes.map(function (c) { return c.class_name; });
        Object.keys(byClass).forEach(function (c) { if (names.indexOf(c) === -1) names.push(c); });
        if (!names.length) names = Object.keys(byClass);
        var html = names.map(function (c) {
          var list = (byClass[c] || []).sort();
          return '<div class="dd-group" data-dd-row><div class="dd-group-head">' + esc(c) +
                 ' <span class="dd-chip">' + list.length + ' subject' + (list.length === 1 ? "" : "s") + "</span></div>" +
                 '<div class="dd-tags">' + (list.length
                    ? list.map(function (n) { return '<span class="dd-tag">' + esc(n) + "</span>"; }).join("")
                    : '<span class="dd-empty-sm">No subjects assigned yet.</span>') + "</div></div>";
        }).join("");
        bodyEl.innerHTML = searchBar("Search class or subject…") +
          (html || '<div class="dd-empty">No subjects recorded yet.</div>');
      }).catch(failBox);
    },

    results: function () {
      openModal("📝 Results Recorded");
      j("/dashboard-stats").then(function (d) {
        d = d || {};
        var grades = (d.gradeDistribution || []).slice().sort(function (a, b) { return String(a.grade).localeCompare(String(b.grade)); });
        var max = Math.max.apply(null, grades.map(function (g) { return g.count; }).concat([1]));
        var bars = grades.map(function (g) {
          var w = Math.round((g.count / max) * 100);
          return '<div class="dd-gbar"><span class="dd-glbl">' + esc(g.grade || "—") + "</span>" +
                 '<span class="dd-gtrack"><span class="dd-gfill" style="width:' + w + '%"></span></span><b>' + g.count + "</b></div>";
        }).join("");
        bodyEl.innerHTML =
          '<div class="dd-count">' + (d.results || 0) + " result rows in total</div>" +
          '<div class="dd-sub">Grade distribution</div>' + (bars || '<div class="dd-empty">No grades yet.</div>');
        return j("/recent-activity").then(function (a) {
          var items = (Array.isArray(a) ? a : (a.items || [])).filter(function (x) { return x.type === "result"; });
          if (!items.length) return;
          bodyEl.innerHTML += '<div class="dd-sub">Latest saved results</div><ul class="dd-list">' +
            items.slice(0, 6).map(function (x) { return "<li>" + esc(x.text) + "</li>"; }).join("") + "</ul>";
        }).catch(function () {});
      }).catch(failBox);
    },

    classes: function () {
      openModal("🏫 Classes");
      j("/dashboard-stats").then(function (d) {
        d = d || {};
        var rows = d.studentsPerClass || [];
        var max = Math.max.apply(null, rows.map(function (c) { return c.count; }).concat([1]));
        var html = rows.map(function (c) {
          var w = Math.round((c.count / max) * 100);
          return '<div class="dd-group"><div class="dd-group-head">' + esc(c.class_name || "No class yet") +
                 ' <span class="dd-chip">' + c.count + " pupil" + (c.count === 1 ? "" : "s") + "</span></div>" +
                 '<div class="dd-gtrack"><span class="dd-gfill" style="width:' + w + '%"></span></div></div>';
        }).join("");
        bodyEl.innerHTML = '<div class="dd-count">' + (d.classes || 0) + " classes</div>" +
          (html || '<div class="dd-empty">No classes yet.</div>');
      }).catch(failBox);
    },

    staff: function () {
      openModal("👤 Staff Accounts");
      j("/users").then(function (rows) {
        var html = (rows || []).map(function (u) {
          var role = String(u.role || "teacher");
          return '<tr data-dd-row><td><b>' + esc(u.username) + '</b></td><td><span class="dd-role dd-role-' + esc(role) + '">' +
                 esc(role) + "</span></td></tr>";
        }).join("");
        bodyEl.innerHTML = searchBar("Search staff…") +
          '<table class="dd-table"><thead><tr><th>Username</th><th>Role</th></tr></thead><tbody>' +
          (html || '<tr><td colspan="2">No staff accounts.</td></tr>') + "</tbody></table>";
      }).catch(failBox);
    },

    exams: function () {
      openModal("🗂️ Saved Exams");
      j("/exams").then(function (rows) {
        var html = (rows || []).map(function (e) {
          var when = e.updated_at ? new Date(e.updated_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
          return '<tr data-dd-row><td><b>' + esc(e.title || "Untitled exam") + "</b><br><small>" + esc(e.class_name || "") +
                 (e.subject ? " · " + esc(e.subject) : "") + '</small></td><td>' + esc(e.term || "") + "<br><small>" + esc(e.session || "") +
                 "</small></td><td><small>" + esc(when) + "</small></td></tr>";
        }).join("");
        bodyEl.innerHTML = searchBar("Search title, class, subject…") +
          '<table class="dd-table"><thead><tr><th>Exam</th><th>Term</th><th>Updated</th></tr></thead><tbody>' +
          (html || '<tr><td colspan="3">No saved exams yet.</td></tr>') + "</tbody></table>";
      }).catch(failBox);
    }
  };

  /* ---------- wire the six stat cards ---------- */
  function wire(statValueId, kind) {
    var v = document.getElementById(statValueId);
    if (!v) return;
    var card = v.closest(".ams-stat");
    if (!card) return;
    card.classList.add("dd-clickable");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.title = "Tap to view details";
    var go = function () { builders[kind](); };
    card.addEventListener("click", go);
    card.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
  }

  wire("studentCount", "students");
  wire("subjectCount", "subjects");
  wire("resultCount", "results");
  wire("amsClassCount", "classes");
  wire("amsStaffCount", "staff");
  wire("amsExamCount", "exams");
})();
