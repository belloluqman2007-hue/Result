/* ============================================================
   Ameenullah School — Arabic timetable
   All class data lives in DEFAULT_CLASSES so extra classes can
   be added in code, or unlimited classes can be created from
   the on-screen admin panel (saved in localStorage).
   ============================================================ */
(function () {
  "use strict";

  var STORAGE_KEY = "ams-arabic-timetables-v1";

  var DEFAULT_CONFIG = {
    bismillah: "بسم الله الرحمن الرحيم",
    school: "مدرسة أمين الله للعلوم العربية الإسلامية",
    motto: "شعبة العلم والعبادة",
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
    breakAfter: 2,
    breakLabel: "فسحة"
  };

  /* ---- Sample data: add more objects here for extra classes ---- */
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
    printAll: false
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

  function emptyClass(name) {
    var morning = {};
    var evening = {};
    DEFAULT_CONFIG.morningDays.forEach(function (d) {
      morning[d.key] = ["", "", "", "", "", ""];
    });
    DEFAULT_CONFIG.eveningDays.forEach(function (d) {
      evening[d.key] = ["", ""];
    });
    return { id: uid(), name: name || "فصل جديد", morning: morning, evening: evening };
  }

  function pad(arr, n) {
    var out = Array.isArray(arr) ? arr.slice() : [];
    while (out.length < n) out.push("");
    return out.slice(0, n);
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.classes) && data.classes.length) {
        state.classes = data.classes;
      }
      if (data && data.config) {
        state.config = Object.assign(clone(DEFAULT_CONFIG), data.config);
      }
      if (data && data.currentId) state.currentId = data.currentId;
    } catch (e) { /* private mode / corrupt storage */ }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        classes: state.classes,
        config: state.config,
        currentId: state.currentId
      }));
    } catch (e) { /* quota */ }
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

  function letterheadHtml(cfg) {
    return '<div class="letterhead">' +
      '<img class="bismillah-img" src="images/bismillah.png" alt="' + esc(cfg.bismillah) + '" ' +
        'onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'block\'">' +
      '<p class="bismillah-text" style="display:none">' + esc(cfg.bismillah) + "</p>" +
      '<div class="letter-row">' +
        '<img class="crest" src="images/LOGO.JPG" alt="شعار المدرسة">' +
        '<div class="letter-names">' +
          '<h2 class="school-ar">' + esc(cfg.school) + "</h2>" +
          '<p class="motto">' + esc(cfg.motto) + "</p>" +
          '<div class="term-line">' + esc(cfg.term) + "</div>" +
        "</div>" +
        '<img class="crest" src="images/LOGO.JPG" alt="">' +
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

    cfg.morningPeriods.forEach(function (p, i) {
      if (cfg.breakAfter && i === cfg.breakAfter) {
        html += '<tr class="break-row"><td colspan="' + (2 + days.length) + '">' +
          esc(cfg.breakLabel) + "</td></tr>";
      }
      html += '<tr><td class="num">' + p.n + '</td><td class="time">' + esc(p.time) + "</td>";
      days.forEach(function (d) {
        var list = pad(cls.morning && cls.morning[d.key], cfg.morningPeriods.length);
        html += "<td>" + cellText(list[i]) + "</td>";
      });
      html += "</tr>";
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

  function sheetHtml(cls, cfg) {
    return '<article class="sheet" data-class-id="' + esc(cls.id) + '">' +
      cornerSvg() +
      '<div class="watermark"></div>' +
      letterheadHtml(cfg) +
      '<div class="class-banner">الصف: ' + esc(cls.name) +
        "<small>معرفة وعبادة · Knowledge and Worship</small></div>" +
      morningTable(cls, cfg) +
      eveningTable(cls, cfg) +
      '<div class="sheet-foot">' +
        '<div class="sig"><div class="line"></div><b>مدير المدرسة</b>التوقيع</div>' +
        '<div class="sig"><div class="line"></div><b>ختم المدرسة</b>الرسمي</div>' +
      "</div>" +
    "</article>";
  }

  function renderSheets() {
    var root = document.getElementById("sheets");
    if (!root) return;
    var cfg = state.config;
    var list = state.printAll ? state.classes : [currentClass()].filter(Boolean);
    if (!list.length) {
      root.innerHTML = '<div class="empty-state">لا توجد فصول بعد. افتح لوحة الإدارة وأضف فصلاً.</div>';
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
    if (nameInput) nameInput.value = cls ? cls.name : "";
    if (termInput) termInput.value = state.config.term || "";

    var morningHost = document.getElementById("adminMorning");
    var eveningHost = document.getElementById("adminEvening");
    if (!cls || !morningHost || !eveningHost) return;

    morningHost.innerHTML = buildEditTable("morning", cls, state.config.morningDays, state.config.morningPeriods);
    eveningHost.innerHTML = buildEditTable("evening", cls, state.config.eveningDays, state.config.eveningSlots);

    morningHost.querySelectorAll("input").forEach(bindCell);
    eveningHost.querySelectorAll("input").forEach(bindCell);
  }

  function buildEditTable(kind, cls, days, periods) {
    var html = '<table class="edit-table"><thead><tr><th>الحصة</th><th>الوقت</th>';
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
      state.classes = [emptyClass("فصل جديد")];
      state.currentId = state.classes[0].id;
    }
    if (!state.classes.some(function (c) { return c.id === state.currentId; })) {
      state.currentId = state.classes[0].id;
    }
    renderPills();
    renderAdminList();
    renderAdminEditor();
    renderSheets();
    document.title = (currentClass() ? currentClass().name + " · " : "") +
      "الجدول الدراسي | مدرسة أمين الله";
  }

  function addClass() {
    var name = (document.getElementById("newClassName") || {}).value;
    name = String(name || "").trim() || "فصل جديد";
    var cls = emptyClass(name);
    state.classes.push(cls);
    state.currentId = cls.id;
    var field = document.getElementById("newClassName");
    if (field) field.value = "";
    save();
    refresh();
    toast("تمت إضافة الفصل: " + name);
  }

  function deleteClass() {
    var cls = currentClass();
    if (!cls) return;
    if (state.classes.length === 1) {
      toast("يجب أن يبقى فصل واحد على الأقل");
      return;
    }
    if (!confirm("حذف جدول «" + cls.name + "»؟")) return;
    state.classes = state.classes.filter(function (c) { return c.id !== cls.id; });
    state.currentId = state.classes[0].id;
    save();
    refresh();
    toast("تم حذف الفصل");
  }

  function duplicateClass() {
    var cls = currentClass();
    if (!cls) return;
    var copy = clone(cls);
    copy.id = uid();
    copy.name = cls.name + " (نسخة)";
    state.classes.push(copy);
    state.currentId = copy.id;
    save();
    refresh();
    toast("تم نسخ الفصل");
  }

  function resetSample() {
    if (!confirm("إعادة الجداول إلى البيانات النموذجية؟ ستُحذف الفصول المضافة.")) return;
    state.config = clone(DEFAULT_CONFIG);
    state.classes = clone(DEFAULT_CLASSES);
    state.currentId = state.classes[0].id;
    save();
    refresh();
    toast("تمت استعادة البيانات النموذجية");
  }

  function printOne() {
    state.printAll = false;
    renderSheets();
    document.body.classList.remove("print-all");
    setTimeout(function () { window.print(); }, 50);
  }

  function printAll() {
    state.printAll = true;
    renderSheets();
    document.body.classList.add("print-all");
    setTimeout(function () { window.print(); }, 50);
  }

  function onPrinted() {
    state.printAll = false;
    document.body.classList.remove("print-all");
    renderSheets();
  }

  function toggleAdmin() {
    document.body.classList.toggle("admin-open");
    var on = document.body.classList.contains("admin-open");
    var btn = document.getElementById("adminToggle");
    if (btn) btn.textContent = on ? "إغلاق الإدارة" : "لوحة الإدارة";
  }

  function bind() {
    var sel = document.getElementById("classSelect");
    if (sel) sel.addEventListener("change", function () { selectClass(sel.value); });

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

    var addBtn = document.getElementById("addClassBtn");
    if (addBtn) addBtn.addEventListener("click", addClass);
    var newName = document.getElementById("newClassName");
    if (newName) newName.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addClass(); }
    });

    var delBtn = document.getElementById("deleteClassBtn");
    if (delBtn) delBtn.addEventListener("click", deleteClass);
    var dupBtn = document.getElementById("duplicateClassBtn");
    if (dupBtn) dupBtn.addEventListener("click", duplicateClass);
    var resetBtn = document.getElementById("resetBtn");
    if (resetBtn) resetBtn.addEventListener("click", resetSample);
    var adminBtn = document.getElementById("adminToggle");
    if (adminBtn) adminBtn.addEventListener("click", toggleAdmin);
    var printBtn = document.getElementById("printBtn");
    if (printBtn) printBtn.addEventListener("click", printOne);
    var printAllBtn = document.getElementById("printAllBtn");
    if (printAllBtn) printAllBtn.addEventListener("click", printAll);

    window.addEventListener("afterprint", onPrinted);
  }

  function boot() {
    load();
    var params = new URLSearchParams(location.search);
    var qid = params.get("id");
    if (qid && state.classes.some(function (c) { return c.id === qid; })) {
      state.currentId = qid;
    }
    if (!state.currentId && state.classes[0]) state.currentId = state.classes[0].id;
    bind();
    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
