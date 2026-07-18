/* ==========================================================================
   NEW FILE (pack 13) - js/portal.js
   Student & Parent portal home:
     - shows the student's own information (from the school register)
     - lists ONLY the terms/sessions an admin has PUBLISHED
     - opens the OFFICIAL report sheet using the EXISTING frozen builder
       (js/report-card.js -> amsFetchReportPack + amsBuildReportCard),
       so the design is identical to the staff/printed version.
   The server enforces everything again (owner-only + publish gate).
   ========================================================================== */
(function () {
  "use strict";

  var student = null;

  function goLogin() { window.location.replace("portal-login.html"); }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value || "-";
  }

  function fmtDob(v) {
    if (!v) return "-";
    var sv = String(v);
    return sv.indexOf("T") >= 0 ? sv.slice(0, 10) : sv;
  }

  /* ------------------------- load profile -------------------------- */
  fetch("/portal/me")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.loggedIn || !data.student) { goLogin(); return; }
      student = data.student;
      setText("ptName", student.full_name);
      setText("ptId", student.student_id);
      setText("ptClass", student.class_name);
      setText("ptGender", student.gender);
      setText("ptDob", fmtDob(student.date_of_birth));
      if (student.photo_path) {
        document.getElementById("ptPhoto").src = student.photo_path;
      }
      loadPublished();
    })
    .catch(goLogin);

  /* --------------------- published terms list ---------------------- */
  function loadPublished() {
    var box = document.getElementById("ptTerms");
    fetch("/portal/published-terms")
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (!rows.length) {
          box.innerHTML =
            '<div class="pt-empty"><span class="big">&#128197;</span>' +
            "No published results yet.<br>The school will publish results here when they are ready.</div>";
          return;
        }
        box.innerHTML = "";
        rows.forEach(function (row) {
          var line = document.createElement("div");
          line.className = "pt-pub-row";

          var label = document.createElement("b");
          label.textContent = row.term + " - " + row.session;
          line.appendChild(label);

          var badge = document.createElement("span");
          badge.className = "pt-pub-badge";
          badge.textContent = "Published";
          line.appendChild(badge);

          var btn = document.createElement("button");
          btn.className = "mg-btn";
          btn.type = "button";
          btn.textContent = "\u{1F4C4} View Report Sheet";
          btn.addEventListener("click", function () {
            openReport(row.term, row.session, btn);
          });
          line.appendChild(btn);

          box.appendChild(line);
        });
      })
      .catch(function () {
        box.innerHTML = '<div class="pt-empty">Could not load results. Please check your internet and refresh.</div>';
      });
  }

  /* ------------------------ report sheet --------------------------- */
  function openReport(term, session, btn) {
    var wrap = document.getElementById("ptReportCardWrap");
    var holder = document.getElementById("ptReport");
    btn.disabled = true;
    btn.textContent = "Loading...";

    window.amsFetchReportPack(student.student_id, term, session)
      .then(function (pack) {
        if (!pack.rows.length) {
          alert("This result could not be loaded. It may have been unpublished - please refresh and try again.");
          return;
        }
        holder.innerHTML = "";
        holder.appendChild(window.amsBuildReportCard(pack, term, session));
        wrap.style.display = "block";
        wrap.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(function () {
        alert("Network error - please try again.");
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "\u{1F4C4} View Report Sheet";
      });
  }

  document.getElementById("ptPrintBtn").addEventListener("click", function () {
    window.print(); // print rules in css/school.css hide portal chrome only
  });

  document.getElementById("ptCloseReport").addEventListener("click", function () {
    document.getElementById("ptReportCardWrap").style.display = "none";
    document.getElementById("ptReport").innerHTML = "";
  });

  /* ---------------------------- logout ----------------------------- */
  document.getElementById("portalLogoutBtn").addEventListener("click", function () {
    fetch("/portal/logout", { method: "POST" })
      .catch(function () {})
      .finally(goLogin);
  });
})();
