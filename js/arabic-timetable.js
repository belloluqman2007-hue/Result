/* ============================================================
   Ameenullah School — Printable class timetable
   Screen UI is in English; the printed sheet itself stays in
   Arabic (RTL manuscript letterhead · emerald + brass gold).
   Classes are picked from the school's existing class list
   (/classes) first; extra timetables can still be added by hand.
   Print supports both A4 portrait and A4 landscape.
   ============================================================ */
(function () {
  "use strict";

  var STORAGE_KEY = "ams-arabic-timetables-v2";
  var LEGACY_KEY = "ams-arabic-timetables-v1";

  /* ---- Printed sheet content (stays in Arabic) ---- */
  var DEFAULT_CONFIG = {
    school: "مدرسة أمين الله للعلوم العربية الإسلامية",
    schoolEn: "AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES",
    motto: "الشعار: العلم والعبادة",
    mottoEn: "MOTTO: KNOWLEDGE AND WORSHIP",
    term: "الجدول الدراسي للفترة الأول 1446 / 2025/2026",
    morningTitle: "في الصباح",
    eveningTitle: "في المساء",
    morningDays: [
      { key: "saturday", label: "يوم السبت" },
      { key: "sunday", label: "يوم الأحد" }
    ],
    eveningDays: [
      { key: "monday", label: "يوم الاثنين" },
      { key: "tuesday", label: "يوم الثلاثاء" },
      { key: "wednesday", label: "يوم الأربعاء" }
    ],
    morningPeriods: [
      { n: 1, time: "08:31–09:10" },
      { n: 2, time: "09:11–09:50" },
      { n: 3, time: "10:31–11:00" },
      { n: 4, time: "11:01–11:40" },
      { n: 5, time: "11:41–12:20" },
      { n: 6, time: "12:21–01:00" }
    ],
    eveningSlots: [
      { n: 1, time: "04:31–05:30" },
      { n: 2, time: "05:31–غروب الشمس" }
    ],
    // Show الاستراحة after period row 3 (before row 4), not above row 3.
    breakAfter: 3,
    breakLabel: "الاستراحة",
    breakTime: "10:00 – 10:30"
  };

  /* Values saved by older builds that must be upgraded in place
     (see migrateConfig) so existing timetables keep their data. */
  var LEGACY_BREAK_LABELS = ["فسحة"];
  var LEGACY_BREAK_AFTER = 2;
  var LEGACY_MOTTO = "شعبة العلم والعبادة";

  /* ---- Sample data: used only when the school has no class list yet ---- */
  var DEFAULT_CLASSES = [
    {
      id: "ibtidai-3",
      name: "الثالث الابتدائي",
      morning: {
        saturday: ["الصرف", "الفقه", "التهذيب", "النحو", "الإنجليزية", "القرآن"],
        sunday: ["المحفوظة", "الحديث", "التوحيد", "اللغة العربية", "السيرة", "الصرف"]
      },
      evening: {
        monday: ["الإملاء", "الصرف"],
        tuesday: ["الصرف", "التوحيد"],
        wednesday: ["التهذيب", "الرياضيات"]
      }
    },
    {
      id: "idadi-2",
      name: "الثاني الإعدادي",
      morning: {
        saturday: ["قواعد الإملاء", "التوحيد", "", "الصرف", "الفقه", "شرح التوحيد"],
        sunday: ["القرآن", "التجويد", "اللغة العربية", "التهذيب", "النحو", "السيرة"]
      },
      evening: {
        monday: ["الصرف", "التوحيد"],
        tuesday: ["المحفوظة", "الصرف"],
        wednesday: ["الحديث", "التهذيب"]
      }
    }
  ];

  var state = {
    config: clone(DEFAULT_CONFIG),
    classes: clone(DEFAULT_CLASSES),
    currentId: "",
    printAll: false,
    orientation: "portrait",   // "portrait" | "landscape"
    schoolClasses: [],         // existing school classes from /classes
    schoolLoaded: false,
    schoolLoadFailed: false,
    // Official signature images (role -> saved image path) read from
    // /signatures at RUNTIME ONLY. Deliberately NOT part of save() /
    // sharedData(), so no timetable data can ever be affected by them.
    signatures: {},
    sigStamp: ""               // one cache-buster per page load (see sigSrc)
  };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uid() {
    return "class-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  /* Compare class names loosely: ignore Arabic harakat/diacritics,
     extra spaces and case — so a saved "الثالث الابتدائي" matches the
     official "الثّالث الابتدائيّ" and keeps its timetable data. */
  function normName(s) {
    return String(s == null ? "" : s)
      .replace(/[ً-ٰٟ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function emptyClass(name) {
    var morning = {};
    var evening = {};
    DEFAULT_CONFIG.morningDays.forEach(function (d) {
      morning[d.key] = ["", "", "", "", "", ""];
    });
    DEFAULT_CONFIG.eveningDays.forEach(function (d) {
      evening[d.key] = ["", ""];
    });
    return { id: uid(), name: name || "New Class", morning: morning, evening: evening };
  }

  function pad(arr, n) {
    var out = Array.isArray(arr) ? arr.slice() : [];
    while (out.length < n) out.push("");
    return out.slice(0, n);
  }

  function load() {
    var data = null;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { /* private mode */ }
    if (!data) {
      // Migrate v1 data (keeps every saved timetable).
      try {
        var legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) data = JSON.parse(legacy);
      } catch (e) { /* corrupt storage */ }
    }
    if (!data) return;
    if (data && Array.isArray(data.classes) && data.classes.length) {
      state.classes = data.classes;
    }
    if (data && data.config) {
      state.config = Object.assign(clone(DEFAULT_CONFIG), data.config);
    }
    migrateConfig();
    if (data && data.currentId) state.currentId = data.currentId;
    if (data && (data.orientation === "landscape" || data.orientation === "portrait")) {
      state.orientation = data.orientation;
    }
  }

  /* Upgrade letterhead / break values saved by older builds, so a
     timetable saved before this version still prints with the new
     header (Arabic + English names, الشعار/MOTTO line) and the new
     الاستراحة row. Anything the school typed itself is left alone. */
  function migrateConfig() {
    var cfg = state.config;
    if (!cfg) return;

    var sameAr = function (a, b) { return normName(a) === normName(b); };

    if (!String(cfg.school || "").trim()) cfg.school = DEFAULT_CONFIG.school;
    if (!String(cfg.schoolEn || "").trim()) cfg.schoolEn = DEFAULT_CONFIG.schoolEn;

    if (!String(cfg.motto || "").trim() || sameAr(cfg.motto, LEGACY_MOTTO)) {
      cfg.motto = DEFAULT_CONFIG.motto;
    }
    if (!String(cfg.mottoEn || "").trim()) cfg.mottoEn = DEFAULT_CONFIG.mottoEn;

    var label = String(cfg.breakLabel || "").trim();
    if (!label || LEGACY_BREAK_LABELS.some(function (old) { return sameAr(label, old); })) {
      cfg.breakLabel = DEFAULT_CONFIG.breakLabel;
    }
    if (!String(cfg.breakTime || "").trim()) cfg.breakTime = DEFAULT_CONFIG.breakTime;

    // Older saved timetables placed الاستراحة above period row 3.
    // Move that legacy/default position down so it appears after row 3.
    var breakAfter = Number(cfg.breakAfter);
    if (!breakAfter || breakAfter === LEGACY_BREAK_AFTER) {
      cfg.breakAfter = DEFAULT_CONFIG.breakAfter;
    } else {
      var morningCount = (cfg.morningPeriods || DEFAULT_CONFIG.morningPeriods).length;
      cfg.breakAfter = Math.max(1, Math.min(morningCount, Math.floor(breakAfter)));
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        classes: state.classes,
        config: state.config,
        currentId: state.currentId,
        orientation: state.orientation
      }));
    } catch (e) { /* quota */ }
  }

  function sharedData() {
    return {
      classes: state.classes,
      config: state.config,
      orientation: state.orientation
    };
  }

  function loadShared() {
    return fetch("/api/arabic-timetable", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (result) {
        var data = result && result.data;
        if (!data || !Array.isArray(data.classes) || !data.classes.length || !data.config) return;
        state.classes = data.classes;
        state.config = Object.assign(clone(DEFAULT_CONFIG), data.config);
        if (data.orientation === "landscape" || data.orientation === "portrait") state.orientation = data.orientation;
        migrateConfig();
        if (!state.classes.some(function (c) { return c.id === state.currentId; })) state.currentId = state.classes[0].id;
        save();
      });
  }

  function saveShared() {
    var btn = document.getElementById("saveTimetableBtn");
    if (btn) btn.disabled = true;
    return fetch("/api/arabic-timetable", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: sharedData() })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw new Error(body.message || "Save failed");
        save();
        toast("Saved — all teachers and admin can now see these changes.");
      });
    }).catch(function (e) {
      toast(e.message || "Could not save. Please try again.");
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function currentClass() {
    return state.classes.find(function (c) { return c.id === state.currentId; }) || state.classes[0];
  }

  function toast(msg) {
    var el = document.getElementById("ttToast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  /* ---------- Existing school classes (picked first) ---------- */

  function fetchSchoolClasses() {
    renderExistingPicker();
    fetch("/classes", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (rows) {
        state.schoolLoaded = true;
        state.schoolLoadFailed = false;
        state.schoolClasses = (Array.isArray(rows) ? rows : [])
          .map(function (c) { return String((c && c.class_name) || "").trim(); })
          .filter(Boolean);
        mergeSchoolClasses();
      })
      .catch(function () {
        // Offline / not logged in: keep the saved timetables as-is.
        state.schoolLoaded = true;
        state.schoolLoadFailed = true;
        renderExistingPicker();
      });
  }

  /* Every existing school class gets its own timetable. Saved data is
     matched by name (diacritics-insensitive) so nothing is lost, and the
     official school spelling is adopted automatically. */
  function mergeSchoolClasses() {
    var changed = false;
    state.schoolClasses.forEach(function (name) {
      var found = state.classes.find(function (c) { return normName(c.name) === normName(name); });
      if (found) {
        if (found.name !== name) {
          found.name = name;
          changed = true;
        }
      } else {
        state.classes.push(emptyClass(name));
        changed = true;
      }
    });
    if (changed) {
      save();
      refresh();
      toast("Class list updated from the school register.");
    } else {
      renderExistingPicker();
    }
  }

  function renderExistingPicker() {
    var sel = document.getElementById("existingClassSelect");
    var btn = document.getElementById("addExistingBtn");
    var hint = document.getElementById("existingHint");
    if (!sel || !btn) return;

    if (!state.schoolLoaded) {
      sel.innerHTML = '<option value="">Loading school classes…</option>';
      sel.disabled = true;
      btn.disabled = true;
      if (hint) hint.textContent = "Loading your existing school classes…";
      return;
    }

    if (!state.schoolClasses.length) {
      sel.innerHTML = state.schoolLoadFailed
        ? '<option value="">Could not load school classes</option>'
        : '<option value="">No school classes found</option>';
      sel.disabled = true;
      btn.disabled = true;
      if (hint) hint.textContent = state.schoolLoadFailed
        ? "Could not reach the class list (are you logged in?). You can still add classes manually below."
        : "No classes in the school list yet — add one manually below.";
      return;
    }

    var missing = state.schoolClasses.filter(function (name) {
      return !state.classes.some(function (c) { return normName(c.name) === normName(name); });
    });

    sel.innerHTML = "";
    if (!missing.length) {
      var done = document.createElement("option");
      done.value = "";
      done.textContent = "All school classes already added ✓";
      sel.appendChild(done);
      sel.disabled = true;
      btn.disabled = true;
      if (hint) hint.textContent = "Every existing school class already has a timetable. You can still add extras below.";
      return;
    }

    missing.forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.disabled = false;
    btn.disabled = false;
    if (hint) hint.textContent = "Pick from your existing school classes first — each one gets its own blank timetable to fill in.";
  }

  function addExistingClass() {
    var sel = document.getElementById("existingClassSelect");
    var name = sel ? String(sel.value || "").trim() : "";
    if (!name) return;
    if (state.classes.some(function (c) { return normName(c.name) === normName(name); })) {
      toast("That class already has a timetable.");
      return;
    }
    var cls = emptyClass(name);
    state.classes.push(cls);
    state.currentId = cls.id;
    save();
    refresh();
    toast("Class added: " + name);
  }

  /* ---------- Page orientation (portrait / landscape) ---------- */

  function applyOrientation() {
    var o = state.orientation === "landscape" ? "landscape" : "portrait";
    document.body.classList.toggle("landscape", o === "landscape");
    var sel = document.getElementById("orientationSelect");
    if (sel && sel.value !== o) sel.value = o;
    // @page cannot be scoped to a body class, so the print orientation
    // is driven by this injected rule (it wins over the CSS default).
    var st = document.getElementById("ttOrientationStyle");
    if (!st) {
      st = document.createElement("style");
      st.id = "ttOrientationStyle";
      document.head.appendChild(st);
    }
    st.textContent = "@media print { @page { size: A4 " + o + "; margin: 8mm; } }";
  }

  /* ---------- Printed sheet (Arabic, RTL) ---------- */

  function cornerSvg() {
    return '<svg class="corner tl" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<path d="M4 4h28M4 4v28" stroke="#c4a24a" stroke-width="3"/>' +
      '<path d="M10 10h18M10 10v18" stroke="#0c3327" stroke-width="1.6"/>' +
      '<circle cx="10" cy="10" r="2.4" fill="#c4a24a"/>' +
      '</svg>' +
      '<svg class="corner tr" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<path d="M4 4h28M4 4v28" stroke="#c4a24a" stroke-width="3"/>' +
      '<path d="M10 10h18M10 10v18" stroke="#0c3327" stroke-width="1.6"/>' +
      '<circle cx="10" cy="10" r="2.4" fill="#c4a24a"/>' +
      '</svg>' +
      '<svg class="corner bl" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<path d="M4 4h28M4 4v28" stroke="#c4a24a" stroke-width="3"/>' +
      '<path d="M10 10h18M10 10v18" stroke="#0c3327" stroke-width="1.6"/>' +
      '<circle cx="10" cy="10" r="2.4" fill="#c4a24a"/>' +
      '</svg>' +
      '<svg class="corner br" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<path d="M4 4h28M4 4v28" stroke="#c4a24a" stroke-width="3"/>' +
      '<path d="M10 10h18M10 10v18" stroke="#0c3327" stroke-width="1.6"/>' +
      '<circle cx="10" cy="10" r="2.4" fill="#c4a24a"/>' +
      '</svg>';
  }

  /* Letterhead: the crest sits ONCE, on the left, with the school
     names + motto beside it (the old green basmala photo banner that
     used to sit above the header is gone). */
  function letterheadHtml(cfg) {
    return '<div class="letterhead">' +
      '<div class="letter-row">' +
        '<img class="crest" src="images/LOGO.JPG" alt="شعار المدرسة">' +
        '<div class="letter-names">' +
          '<h2 class="school-ar">' + esc(cfg.school) + "</h2>" +
          '<p class="school-en">' + esc(cfg.schoolEn) + "</p>" +
          '<p class="motto">' +
            '<span class="motto-ar">' + esc(cfg.motto) + "</span>" +
            (cfg.mottoEn ? '<span class="motto-en">' + esc(cfg.mottoEn) + "</span>" : "") +
          "</p>" +
          '<div class="term-line">' + esc(cfg.term) + "</div>" +
        "</div>" +
      "</div>" +
    "</div>" +
    '<div class="gold-rule"></div>';
  }

  function cellText(v) {
    var t = String(v || "").trim();
    if (!t) return '<span class="empty">—</span>';
    return esc(t);
  }

  function morningTable(cls, cfg) {
    var days = cfg.morningDays;
    var html = '<div class="block morning"><div class="block-head">' +
      "<span>☀ " + esc(cfg.morningTitle) + "</span>" +
      "<span class=\"meta\">٦ حصص</span></div>" +
      '<table class="tt"><thead><tr>' +
      "<th>الحصة</th><th>الوقت</th>";
    days.forEach(function (d) { html += "<th>" + esc(d.label) + "</th>"; });
    html += "</tr></thead><tbody>";

    var breakAfter = Number(cfg.breakAfter) || 0;
    cfg.morningPeriods.forEach(function (p, i) {
      html += '<tr><td class="num">' + p.n + '</td><td class="time">' + esc(p.time) + "</td>";
      days.forEach(function (d) {
        var list = pad(cls.morning && cls.morning[d.key], cfg.morningPeriods.length);
        html += "<td>" + cellText(list[i]) + "</td>";
      });
      html += "</tr>";
      if (breakAfter && (i + 1) === breakAfter) {
        html += '<tr class="break-row"><td colspan="' + (2 + days.length) + '">' +
          '<span class="break-label">' + esc(cfg.breakLabel) + "</span>" +
          (cfg.breakTime
            ? '<span class="break-time">' + esc(cfg.breakTime) + "</span>"
            : "") +
          "</td></tr>";
      }
    });
    html += "</tbody></table></div>";
    return html;
  }

  function eveningTable(cls, cfg) {
    var days = cfg.eveningDays;
    var html = '<div class="block evening"><div class="block-head">' +
      "<span>☽ " + esc(cfg.eveningTitle) + "</span>" +
      "<span class=\"meta\">حصّتان · حتى غروب الشمس</span></div>" +
      '<table class="tt"><thead><tr>' +
      "<th>الحصة</th><th>الوقت</th>";
    days.forEach(function (d) { html += "<th>" + esc(d.label) + "</th>"; });
    html += "</tr></thead><tbody>";

    cfg.eveningSlots.forEach(function (p, i) {
      html += '<tr><td class="num">' + p.n + '</td><td class="time">' + esc(p.time) + "</td>";
      days.forEach(function (d) {
        var list = pad(cls.evening && cls.evening[d.key], cfg.eveningSlots.length);
        html += "<td>" + cellText(list[i]) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }

  /* ---------- Official signatures on the printed sheet ----------
     FIX (owner: "the principal and headteacher signature is not
     appearing"). The footer used to be two hard-coded blank lines, and
     this page never asked the server for a signature at all — so the
     Principal / Head Teacher signatures saved in Manage Signatures could
     never show up here (report cards and the term calendar already
     stamp them via the same /signatures endpoint).

     Now each signing slot stamps the school's SAVED signature image when
     one exists, and falls back to the old blank line when it does not —
     so a school with no signature on file sees exactly what it saw
     before. The images are runtime-only state: nothing is written into
     the saved timetable, so no class, period, subject or time can be
     lost by this. */

  /* Cache-buster so a freshly re-uploaded signature is never served from
     the browser/service-worker cache (same trick manage-signatures uses),
     while staying stable within a page load so print + PDF reuse one
     already-decoded image instead of re-downloading it per sheet. */
  function sigSrc(path) {
    var p = String(path || "");
    if (!p) return "";
    return p + (p.indexOf("?") === -1 ? "?" : "&") + "t=" + state.sigStamp;
  }

  /* One signing slot. `role` is a /signatures role id ("principal",
     "head_teacher", …); pass an empty role for a slot that never carries
     an image (the school seal). */
  function sigHtml(role, title, caption) {
    var path = role ? (state.signatures && state.signatures[role]) : "";
    return '<div class="sig">' +
      '<div class="sig-area">' +
        (path ? '<img class="sig-img" src="' + esc(sigSrc(path)) + '" alt="">' : "") +
      "</div>" +
      '<div class="line"></div>' +
      "<b>" + esc(title) + "</b>" + esc(caption) +
    "</div>";
  }

  function sheetHtml(cls, cfg) {
    return '<article class="sheet" dir="rtl" lang="ar" data-class-id="' + esc(cls.id) + '">' +
      cornerSvg() +
      '<div class="watermark"></div>' +
      letterheadHtml(cfg) +
      '<div class="class-banner">الصف: ' + esc(cls.name) +
        "<small>معرفة وعبادة · Knowledge and Worship</small></div>" +
      morningTable(cls, cfg) +
      eveningTable(cls, cfg) +
      '<div class="sheet-foot">' +
        sigHtml("principal", "مدير المدرسة", "التوقيع") +
        sigHtml("head_teacher", "رئيس المعلمين", "التوقيع") +
        sigHtml("", "ختم المدرسة", "الرسمي") +
      "</div>" +
    "</article>";
  }

  function renderSheets() {
    var root = document.getElementById("sheets");
    if (!root) return;
    var cfg = state.config;
    var list = state.printAll ? state.classes : [currentClass()].filter(Boolean);
    if (!list.length) {
      root.innerHTML = '<div class="empty-state">No classes yet. Open the Admin Panel and add a class.</div>';
      return;
    }
    root.innerHTML = list.map(function (c) { return sheetHtml(c, cfg); }).join("");
  }

  function renderPills() {
    var wrap = document.getElementById("classPills");
    var sel = document.getElementById("classSelect");
    if (!wrap || !sel) return;
    wrap.innerHTML = "";
    sel.innerHTML = "";
    state.classes.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pill" + (c.id === state.currentId ? " on" : "");
      b.textContent = c.name;
      b.addEventListener("click", function () { selectClass(c.id); });
      wrap.appendChild(b);

      var opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id === state.currentId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderAdminList() {
    var list = document.getElementById("adminList");
    if (!list) return;
    list.innerHTML = "";
    state.classes.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = c.id === state.currentId ? "on" : "";
      b.textContent = c.name;
      b.addEventListener("click", function () { selectClass(c.id); });
      list.appendChild(b);
    });
  }

  function renderAdminEditor() {
    var cls = currentClass();
    var nameInput = document.getElementById("classNameInput");
    var termInput = document.getElementById("termInput");
    var breakTimeInput = document.getElementById("breakTimeInput");
    if (nameInput) nameInput.value = cls ? cls.name : "";
    if (termInput) termInput.value = state.config.term || "";
    if (breakTimeInput) breakTimeInput.value = state.config.breakTime || "";

    var morningHost = document.getElementById("adminMorning");
    var eveningHost = document.getElementById("adminEvening");
    if (!cls || !morningHost || !eveningHost) return;

    morningHost.innerHTML = buildEditTable("morning", cls, state.config.morningDays, state.config.morningPeriods);
    eveningHost.innerHTML = buildEditTable("evening", cls, state.config.eveningDays, state.config.eveningSlots);

    morningHost.querySelectorAll("input").forEach(bindCell);
    eveningHost.querySelectorAll("input").forEach(bindCell);
  }

  function buildEditTable(kind, cls, days, periods) {
    var html = '<table class="edit-table"><thead><tr><th>Period</th><th>Time</th>';
    days.forEach(function (d) { html += "<th>" + esc(d.label) + "</th>"; });
    html += "</tr></thead><tbody>";
    periods.forEach(function (p, i) {
      html += "<tr><td>" + p.n + "</td><td>" +
        '<input data-kind="time" data-section="' + kind + '" data-index="' + i + '" value="' + esc(p.time) + '">' +
        "</td>";
      days.forEach(function (d) {
        var bag = kind === "morning" ? cls.morning : cls.evening;
        var list = pad(bag && bag[d.key], periods.length);
        html += "<td><input data-kind=\"subject\" data-section=\"" + kind +
          "\" data-day=\"" + d.key + "\" data-index=\"" + i +
          "\" value=\"" + esc(list[i]) + "\"></td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }

  function bindCell(input) {
    input.addEventListener("input", function () {
      var cls = currentClass();
      if (!cls) return;
      var kind = input.getAttribute("data-kind");
      var section = input.getAttribute("data-section");
      var idx = Number(input.getAttribute("data-index"));
      var val = input.value;

      if (kind === "time") {
        var arr = section === "morning" ? state.config.morningPeriods : state.config.eveningSlots;
        if (arr[idx]) arr[idx].time = val;
      } else {
        var bag = section === "morning" ? cls.morning : cls.evening;
        var day = input.getAttribute("data-day");
        var n = section === "morning" ? 6 : 2;
        bag[day] = pad(bag[day], n);
        bag[day][idx] = val;
      }
      save();
      renderSheets();
    });
  }

  function selectClass(id) {
    state.currentId = id;
    state.printAll = false;
    save();
    try {
      history.replaceState(null, "", "?id=" + encodeURIComponent(id));
    } catch (e) {}
    refresh();
  }

  function refresh() {
    if (!state.classes.length) {
      state.classes = [emptyClass("New Class")];
      state.currentId = state.classes[0].id;
    }
    if (!state.classes.some(function (c) { return c.id === state.currentId; })) {
      state.currentId = state.classes[0].id;
    }
    renderPills();
    renderAdminList();
    renderAdminEditor();
    renderSheets();
    renderExistingPicker();
    applyOrientation();
    document.title = (currentClass() ? currentClass().name + " · " : "") +
      "Class Timetable | Ameenullah School";
  }

  function addClass() {
    var name = (document.getElementById("newClassName") || {}).value;
    name = String(name || "").trim() || "New Class";
    var cls = emptyClass(name);
    state.classes.push(cls);
    state.currentId = cls.id;
    var field = document.getElementById("newClassName");
    if (field) field.value = "";
    save();
    refresh();
    toast("Class added: " + name);
  }

  function deleteClass() {
    var cls = currentClass();
    if (!cls) return;
    if (state.classes.length === 1) {
      toast("At least one class must remain.");
      return;
    }
    if (!confirm("Delete the timetable for \"" + cls.name + "\"?")) return;
    state.classes = state.classes.filter(function (c) { return c.id !== cls.id; });
    state.currentId = state.classes[0].id;
    save();
    refresh();
    toast("Class deleted.");
  }

  function duplicateClass() {
    var cls = currentClass();
    if (!cls) return;
    var copy = clone(cls);
    copy.id = uid();
    copy.name = cls.name + " (Copy)";
    state.classes.push(copy);
    state.currentId = copy.id;
    save();
    refresh();
    toast("Class duplicated.");
  }

  /* ---------- Fit to exactly one A4 page ---------- */

  /* The sheet is laid out at the real printable page width and then
     measured: if it is taller than the printable height, it is zoomed
     down (never up, never below 60 %) just enough to fit. Landscape
     therefore always prints on a single A4 page instead of spilling
     onto a second one. `zoom` is a layout-level zoom, so the printer
     sees the scaled box too; browsers that do not support it simply
     print the (already compacted) sheet as before. */
  function ttPageBox(orientation) {
    var landscape = orientation === "landscape";
    // A4 minus the 8 mm @page margins on every side.
    return { w: (landscape ? 297 : 210) - 16, h: (landscape ? 210 : 297) - 16 };
  }

  function ttPxPerMm() {
    var probe = document.createElement("div");
    probe.style.cssText = "position:absolute;left:-100000px;top:0;width:100mm;height:1mm;";
    document.body.appendChild(probe);
    var w = probe.getBoundingClientRect().width;
    if (probe.parentNode) probe.parentNode.removeChild(probe);
    return w > 0 ? w / 100 : 0;
  }

  /* Returns the list of sheets that were zoomed, so the zoom can be
     cleared again once the print dialog is closed. */
  function ttFitSheets(sheets) {
    var pxPerMm = ttPxPerMm();
    if (!pxPerMm) return [];
    var box = ttPageBox(state.orientation);
    var availW = box.w * pxPerMm;
    var availH = box.h * pxPerMm;
    var zoomed = [];
    Array.prototype.forEach.call(sheets || [], function (sheet) {
      sheet.style.zoom = "";
      var prevWidth = sheet.style.width;
      sheet.style.width = availW + "px";
      var h = sheet.getBoundingClientRect().height;
      sheet.style.width = prevWidth;
      if (h > availH + 1) {
        var k = availH / h;
        if (k < 1 && k > 0.6) {
          sheet.style.zoom = String(k);
          zoomed.push(sheet);
        }
      }
    });
    return zoomed;
  }

  function ttClearFit(sheets) {
    Array.prototype.forEach.call(sheets || [], function (sheet) {
      sheet.style.zoom = "";
      sheet.style.width = "";
    });
  }

  function ttPrint(all) {
    state.printAll = !!all;
    applyOrientation();
    renderSheets();
    document.body.classList.toggle("print-all", !!all);

    var sheets = document.querySelectorAll("#sheets .sheet");
    var fire = function () {
      ttFitSheets(sheets);
      setTimeout(function () { window.print(); }, 40);
    };

    // The Arabic web fonts change the text metrics — wait for them,
    // but never block the print dialog on a slow font load.
    if (document.fonts && document.fonts.ready) {
      var fired = false;
      var go = function () { if (!fired) { fired = true; fire(); } };
      try { document.fonts.ready.then(go, go); } catch (e) { go(); }
      setTimeout(go, 1200);
    } else {
      fire();
    }
  }

  function printOne() {
    ttPrint(false);
  }

  function printAll() {
    ttPrint(true);
  }

  function onPrinted() {
    state.printAll = false;
    document.body.classList.remove("print-all");
    ttClearFit(document.querySelectorAll("#sheets .sheet"));
    renderSheets();
  }

  /* ---------- PDF download (Download PDF / Download All) ---------- */

  var ttBusy = false;

  /* Wait until every image inside the capture stage is loaded and the
     web fonts (Amiri / Cairo / Naskh) are ready, so Arabic renders
     correctly in the exported PDF. */
  function ttWaitAssets(node) {
    var imgs = Array.prototype.slice.call(node.querySelectorAll("img"));
    return Promise.all(imgs.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (res) {
        img.onload = res;
        img.onerror = res;
        setTimeout(res, 4000);
      });
    })).then(function () {
      if (document.fonts && document.fonts.ready) {
        return document.fonts.ready.catch(function () { /* font load failed — fall back */ });
      }
      return Promise.resolve();
    });
  }

  /* Capture one .sheet element into a JPEG data URL (same pattern the
     certificate / calendar downloads use), with a blank-canvas guard. */
  function ttCaptureSheet(sheetEl) {
    return html2canvas(sheetEl, { scale: 2, backgroundColor: "#ffffff", useCORS: true })
      .then(function (canvas) {
        try {
          var probe = document.createElement("canvas");
          probe.width = 40;
          probe.height = 40;
          var cx = probe.getContext("2d");
          cx.drawImage(canvas, 0, 0, 40, 40);
          var d = cx.getImageData(0, 0, 40, 40).data;
          var ink = 0;
          for (var i = 0; i < d.length; i += 4) {
            if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) ink++;
          }
          if (ink < 6) return null;
        } catch (e) { /* keep going */ }
        return {
          url: canvas.toDataURL("image/jpeg", 0.93),
          width: canvas.width,
          height: canvas.height
        };
      });
  }

  /* Render every requested sheet into an invisible fixed-width stage
     (A4 portrait or landscape, matching the print layout), then capture
     them one by one. */
  function ttCaptureSheets(list) {
    var landscape = state.orientation === "landscape";
    var stage = document.createElement("div");
    stage.className = "tt-capture";
    stage.style.width = (landscape ? 1123 : 794) + "px";
    stage.innerHTML = list.map(function (c) { return sheetHtml(c, state.config); }).join("");
    document.body.appendChild(stage);
    return ttWaitAssets(stage)
      .then(function () {
        var sheets = Array.prototype.slice.call(stage.querySelectorAll(".sheet"));
        var shots = [];
        return sheets.reduce(function (chain, el) {
          return chain.then(function () {
            return ttCaptureSheet(el).then(function (shot) {
              if (shot) shots.push(shot);
            });
          });
        }, Promise.resolve()).then(function () {
          document.body.removeChild(stage);
          return shots;
        });
      })
      .catch(function () {
        if (stage.parentNode) stage.parentNode.removeChild(stage);
        return [];
      });
  }

  /* Build the actual A4 PDF (one page per class, centered, never
     cropped or stretched) and save it. */
  function ttDownloadPdf(all) {
    if (ttBusy) return;
    if (!window.jspdf || !window.html2canvas) {
      toast("PDF generator is loading — try again in a moment.");
      return;
    }
    var list = all ? state.classes.slice() : [currentClass()].filter(Boolean);
    if (!list.length) {
      toast("No classes to download yet.");
      return;
    }
    ttBusy = true;
    var btn = document.getElementById(all ? "downloadAllBtn" : "downloadBtn");
    if (btn) btn.disabled = true;
    toast(all ? "Building PDF for all classes…" : "Building timetable PDF…");

    ttCaptureSheets(list).then(function (shots) {
      if (!shots.length) {
        toast("Could not build the PDF — try again.");
        return;
      }
      var landscape = state.orientation === "landscape";
      var pdf = new window.jspdf.jsPDF({
        orientation: landscape ? "landscape" : "portrait",
        unit: "mm",
        format: "a4"
      });
      var pageW = landscape ? 297 : 210;
      var pageH = landscape ? 210 : 297;
      var margin = 8; // mm — same margin as the printed page
      var availW = pageW - margin * 2;
      var availH = pageH - margin * 2;
      shots.forEach(function (shot, i) {
        if (i > 0) pdf.addPage("a4", landscape ? "landscape" : "portrait");
        var ratio = shot.width > 0 ? shot.height / shot.width : 1;
        var fitW = availW;
        var fitH = fitW * ratio;
        if (fitH > availH) {
          fitH = availH;
          fitW = fitH / ratio;
        }
        var fmt = /^data:image\/png/i.test(shot.url) ? "PNG" : "JPEG";
        pdf.addImage(shot.url, fmt, (pageW - fitW) / 2, (pageH - fitH) / 2, fitW, fitH);
      });
      var base = all ? "all-classes" : String(currentClass() ? currentClass().name : "class");
      var safe = base.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "timetable";
      pdf.save("timetable-" + safe + "-" + (landscape ? "landscape" : "portrait") + ".pdf");
      toast("Timetable PDF downloaded ✓ (" + shots.length + " page" + (shots.length > 1 ? "s" : "") + ")");
    }).catch(function (e) {
      console.log("ttDownloadPdf error:", e);
      toast("Could not build the PDF — try again.");
    }).then(function () {
      ttBusy = false;
      if (btn) btn.disabled = false;
    });
  }

  function toggleAdmin() {
    document.body.classList.toggle("admin-open");
    var on = document.body.classList.contains("admin-open");
    var btn = document.getElementById("adminToggle");
    if (btn) btn.textContent = on ? "Close Admin" : "Admin Panel";
  }

  function bind() {
    var sel = document.getElementById("classSelect");
    if (sel) sel.addEventListener("change", function () { selectClass(sel.value); });

    var orient = document.getElementById("orientationSelect");
    if (orient) orient.addEventListener("change", function () {
      state.orientation = orient.value === "landscape" ? "landscape" : "portrait";
      save();
      applyOrientation();
      toast(state.orientation === "landscape" ? "Landscape preview — prints on A4 landscape." : "Portrait preview — prints on A4 portrait.");
    });

    var nameInput = document.getElementById("classNameInput");
    if (nameInput) {
      nameInput.addEventListener("input", function () {
        var cls = currentClass();
        if (!cls) return;
        cls.name = nameInput.value;
        save();
        renderPills();
        renderAdminList();
        renderSheets();
      });
    }

    var termInput = document.getElementById("termInput");
    if (termInput) {
      termInput.addEventListener("input", function () {
        state.config.term = termInput.value;
        save();
        renderSheets();
      });
    }

    var breakTimeInput = document.getElementById("breakTimeInput");
    if (breakTimeInput) {
      breakTimeInput.addEventListener("input", function () {
        state.config.breakTime = breakTimeInput.value;
        save();
        renderSheets();
      });
    }

    var addBtn = document.getElementById("addClassBtn");
    if (addBtn) addBtn.addEventListener("click", addClass);
    var newName = document.getElementById("newClassName");
    if (newName) newName.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addClass(); }
    });

    var addExistingBtn = document.getElementById("addExistingBtn");
    if (addExistingBtn) addExistingBtn.addEventListener("click", addExistingClass);

    var delBtn = document.getElementById("deleteClassBtn");
    if (delBtn) delBtn.addEventListener("click", deleteClass);
    var dupBtn = document.getElementById("duplicateClassBtn");
    if (dupBtn) dupBtn.addEventListener("click", duplicateClass);
    var saveTimetableBtn = document.getElementById("saveTimetableBtn");
    if (saveTimetableBtn) saveTimetableBtn.addEventListener("click", saveShared);
    var adminBtn = document.getElementById("adminToggle");
    if (adminBtn) adminBtn.addEventListener("click", toggleAdmin);
    var printBtn = document.getElementById("printBtn");
    if (printBtn) printBtn.addEventListener("click", printOne);
    var printAllBtn = document.getElementById("printAllBtn");
    if (printAllBtn) printAllBtn.addEventListener("click", printAll);
    var downloadBtn = document.getElementById("downloadBtn");
    if (downloadBtn) downloadBtn.addEventListener("click", function () { ttDownloadPdf(false); });
    var downloadAllBtn = document.getElementById("downloadAllBtn");
    if (downloadAllBtn) downloadAllBtn.addEventListener("click", function () { ttDownloadPdf(true); });

    window.addEventListener("afterprint", onPrinted);
  }

  /* Read the school's saved official signatures (role -> image path) from
     the SAME endpoint the report cards and the term calendar already use,
     then re-draw the sheets so the Principal / Head Teacher images are
     stamped. Fails safe: logged out (401), offline, or no signature saved
     yet simply leaves the blank signing lines that were there before.
     Never touches, saves or reshapes any timetable data. */
  function fetchSignatures() {
    return fetch("/signatures", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var map = {};
        (Array.isArray(rows) ? rows : []).forEach(function (s) {
          if (s && s.role && s.signature_path) map[s.role] = String(s.signature_path);
        });
        state.signatures = map;
        state.sigStamp = String(Date.now());
        renderSheets();
      })
      .catch(function () { /* keep the blank signing lines */ });
  }

  function boot() {
    load();
    bind();
    loadShared().catch(function () {
      toast("Could not load the shared timetable; showing this device's saved copy.");
    }).then(function () {
      var params = new URLSearchParams(location.search);
      var qid = params.get("id");
      if (qid && state.classes.some(function (c) { return c.id === qid; })) state.currentId = qid;
      if (!state.currentId && state.classes[0]) state.currentId = state.classes[0].id;
      refresh();
      fetchSchoolClasses();
      fetchSignatures();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
