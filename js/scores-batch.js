/* ==========================================================================
   BATCH SCORE ENTRY  (js/scores-batch.js)
   --------------------------------------------------------------------------
   Powers the "Batch Entry" tab on scores.html: pick Class + Session + Term +
   Subject ONCE, see every student in the class in one grid, type all their
   scores, and save the whole class with ONE button (POST /api/scores/batch).

   - Pick-once filters are remembered in localStorage, so returning teachers
     don't have to re-select everything every time.
   - Existing scores for the same class/term/session/subject are pre-filled,
     so the grid doubles as an edit sheet (re-save updates, never duplicates).
   - Fully responsive: desktop table grid, mobile student cards, sticky save
     bar, live CA / Total / Grade per row, search filter, progress + per-row
     save status.
   - Additive: the single-student form keeps its original ids and handlers.
   ========================================================================== */
(function () {
  "use strict";

  var LS_KEY = "ams-scores-batch-v1";
  var batchStudents = [];
  var batchScores = {};
  var batchLoading = false;
  var batchSaving = false;

  function $(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function notify(msg, type) {
    if (window.amsToast) window.amsToast(msg, type || "success", 4200);
    else alert(msg);
  }

  function clampNum(v, max) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > max) return max;
    return n;
  }

  function gradeFor(total) {
    var t = Number(total) || 0;
    if (t >= 70) return "A";
    if (t >= 60) return "B";
    if (t >= 50) return "C";
    if (t >= 45) return "D";
    if (t >= 40) return "E";
    return "F";
  }

  function numOrBlank(v) {
    if (v == null || v === "") return "";
    var n = Number(v);
    if (!isFinite(n)) return "";
    return String(Math.round(n * 100) / 100);
  }

  function sidKey(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

  /* ---------------- bottom navigation vs. the sticky save bar ----------------
     FIX (pack 111 - owner: "the save is falling under the bottom nav causing not
     to be able to save it").
     Every staff page carries the shared fixed quick-nav bar at the bottom of the
     screen (created by js/staff-navigation.js, styled in css/staff-navigation.css
     at z-index 995, about 61px tall). The batch save bar is fixed to the bottom
     as well, so on phones/tablets the navigation really did sit on top of
     "Save All Scores" - the button was unreachable.
     We now measure that bar and publish it as --ams-bb-nav-lift; scores.html
     uses it to lift the save bar (and to pad the page) above the navigation. */
  var bbNavWatch = { ro: null, el: null };
  var bbSyncing = false;

  function bbNavBar() {
    return document.querySelector(".ams-shared-quicknav, .ams-quicknav");
  }

  function bbSyncBottomSpace() {
    if (!document.documentElement || bbSyncing) return;
    bbSyncing = true;
    try { bbMeasureBottomSpace(); } finally { bbSyncing = false; }
  }

  function bbMeasureBottomSpace() {
    var doc = document.documentElement;

    /* 1. How tall is the bottom navigation right now? It only counts when it is
          actually rendered and pinned to the bottom of the viewport (it is
          display:none on desktop, and both nav implementations are fixed). */
    var navH = 0;
    var nav = bbNavBar();
    if (nav && nav.getBoundingClientRect) {
      var r = nav.getBoundingClientRect();
      var cs = window.getComputedStyle ? window.getComputedStyle(nav) : null;
      var off = cs && (cs.display === "none" || cs.visibility === "hidden");
      var pinned = !cs || cs.position === "fixed";
      if (!off && pinned && r.height > 0 && r.bottom >= (window.innerHeight || 0) - 2) {
        navH = Math.round(r.height);
      }
    }
    doc.classList.toggle("ams-bb-lifted", navH > 0);
    doc.style.setProperty("--ams-bb-nav-lift", navH + "px");

    /* 2. How tall is the save bar? (measured after step 1 so the lifted padding
          is already applied). It only counts while it is on screen. */
    var bar = $("bbSaveBar");
    var barH = 0;
    if (bar && bar.getBoundingClientRect && bar.style.display !== "none") {
      barH = Math.round(bar.getBoundingClientRect().height);
    }
    doc.style.setProperty("--ams-bb-save-h", barH + "px");
    if (document.body) document.body.classList.toggle("ams-bb-savebar-on", barH > 0);

    /* 3. Follow the navigation even when it is swapped in later (a fresh bar is
          created after the /me answer) or resized (rotation, zoom, labels). */
    if (window.ResizeObserver) {
      if (bbNavWatch.el !== nav) {
        if (bbNavWatch.ro) bbNavWatch.ro.disconnect();
        bbNavWatch.ro = new ResizeObserver(function () { bbSyncBottomSpace(); });
        if (nav) bbNavWatch.ro.observe(nav);
        bbNavWatch.el = nav;
      }
    }
  }

  function bbWatchBottomNav() {
    bbSyncBottomSpace();
    if (window.MutationObserver && document.body) {
      new MutationObserver(function () { bbSyncBottomSpace(); })
        .observe(document.body, { childList: true });
    }
    window.addEventListener("resize", bbSyncBottomSpace);
    window.addEventListener("orientationchange", function () { setTimeout(bbSyncBottomSpace, 250); });
    /* The bar is injected after a /me round-trip; a couple of late syncs make
       sure the lift is right even if no observer fires. */
    [250, 800, 1800].forEach(function (ms) { setTimeout(bbSyncBottomSpace, ms); });
  }

  /* ---------------- saved scores show up by themselves ----------------
     FIX (pack 112 - owner: "If student is picking in both batch entry and
     single student score it must automatically display scores that has been
     input before not just empty space and to avoid duplicate").
     The pick-once filters now LOAD the grid by themselves:
       * coming back to the same class (the picks are remembered) opens the
         grid already filled with the scores that were entered before - no
         empty area, no pressing anything;
       * changing any pick while a class is on screen reloads the grid for the
         new pick, so the saved marks for that class/subject appear at once
         (the grid pre-fills from /api/scores/batch, and saving UPDATES those
         same rows - it never adds a second copy).
     "Load Students" keeps working exactly as before. */
  var bbAutoTimer = null;
  var bbGridShown = false;

  function bbPickComplete() {
    return !!(($("bbClass") || {}).value && ($("bbSession") || {}).value &&
      ($("bbTerm") || {}).value && ($("bbSubject") || {}).value);
  }

  function bbAutoLoad(delay) {
    clearTimeout(bbAutoTimer);
    bbAutoTimer = setTimeout(function () {
      var panel = $("amsBatchPanel");
      if (panel && panel.style.display === "none") return;   // single-student tab is on screen
      if (!bbGridShown) return;                              // first visit -> the Load Students button
      if (!bbPickComplete()) return;                         // still picking
      /* Never throw away work: if the teacher has unsaved edits in the grid,
         the reload waits for them to press Load Students themselves. */
      if (document.querySelector("#bbGrid .bb-row.bb-dirty")) return;
      window.bbLoad();
    }, delay == null ? 300 : delay);
  }

  /* ---------------- tab switching ---------------- */
  window.amsScoresTab = function (which) {
    var batchPanel = $("amsBatchPanel");
    var singlePanel = $("amsSinglePanel");
    var batchBtn = $("amsTabBatch");
    var singleBtn = $("amsTabSingle");
    var showBatch = which !== "single";
    if (batchPanel) batchPanel.style.display = showBatch ? "" : "none";
    if (singlePanel) singlePanel.style.display = showBatch ? "none" : "";
    if (batchBtn) batchBtn.classList.toggle("active", showBatch);
    if (singleBtn) singleBtn.classList.toggle("active", !showBatch);
    try { localStorage.setItem(LS_KEY + "-tab", showBatch ? "batch" : "single"); } catch (e) {}
    bbSyncBottomSpace(); /* the tab decides whether the save bar is on screen */
    if (!showBatch) {
      var anchor = $("score-entry");
      if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  /* ---------------- remembered pick-once filters ---------------- */
  function readSaved() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function writeSaved() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        class_name: ($("bbClass") || {}).value || "",
        session: ($("bbSession") || {}).value || "",
        term: ($("bbTerm") || {}).value || "",
        subject: ($("bbSubject") || {}).value || ""
      }));
    } catch (e) {}
  }

  /* ---------------- dropdown loading ---------------- */
  function loadBatchClasses(selected) {
    var sel = $("bbClass");
    if (!sel) return Promise.resolve();
    return fetch("/classes").then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      var keep = selected || sel.value || "";
      sel.innerHTML = '<option value="">Select class…</option>' + (list || []).map(function (c) {
        return '<option value="' + esc(c.class_name) + '">' + esc(c.class_name) + "</option>";
      }).join("");
      if (keep) sel.value = keep;
      if (sel.value !== keep) sel.value = "";
    }).catch(function () {
      if (!sel.options.length) sel.innerHTML = '<option value="">Could not load classes</option>';
    });
  }

  function loadBatchSessions(selected) {
    var sel = $("bbSession");
    if (!sel) return Promise.resolve();
    return fetch("/sessions").then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      list = Array.isArray(list) ? list : [];
      var current = "";
      list.forEach(function (s) { if (Number(s.is_current) === 1) current = s.session; });
      var keep = selected || sel.value || current || "";
      // Merge server sessions with the well-known recent sessions so the
      // dropdown is never empty on older databases.
      var names = [];
      list.forEach(function (s) { if (s && s.session) names.push(s.session); });
      ["2025/2026", "2026/2027", "2027/2028", "2028/2029", "2029/2030"].forEach(function (n) {
        if (names.indexOf(n) === -1) names.push(n);
      });
      names.sort();
      sel.innerHTML = '<option value="">Select session…</option>' + names.map(function (n) {
        return '<option value="' + esc(n) + '">' + esc(n) + (n === current ? " ★" : "") + "</option>";
      }).join("");
      if (keep) sel.value = keep;
      if (sel.value !== keep) sel.value = current || "";
    }).catch(function () {
      sel.innerHTML = '<option value="">Select session…</option>' +
        ["2025/2026", "2026/2027", "2027/2028", "2028/2029", "2029/2030"].map(function (n) {
          return '<option value="' + n + '">' + n + "</option>";
        }).join("");
      if (selected) sel.value = selected;
    });
  }

  function loadBatchSubjects(className, selected) {
    var sel = $("bbSubject");
    if (!sel) return Promise.resolve();
    if (!className) {
      sel.innerHTML = '<option value="">Pick a class first…</option>';
      return Promise.resolve();
    }
    sel.innerHTML = '<option value="">Loading subjects…</option>';
    return fetch("/subjects?class=" + encodeURIComponent(className))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        list = Array.isArray(list) ? list : [];
        if (!list.length) {
          sel.innerHTML = '<option value="">No subjects for this class yet</option>';
          return;
        }
        sel.innerHTML = '<option value="">Select subject…</option>' + list.map(function (s) {
          return '<option value="' + esc(s.subject_name) + '">' + esc(s.subject_name) + "</option>";
        }).join("");
        if (selected) {
          sel.value = selected;
          if (sel.value !== selected) sel.value = "";
        }
      }).catch(function () {
        sel.innerHTML = '<option value="">Could not load subjects</option>';
      });
  }

  /* ---------------- load the class grid ---------------- */
  window.bbLoad = function () {
    if (batchLoading) return;
    var cls = ($("bbClass") || {}).value || "";
    var session = ($("bbSession") || {}).value || "";
    var term = ($("bbTerm") || {}).value || "";
    var subject = ($("bbSubject") || {}).value || "";
    var status = $("bbStatus");
    if (!cls || !session || !term || !subject) {
      if (status) status.textContent = "Pick a class, session, term and subject first — just once — then load.";
      notify("Pick Class, Session, Term and Subject first.", "info");
      return;
    }
    writeSaved();
    batchLoading = true;
    bbGridShown = true;          /* from now on a pick change reloads by itself (see bbAutoLoad) */
    if (status) status.textContent = "Loading " + cls + " · " + subject + "…";
    var grid = $("bbGrid");
    if (grid) grid.innerHTML = '<div class="bb-loading">Loading students…</div>';
    var bar = $("bbSaveBar");
    if (bar) bar.style.display = "none";
    bbSyncBottomSpace(); /* save bar hidden again - free the space it took */

    fetch("/api/scores/batch?class=" + encodeURIComponent(cls) +
      "&term=" + encodeURIComponent(term) +
      "&session=" + encodeURIComponent(session) +
      "&subject=" + encodeURIComponent(subject))
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; }).catch(function () {
          return { ok: false, d: { message: "Could not load the class list." } };
        });
      })
      .then(function (res) {
        batchLoading = false;
        if (!res.ok) throw new Error((res.d && res.d.message) || "Could not load the class list.");
        batchStudents = Array.isArray(res.d.students) ? res.d.students : [];
        batchScores = res.d.scores || {};
        renderBatchGrid();
        var n = batchStudents.length;
        var pre = Object.keys(batchScores).length;
        if (status) {
          status.textContent = n
            ? (n + " student" + (n === 1 ? "" : "s") + " · " + subject + " · " + cls + " · " + term + ", " + session +
               (pre ? " · " + pre + " already have scores (pre-filled, editable)." : " · fresh sheet."))
            : "No students found in " + cls + ". Check Students / Class Management for the exact class name.";
        }
        if (bar) bar.style.display = n ? "" : "none";
        bbSyncBottomSpace(); /* keep Save All Scores above the bottom nav */
        updateBatchCount();
      })
      .catch(function (err) {
        batchLoading = false;
        if (status) status.textContent = (err && err.message) || "Could not load the class list.";
        if (grid) grid.innerHTML = '<div class="bb-empty">Could not load students. Check your connection and try again.</div>';
      });
  };

  window.bbClearFilters = function () {
    ["bbClass", "bbTerm", "bbSession", "bbSubject"].forEach(function (id) {
      var el = $(id);
      if (el) el.value = "";
    });
    var sub = $("bbSubject");
    if (sub) sub.innerHTML = '<option value="">Pick a class first…</option>';
    var grid = $("bbGrid");
    if (grid) grid.innerHTML = '<div class="bb-empty">Pick the class details above and press <b>Load Students</b> — the whole class appears here.</div>';
    var bar = $("bbSaveBar");
    if (bar) bar.style.display = "none";
    bbSyncBottomSpace();
    var status = $("bbStatus");
    if (status) status.textContent = "Pick a class, session, term and subject — just once.";
    batchStudents = [];
    batchScores = {};
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    updateBatchCount();
  };

  /* ---------------- grid rendering ---------------- */
  function existingFor(sid) {
    return batchScores[sidKey(sid)] || null;
  }

  function renderBatchGrid() {
    var grid = $("bbGrid");
    if (!grid) return;
    if (!batchStudents.length) {
      grid.innerHTML = '<div class="bb-empty">No students in this class.</div>';
      return;
    }
    var q = (($("bbSearch") || {}).value || "").trim().toLowerCase();
    var html = "";
    html += '<div class="bb-table-wrap"><table class="bb-table" id="bbTable"><thead><tr>' +
      '<th class="bb-c-num">#</th>' +
      '<th class="bb-c-stu">Student</th>' +
      '<th title="Max 10">1st<span class="bb-max">/10</span></th>' +
      '<th title="Max 10">2nd<span class="bb-max">/10</span></th>' +
      '<th title="Max 10">Note<span class="bb-max">/10</span></th>' +
      '<th title="Max 10">Att.<span class="bb-max">/10</span></th>' +
      '<th class="bb-c-auto">CA<span class="bb-max">/40</span></th>' +
      '<th title="Max 60">Exam<span class="bb-max">/60</span></th>' +
      '<th class="bb-c-auto">Total<span class="bb-max">/100</span></th>' +
      '<th class="bb-c-auto">Grade</th>' +
      '<th class="bb-c-flag" title="Saved?">✓</th>' +
      "</tr></thead><tbody>";

    batchStudents.forEach(function (st, i) {
      var row = existingFor(st.student_id);
      var f1 = row ? numOrBlank(row.first_test) : "";
      var f2 = row ? numOrBlank(row.second_test) : "";
      var nt = row ? numOrBlank(row.note_score) : "";
      var at = row ? numOrBlank(row.attendance_score) : "";
      var ex = row ? numOrBlank(row.exam_score) : "";
      var has = !!row;
      var qHay = sidKey(st.student_id) + " " + String(st.full_name || "").toLowerCase();
      html += '<tr class="bb-row' + (has ? " bb-has" : "") + '" data-sid="' + esc(st.student_id) +
        '" data-name="' + esc(st.full_name || "") + '" data-q="' + esc(qHay) + '"' +
        (q && qHay.indexOf(q) === -1 ? ' style="display:none;"' : "") + ">" +
        '<td class="bb-c-num">' + (i + 1) + "</td>" +
        '<td class="bb-c-stu"><span class="bb-name">' + esc(st.full_name || "-") + "</span>" +
          '<span class="bb-id">' + esc(st.student_id) + "</span></td>" +
        '<td><input type="number" class="bb-in bb-f1" min="0" max="10" step="any" inputmode="decimal" placeholder="–" value="' + esc(f1) + '" aria-label="First test for ' + esc(st.full_name || "") + '"></td>' +
        '<td><input type="number" class="bb-in bb-f2" min="0" max="10" step="any" inputmode="decimal" placeholder="–" value="' + esc(f2) + '" aria-label="Second test for ' + esc(st.full_name || "") + '"></td>' +
        '<td><input type="number" class="bb-in bb-nt" min="0" max="10" step="any" inputmode="decimal" placeholder="–" value="' + esc(nt) + '" aria-label="Note for ' + esc(st.full_name || "") + '"></td>' +
        '<td><input type="number" class="bb-in bb-at" min="0" max="10" step="any" inputmode="decimal" placeholder="–" value="' + esc(at) + '" aria-label="Attendance for ' + esc(st.full_name || "") + '"></td>' +
        '<td class="bb-c-auto"><span class="bb-ca">–</span></td>' +
        '<td><input type="number" class="bb-in bb-ex bb-exam" min="0" max="60" step="any" inputmode="decimal" placeholder="–" value="' + esc(ex) + '" aria-label="Exam for ' + esc(st.full_name || "") + '"></td>' +
        '<td class="bb-c-auto"><span class="bb-tot">–</span></td>' +
        '<td class="bb-c-auto"><span class="bb-grade">–</span></td>' +
        '<td class="bb-c-flag"><span class="bb-flag" title="' + (has ? "Already saved" : "Not saved yet") + '">' + (has ? "●" : "○") + "</span></td>" +
        "</tr>";
    });
    html += "</tbody></table></div>";
    grid.innerHTML = html;
    bindBatchRows();
    // Initial calc for pre-filled rows.
    Array.prototype.forEach.call(grid.querySelectorAll(".bb-row"), recalcBatchRow);
    applyBatchSearch();
  }

  function bindBatchRows() {
    var grid = $("bbGrid");
    if (!grid) return;
    Array.prototype.forEach.call(grid.querySelectorAll(".bb-row"), function (tr) {
      Array.prototype.forEach.call(tr.querySelectorAll(".bb-in"), function (inp) {
        inp.addEventListener("input", function () {
          // Clamp live so teachers can't type above the max.
          var max = inp.classList.contains("bb-exam") ? 60 : 10;
          if (inp.value !== "" && Number(inp.value) > max) inp.value = String(max);
          if (inp.value !== "" && Number(inp.value) < 0) inp.value = "0";
          recalcBatchRow(tr);
          tr.classList.add("bb-dirty");
          tr.classList.remove("bb-saved", "bb-error");
          updateBatchCount();
        });
        // Enter / arrow-down jumps to the same column of the next student,
        // so typing down a whole class is one smooth flow.
        inp.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          var col = inp.className.split(" ").filter(function (c) { return /^bb-(f1|f2|nt|at|ex)$/.test(c); })[0];
          if (!col) return;
          var rows = Array.prototype.filter.call(
            grid.querySelectorAll(".bb-row"), function (r) { return r.style.display !== "none"; });
          var at = rows.indexOf(tr);
          var go = e.key === "ArrowUp" ? at - 1 : at + 1;
          if (go < 0 || go >= rows.length) return;
          var target = rows[go].querySelector("." + col);
          if (target) { target.focus(); if (target.select) target.select(); }
        });
      });
    });
  }

  function rowNumbers(tr) {
    function val(sel, max) {
      var el = tr.querySelector(sel);
      if (!el || el.value === "") return null;
      return clampNum(el.value, max);
    }
    return {
      f1: val(".bb-f1", 10),
      f2: val(".bb-f2", 10),
      nt: val(".bb-nt", 10),
      at: val(".bb-at", 10),
      ex: val(".bb-ex", 60)
    };
  }

  function rowIsEmpty(tr) {
    var n = rowNumbers(tr);
    return n.f1 == null && n.f2 == null && n.nt == null && n.at == null && n.ex == null;
  }

  function recalcBatchRow(tr) {
    var n = rowNumbers(tr);
    var caEl = tr.querySelector(".bb-ca");
    var totEl = tr.querySelector(".bb-tot");
    var grEl = tr.querySelector(".bb-grade");
    if (n.f1 == null && n.f2 == null && n.nt == null && n.at == null && n.ex == null) {
      if (caEl) caEl.textContent = "–";
      if (totEl) totEl.textContent = "–";
      if (grEl) { grEl.textContent = "–"; grEl.className = "bb-grade"; }
      return { ca: 0, total: 0, grade: "", empty: true };
    }
    var ca = (n.f1 || 0) + (n.f2 || 0) + (n.nt || 0) + (n.at || 0);
    ca = Math.max(0, Math.min(40, ca));
    var total = Math.max(0, Math.min(100, ca + (n.ex || 0)));
    var grade = gradeFor(total);
    if (caEl) caEl.textContent = String(Math.round(ca * 100) / 100);
    if (totEl) totEl.textContent = String(Math.round(total * 100) / 100);
    if (grEl) { grEl.textContent = grade; grEl.className = "bb-grade bb-g-" + grade; }
    return { ca: ca, total: total, grade: grade, empty: false };
  }

  /* ---------------- search + counts ---------------- */
  window.bbSearch = function () { applyBatchSearch(); };

  function applyBatchSearch() {
    var q = (($("bbSearch") || {}).value || "").trim().toLowerCase();
    var shown = 0, total = 0;
    Array.prototype.forEach.call(document.querySelectorAll("#bbGrid .bb-row"), function (tr) {
      total++;
      var hay = tr.getAttribute("data-q") || "";
      var show = !q || hay.indexOf(q) !== -1;
      tr.style.display = show ? "" : "none";
      if (show) shown++;
    });
    var c = $("bbVisibleCount");
    if (c) c.textContent = total ? ("Showing " + shown + " of " + total) : "";
  }

  function updateBatchCount() {
    var filled = 0, edited = 0;
    Array.prototype.forEach.call(document.querySelectorAll("#bbGrid .bb-row"), function (tr) {
      if (!rowIsEmpty(tr)) filled++;
      if (tr.classList.contains("bb-dirty")) edited++;
    });
    var btn = $("bbSaveBtn");
    if (btn && !batchSaving) {
      btn.innerHTML = filled
        ? ("💾 Save All Scores <span class=\"bb-btn-n\">(" + filled + " student" + (filled === 1 ? "" : "s") + ")</span>")
        : "💾 Save All Scores";
    }
    var hint = $("bbEditedHint");
    if (hint) hint.textContent = edited ? (edited + " row" + (edited === 1 ? "" : "s") + " edited since load") : "";
  }

  /* ---------------- save all at once ---------------- */
  window.bbSaveAll = function () {
    if (batchSaving) return;
    var cls = ($("bbClass") || {}).value || "";
    var session = ($("bbSession") || {}).value || "";
    var term = ($("bbTerm") || {}).value || "";
    var subject = ($("bbSubject") || {}).value || "";
    if (!cls || !session || !term || !subject) {
      notify("Pick Class, Session, Term and Subject first.", "info");
      return;
    }
    var rows = document.querySelectorAll("#bbGrid .bb-row");
    if (!rows.length) {
      notify("Load the class first, then type scores.", "info");
      return;
    }
    var payload = [];
    var emptyCount = 0;
    Array.prototype.forEach.call(rows, function (tr) {
      if (rowIsEmpty(tr)) { emptyCount++; return; }
      var n = rowNumbers(tr);
      payload.push({
        student_id: tr.getAttribute("data-sid") || "",
        student_name: tr.getAttribute("data-name") || "",
        first_test: n.f1 == null ? 0 : n.f1,
        second_test: n.f2 == null ? 0 : n.f2,
        note_score: n.nt == null ? 0 : n.nt,
        attendance_score: n.at == null ? 0 : n.at,
        exam_score: n.ex == null ? 0 : n.ex
      });
    });
    if (!payload.length) {
      notify("Type at least one student's scores before saving.", "info");
      return;
    }

    batchSaving = true;
    var btn = $("bbSaveBtn");
    var prog = $("bbProgress");
    if (btn) { btn.disabled = true; btn.innerHTML = "⏳ Saving " + payload.length + " scores…"; }
    if (prog) { prog.style.display = "block"; prog.textContent = "Saving " + payload.length + " scores in one go…"; }
    bbSyncBottomSpace(); /* the bar grew a progress line - re-measure it */
    writeSaved();

    fetch("/api/scores/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        class_name: cls, term: term, session: session, subject: subject, scores: payload
      })
    })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; }).catch(function () {
          return { ok: false, d: { message: "Save failed. Check your connection." } };
        });
      })
      .then(function (res) {
        batchSaving = false;
        if (btn) btn.disabled = false;
        if (!res.ok) throw new Error((res.d && res.d.message) || "Save failed.");
        var savedIds = {};
        payload.forEach(function (p) { savedIds[sidKey(p.student_id)] = 1; });
        (res.d.errors || []).forEach(function (msg) {
          var m = String(msg).match(/^([^:]+):/);
          if (m) delete savedIds[sidKey(m[1])];
        });
        Array.prototype.forEach.call(rows, function (tr) {
          if (rowIsEmpty(tr)) return;
          var ok = !!savedIds[sidKey(tr.getAttribute("data-sid"))];
          tr.classList.remove("bb-dirty", "bb-saved", "bb-error");
          tr.classList.add(ok ? "bb-saved" : "bb-error");
          if (ok) {
            tr.classList.add("bb-has");
            var flag = tr.querySelector(".bb-flag");
            if (flag) { flag.textContent = "●"; flag.title = "Saved"; }
          }
        });
        updateBatchCount();
        if (prog) prog.style.display = "none";
        var msg = (res.d && res.d.message) || "Scores saved.";
        if (emptyCount) msg += " (" + emptyCount + " empty row" + (emptyCount === 1 ? "" : "s") + " skipped.)";
        if (res.d && res.d.errors && res.d.errors.length) msg += " Issues: " + res.d.errors.slice(0, 3).join(" ");
        notify(msg, res.d.errors && res.d.errors.length ? "info" : "success");
        var status = $("bbStatus");
        if (status) status.textContent = msg;
      })
      .catch(function (err) {
        batchSaving = false;
        if (btn) btn.disabled = false;
        if (prog) prog.style.display = "none";
        bbSyncBottomSpace();
        updateBatchCount();
        notify((err && err.message) || "Could not save scores.", "error");
      });
  };

  /* ---------------- init ---------------- */
  function initBatchTab() {
    if (!$("bbClass")) return;
    bbWatchBottomNav();
    var saved = readSaved();
    var termSel = $("bbTerm");
    if (termSel && saved.term) termSel.value = saved.term;
    Promise.all([loadBatchClasses(saved.class_name), loadBatchSessions(saved.session)])
      .then(function () {
        var cls = ($("bbClass") || {}).value || "";
        return loadBatchSubjects(cls, saved.subject);
      })
      .then(function () {
        // If we remembered a full pick-once set, show it immediately - the
        // scores entered before are on the screen without pressing anything.
        var cls = ($("bbClass") || {}).value || "";
        var session = ($("bbSession") || {}).value || "";
        var term = ($("bbTerm") || {}).value || "";
        var subject = ($("bbSubject") || {}).value || "";
        var status = $("bbStatus");
        if (cls && session && term && subject) {
          if (status) {
            status.textContent = "Welcome back — your last class (" + cls + " · " + subject + ") is still selected. Loading the scores entered before…";
          }
          if (typeof window.bbLoad === "function") {
            var panel = $("amsBatchPanel");
            if (!panel || panel.style.display !== "none") {
              bbGridShown = true;
              window.bbLoad();
            }
          }
        } else if (status) {
          status.textContent = "Pick a class, session, term and subject — just once — then press Load Students.";
        }
      });

    var clsSel = $("bbClass");
    if (clsSel) clsSel.addEventListener("change", function () {
      // The subject list for the new class has to land first, then the grid
      // reloads on its own with that class's saved scores.
      loadBatchSubjects(clsSel.value, "").then(function () { bbAutoLoad(250); });
      writeSaved();
    });
    ["bbSession", "bbTerm", "bbSubject"].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener("change", function () {
        writeSaved();
        bbAutoLoad(300);
      });
    });
    var search = $("bbSearch");
    if (search) search.addEventListener("input", applyBatchSearch);

    // Restore last-used tab (default: batch).
    var lastTab = "batch";
    try { lastTab = localStorage.getItem(LS_KEY + "-tab") || "batch"; } catch (e) {}
    window.amsScoresTab(lastTab === "single" ? "single" : "batch");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(initBatchTab, 10);
  } else {
    document.addEventListener("DOMContentLoaded", initBatchTab);
  }
})();
