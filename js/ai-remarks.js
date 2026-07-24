/* ==========================================================================
   NEW FILE (pack 27 - owner: "Can we build ai inside the project"):
   js/ai-remarks.js - drives ai-remarks.html.
   Flow: /me guard -> /classes fills the picker -> Load Class pulls the
   read-only /class-results rows -> averages computed client-side (SAME
   simple mean the report cards use, pure display) -> sparkle button calls
   /api/ai/remark per student -> results land in EDITABLE textareas ->
   Print builds a clean remarks sheet. Nothing is saved to the database -
   this is a drafting helper only; real report cards keep their own
   untouched remark logic.
   ========================================================================== */
(function () {
  "use strict";

  var students = []; // [{sid,name,avg,best,weak,remark}]
  var generating = false;

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function status(msg, isErr) {
    var el = $("armStatus");
    el.textContent = msg;
    el.className = "rm-status" + (isErr ? " err" : "");
  }
  function toast(msg, kind) {
    if (window.amsToast) window.amsToast(msg, kind || "info", 4200);
  }

  /* staff session required (same style as other staff pages) */
  fetch("/me").then(function (r) { return r.json(); }).then(function (me) {
    if (!me || !me.loggedIn) { window.location.replace("login.html"); return; }
    loadClasses();
    checkAiStatus();
  }).catch(function () { window.location.replace("login.html"); });

  function checkAiStatus() {
    fetch("/api/ai/status").then(function (r) { return r.json(); }).then(function (d) {
      if (!d.enabled) {
        var note = $("armNote");
        note.style.display = "block";
        note.innerHTML = "<b>AI is not switched on yet.</b> Everything else works - but to use the sparkle, the school adds its free AI key once (see the Pack 27 setup note: Render &rarr; Environment &rarr; <b>AI_API_KEY</b>). It takes about two minutes.";
      }
    }).catch(function () {});
  }

  function loadClasses() {
    fetch("/classes")
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        var sel = $("armClass");
        sel.innerHTML = '<option value="" disabled selected>Select Class</option>';
        (Array.isArray(rows) ? rows : []).forEach(function (c) {
          var o = document.createElement("option");
          o.value = c.name || c.class_name || "";
          o.textContent = c.name || c.class_name || "";
          sel.appendChild(o);
        });
      })
      .catch(function () { status("Could not load classes - check your connection.", true); });
  }

  /* Load + group the class's subject rows into one line per student */
  function loadClassResults() {
    var cls = $("armClass").value, term = $("armTerm").value, ses = $("armSession").value;
    if (!cls) { status("Pick a class first.", true); return; }
    status("Loading " + cls + " - " + term + ", " + ses + "...");
    $("armLoadBtn").disabled = true;
    fetch("/class-results?class=" + encodeURIComponent(cls) + "&term=" + encodeURIComponent(term) + "&session=" + encodeURIComponent(ses))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { status(res.d && res.d.message ? res.d.message : "Could not load results.", true); return; }
        var byId = {};
        (Array.isArray(res.d) ? res.d : []).forEach(function (row) {
          var sid = row.student_id;
          if (!byId[sid]) byId[sid] = { sid: sid, name: row.student_name, rows: [] };
          byId[sid].rows.push(row);
        });
        students = Object.keys(byId).map(function (sid) {
          var st = byId[sid];
          var nums = st.rows.map(function (r) { return Number(r.total) || 0; });
          var avg = nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : 0;
          var best = "", weak = "", hi = -1, lo = 999;
          st.rows.forEach(function (r) {
            var t = Number(r.total) || 0;
            if (t > hi) { hi = t; best = r.subject; }
            if (t < lo) { lo = t; weak = r.subject; }
          });
          if (best === weak) { best = ""; weak = ""; } // single-subject class: nothing to compare
          return { sid: sid, name: st.name, subjects: nums.length, avg: Math.round(avg * 10) / 10, best: best, weak: weak, remark: "" };
        });
        students.sort(function (a, b) { return a.name.localeCompare(b.name); });
        renderTable();
        var has = students.length > 0;
        $("armAllBtn").disabled = !has;
        $("armPrintBtn").disabled = !has;
        status(has
          ? students.length + " student(s) loaded - press the sparkle on a row, or Generate All."
          : "No results found for that class/term/session yet.");
      })
      .catch(function () { status("Network error - try again.", true); })
      .finally(function () { $("armLoadBtn").disabled = false; });
  }

  function avgClass(avg) { return avg >= 70 ? "good" : (avg >= 50 ? "mid" : "low"); }

  function renderTable() {
    var tb = $("armRows");
    if (!students.length) {
      tb.innerHTML = '<tr><td colspan="5" class="rm-empty">No students to show.</td></tr>';
      return;
    }
    tb.innerHTML = "";
    students.forEach(function (st, i) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + (i + 1) + "</td>" +
        '<td><span class="rm-name">' + esc(st.name) + "</span><br>" +
        '<span class="rm-sub">' + esc(st.sid) + " · " + st.subjects + " subject(s)</span></td>" +
        '<td><span class="rm-avg ' + avgClass(st.avg) + '">' + st.avg + "%</span></td>" +
        '<td><textarea class="rm-remark" id="armRemark' + i + '" placeholder="Press the sparkle - or write it yourself...">' + esc(st.remark) + "</textarea></td>" +
        '<td><button type="button" class="rm-one" id="armOne' + i + '" title="Write this remark with AI">&#10024;</button></td>';
      tb.appendChild(tr);
      (function (idx) {
        $("armOne" + idx).addEventListener("click", function () { generateOne(idx); });
        $("armRemark" + idx).addEventListener("input", function (ev) { students[idx].remark = ev.target.value; });
      })(i);
    });
  }

  /* One AI call for one student (the page loops for "all") */
  function generateOne(i) {
    var st = students[i];
    var btn = $("armOne" + i), box = $("armRemark" + i);
    btn.disabled = true;
    btn.textContent = "\u23F3";
    return fetch("/api/ai/remark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: st.name, average: st.avg,
        className: $("armClass").value, term: $("armTerm").value,
        best: st.best, weak: st.weak
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.remark) {
          st.remark = res.d.remark;
          box.value = res.d.remark;
        } else {
          toast(res.d && res.d.error ? res.d.error : "The AI stumbled - try again.", "error");
        }
      })
      .catch(function () { toast("Network error - try again.", "error"); })
      .finally(function () {
        btn.disabled = false;
        btn.innerHTML = "&#10024;";
      });
  }

  function generateAll() {
    if (generating || !students.length) return;
    generating = true;
    var allBtn = $("armAllBtn");
    allBtn.disabled = true;
    var i = 0;
    function next() {
      if (i >= students.length) {
        generating = false;
        allBtn.disabled = false;
        status("Done - review the remarks, edit any you like, then print the sheet.");
        toast("All remarks drafted ✓ review and edit before printing.", "success");
        return;
      }
      // skip rows the teacher already wrote or generated
      if (students[i].remark.trim()) { i++; return next(); }
      status("Generating remark " + (i + 1) + " of " + students.length + " (" + students[i].name + ")...");
      generateOne(i).then(function () {
        i++;
        setTimeout(next, 450); // gentle pacing - kind to the free AI service
      });
    }
    next();
  }

  /* Build + print a clean remarks sheet (screen page is untouched) */
  function printSheet() {
    // capture current textarea values first (teacher may be mid-edit)
    students.forEach(function (st, i) {
      var box = $("armRemark" + i);
      if (box) st.remark = box.value;
    });
    var cls = $("armClass").value, term = $("armTerm").value, ses = $("armSession").value;
    var rows = students.map(function (st, i) {
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(st.name) + "</td><td>" + st.avg + "%</td><td>" + esc(st.remark || "") + "</td></tr>";
    }).join("");
    $("armSheet").innerHTML =
      "<h1>Ameenullah School of Arabic &amp; Islamic Studies</h1>" +
      '<p class="sub">Teacher\'s Remarks Sheet - ' + esc(cls) + " · " + esc(term) + " · " + esc(ses) + "</p>" +
      "<table><thead><tr><th style='width:34px;'>#</th><th>Student</th><th style='width:74px;'>Average</th><th>Teacher's Remark</th></tr></thead><tbody>" +
      rows + "</tbody></table>" +
      '<div class="sig"><span>Class Teacher: ______________________</span><span>Date: ______________</span></div>';
    window.print();
  }

  $("armLoadBtn").addEventListener("click", loadClassResults);
  $("armAllBtn").addEventListener("click", generateAll);
  $("armPrintBtn").addEventListener("click", printSheet);
})();
