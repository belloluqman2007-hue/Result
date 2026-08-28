/* ==========================================================================
   NEW FILE (pack 15) - js/calendar-render.js
   Shared renderer for the MADRASAH TERM CALENDAR. It builds the SAME
   letterhead design as the school's printed calendar (logo, Arabic name,
   black name band, refs row, weeks/activities table, note row, lesson
   times, two signatures, bottom band) as an HTML sheet styled like the
   paper. Used by the admin editor (manage-calendars.html) and by the
   Student/Parent portal (read-only). Additive - touches no other module.
   ========================================================================== */
(function () {
  "use strict";

  var SCHOOL = {
    name: "AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES",
    nameAr: "مدرسة أمين اللّه للعلوم العربيّة الإسلاميّة",
    address: "3, Temidire Street Off Ondo Benin Road, Ijebu-Ode, Ogun State, Nigeria.",
    tel: "Tel: 08062445559, 08058306889.",
    email: "Email: madrasatuameenillah22@gmail.com",
    motto: "MOTTO: KNOWLEDGE AND WORSHIP",
    mottoAr: ":الشِّعار الْعِلْمُ وَالْعِبَادَة"
  };

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* sigMap: { roleName: signature_path } e.g. { head_teacher: "images/signatures/head_teacher.png" }
     CHANGED (pack 17 - owner request): optional third arg `opts`.
     opts.compact = true adds the .cal-compact class: on SCREEN the big
     letterhead (logo/bismillah/name band/contacts/motto), the refs row
     and the bottom band are hidden (css, screen-only) so parents and
     teachers see a SHORT, tidy calendar. The PDF/download keeps the FULL
     letterhead automatically (amsCalendarPDF always builds a full sheet). */
  window.amsBuildCalendarSheet = function (data, sigMap, opts) {
    data = data || {};
    sigMap = sigMap || {};
    opts = opts || {};

    var rows = Array.isArray(data.rows) ? data.rows : [];
    var lessons = Array.isArray(data.lessons) ? data.lessons : [];

    var sheet = document.createElement("div");
    sheet.className = "cal-sheet" + (opts.compact ? " cal-compact" : "");

    /* ---------- letterhead frame: four gold corner accents ----------
       NEW (A4 fix pack): decorative only - absolutely positioned, they
       take part in no flow so the sheet height is unchanged. */
    ["tl", "tr", "bl", "br"].forEach(function (p) {
      var corner = document.createElement("span");
      corner.className = "cal-corner cal-corner-" + p;
      sheet.appendChild(corner);
    });

    /* ---------- header ---------- */
    var head = document.createElement("div");
    head.className = "cal-head";
    head.innerHTML =
      '<img class="cal-logo" src="images/LOGO.JPG" alt="School Logo">' +
      '<div class="cal-head-text">' +
        '<img class="cal-bismillah" src="images/bismillah.png" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="cal-name-ar" lang="ar">' + esc(SCHOOL.nameAr) + "</div>" +
        '<div class="cal-name-band">' + esc(SCHOOL.name) + "</div>" +
        '<div class="cal-contact">' + esc(SCHOOL.address) + "<br>" + esc(SCHOOL.tel) + "<br>" + esc(SCHOOL.email) + "</div>" +
        '<div class="cal-motto"><b>' + esc(SCHOOL.motto) + '</b> <span lang="ar">' + esc(SCHOOL.mottoAr) + "</span></div>" +
      "</div>";
    sheet.appendChild(head);

    /* ---------- letterhead rule: emerald + gold double rule ---------- */
    var rule = document.createElement("div");
    rule.className = "cal-head-rule";
    rule.innerHTML = '<span class="cal-head-diamond"></span>';
    sheet.appendChild(rule);

    /* ---------- refs ---------- */
    var refs = document.createElement("div");
    refs.className = "cal-refs";
    refs.innerHTML =
      '<span>Our Ref: ' + esc(data.our_ref || "") + "</span>" +
      '<span>Your Ref: ' + esc(data.your_ref || "") + "</span>" +
      '<span><b>Date:</b> ' + esc(data.doc_date || "") + "</span>";
    sheet.appendChild(refs);

    /* ---------- title ---------- */
    var title = document.createElement("div");
    title.className = "cal-title";
    title.textContent = data.title_line || "";
    sheet.appendChild(title);

    /* ---------- weeks table ---------- */
    var tbl = document.createElement("table");
    tbl.className = "cal-table";
    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th class=\"w\">WEEKS</th><th>" + esc(data.weeks_col || "(14 WEEKS) ACTIVITIES") + "</th><th class=\"d\">DATES</th></tr>";
    tbl.appendChild(thead);
    var tbody = document.createElement("tbody");
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      var dateCell = [r.days, r.date].filter(Boolean).join(" ");
      tr.innerHTML = "<td class=\"w\">" + esc(r.w) + "</td><td>" + esc(r.act) + "</td><td class=\"d\">" + esc(dateCell) + "</td>";
      tbody.appendChild(tr);
    });
    // note row (new session begins)
    var ntr = document.createElement("tr");
    ntr.className = "cal-note-row";
    var noteDate = [data.note_days, data.note_date].filter(Boolean).join(" ");
    ntr.innerHTML = "<td class=\"w\"></td><td><b>" + esc(data.note_label || "") + "</b></td><td class=\"d\"><b>" + esc(noteDate) + "</b></td>";
    tbody.appendChild(ntr);
    tbl.appendChild(tbody);
    sheet.appendChild(tbl);

    /* ---------- lesson times ---------- */
    if (lessons.length || data.lessons_title) {
      var lt = document.createElement("div");
      lt.className = "cal-lessons";
      lt.innerHTML = "<div class=\"cal-lessons-title\">" + esc(data.lessons_title || "LESSON TIMES AND HOURS:") + "</div>";
      lessons.forEach(function (l) {
        var row = document.createElement("div");
        row.className = "cal-lesson-row";
        row.innerHTML = "<span>* " + esc(l.text) + "</span><b>" + esc(l.time) + "</b>";
        lt.appendChild(row);
      });
      sheet.appendChild(lt);
    }

    /* ---------- signatures ---------- */
    var sigs = document.createElement("div");
    sigs.className = "cal-sigs";
    [["sig1", data.sig1_role, data.sig1_title], ["sig2", data.sig2_role, data.sig2_title]].forEach(function (cfg) {
      var role = cfg[1], title = cfg[2] || "";
      var box = document.createElement("div");
      box.className = "cal-sig-box";
      var sigPath = role && sigMap[role] ? sigMap[role] : null;
      box.innerHTML =
        (sigPath ? '<img class="cal-sig-img" src="' + esc(sigPath) + '" alt="">' : '<span class="cal-sig-blank"></span>') +
        '<div class="cal-sig-line"></div>' +
        '<div class="cal-sig-title"><b>' + esc(title) + "</b></div>";
      sigs.appendChild(box);
    });
    sheet.appendChild(sigs);

    /* ---------- bottom band ---------- */
    var band = document.createElement("div");
    band.className = "cal-bottom-band";
    sheet.appendChild(band);

    return sheet;
  };

  /* Default content = the school's real First Term calendar (from the
     paper photo the owner supplied) so the admin only edits dates. */
  window.amsDefaultCalendarDoc = function () {
    return {
      our_ref: "", your_ref: "", doc_date: "02/05/2026",
      title_line: "FIRST TERM MADRASAH CALENDAR 2026/1447 ACADEMIC SESSION (JANUARY-MAY)",
      weeks_col: "(14 WEEKS) ACTIVITIES",
      rows: [
        { w: "1a.", act: "STUDENTS' RESUMPTION / WELCOME TEST", days: "SATURDAY", date: "02/05/2026" },
        { w: "1b.", act: "SUBMISSION OF LESSON PLAN AND STAFF MEETING", days: "SATURDAY", date: "02/05/2026" },
        { w: "2.", act: "SUBMISSION OF FIRST TERMLY TEST QUESTIONS", days: "SATURDAY", date: "09/05/2026" },
        { w: "4a.", act: "FIRST TERMLY TEST", days: "SAT-TUE", date: "23-26/05/2026" },
        { w: "4b.", act: "ILEYA BREAK (IN ASSUMPTION)", days: "WED-FRI", date: "27-29/06/2026" },
        { w: "7.", act: "SUBMISSION OF SECOND TERMLY TEST QUESTIONS", days: "SATURDAY", date: "13-17/06/2026" },
        { w: "8.", act: "SECOND TERMLY TEST", days: "SATURDAY", date: "20/06/2026" },
        { w: "9a.", act: "SUBMISSION OF NOTES.", days: "SATURDAY", date: "27/06/2026" },
        { w: "9b.", act: "SUBMISSION OF C.A SCORES", days: "SUNDAY", date: "28/06/2026" },
        { w: "10.", act: "REVISION", days: "SATURDAY", date: "04/07/2026" },
        { w: "11-12.", act: "EXAMINATION", days: "SAT-FRI", date: "11-24/07/2026" },
        { w: "14.", act: "COLLECTION OF REPORT SHEETS & STUDENTS VACATION", days: "SATURDAY", date: "01/08/2026" }
      ],
      note_label: "INSHA-ALLAH NEW ARABIC SESSION BEGINS ON:",
      note_days: "SATURDAY", note_date: "12/09/2026",
      lessons_title: "LESSON TIMES AND HOURS:",
      lessons: [
        { text: "SATURDAYS AND SUNDAYS", time: "08:00AM - TILL DHUHR TIME." },
        { text: "MONDAYS - WEDNESDAYS", time: "04:00PM - TILL SUNSET." },
        { text: "THURSDAYS, FRIDAYS & SATURDAYS EVENING FOR TAHFEEDHUL-QUR'AN ONLY. ALSO STARTS BY:", time: "04:00PM - TILL SUNSET." },
        { text: "SUNDAYS EVENING FOR WEEKLY LECTURE:", time: "04:30PM - TILL SUNSET." }
      ],
      sig1_role: "head_teacher", sig1_title: "THE HEAD TEACHER",
      sig2_role: "principal", sig2_title: "THE PROPRIETOR"
    };
  };

  /* Shared signature map fetch (roles -> paths). */
  window.amsFetchSignatureMap = function (cb) {
    fetch("/signatures").then(function (r) { return r.json(); }).then(function (rows) {
      var map = {};
      (Array.isArray(rows) ? rows : []).forEach(function (s) { map[s.role] = s.signature_path; });
      cb(map);
    }).catch(function () { cb({}); });
  };

  /* ==========================================================================
     ONE shared "fits on a single A4 page" helper.
     --------------------------------------------------------------------------
     A calendar with many week rows / lesson rows can grow taller than an A4
     page. This shrinks the rendered sheet until it fits, in two steps:

       1. TYPOGRAPHY  - step the sheet through .cal-dense / .cal-xdense, which
          tighten paddings, margins and font sizes only. Nothing is clipped and
          html2canvas still captures crisp text, so this is always tried first.
       2. SCALE       - if the content is STILL too tall, scale the whole sheet
          down. Preferred mechanism is CSS `zoom` (the same one the report card
          one-page fix uses) because it shrinks the layout box itself, so the
          page cannot grow; engines without zoom fall back to a transform plus
          an exactly-reserved wrapper height.

     Callers: the studio print preview (calFitPreview in js/calendar-editor.js,
     sizer = the preview wrapper) and the PDF builder (allowScale: false -
     html2canvas is unreliable with scaled elements, so the PDF relies on step 1
     inside a fixed A4 capture box plus jsPDF's own proportional fit).
     ========================================================================== */
  var CAL_PX_PER_MM = 96 / 25.4;

  window.amsFitCalendarSheet = function (sheet, opts) {
    var out = { scale: 1, density: "", mode: "none", naturalPx: 0, widthPx: 0, heightPx: 0 };
    if (!sheet) return out;
    opts = opts || {};

    var targetWpx = (opts.widthMm || 190) * CAL_PX_PER_MM;
    var targetHpx = (opts.heightMm || 281) * CAL_PX_PER_MM;
    var allowScale = opts.allowScale !== false;
    var levels = ["", " cal-dense", " cal-xdense"];

    /* "auto" prefers zoom (same mechanism the report card one-page fix uses -
       it shrinks the layout box itself, so the page cannot grow), and only
       falls back to transform + a reserved wrapper height on engines without
       zoom. "none" = typography steps only (that is what the PDF capture
       wants, because html2canvas and transforms do not mix). */
    var mode = opts.mode || "auto";
    if (mode === "auto") {
      mode = (typeof sheet.style.zoom === "string" || "zoom" in sheet.style) ? "zoom" : "transform";
    }
    if (!allowScale) mode = "none";

    /* keep whatever classes the caller set (cal-pdf / cal-printfit / cal-compact)
       and only swap the density step */
    var base = (" " + sheet.className + " ")
      .replace(/\s cal-dense\s/g, " ").replace(/\s cal-xdense\s/g, " ").trim();

    var sizer = opts.sizer || sheet.parentElement;

    var natural = 0;
    for (var i = 0; i < levels.length; i++) {
      sheet.className = base + levels[i];
      /* always measure UNSCALED, whatever a previous fit left behind */
      sheet.style.transform = "";
      sheet.style.zoom = "";
      if (sizer) sizer.style.height = "";
      /* scrollHeight reports the real content height even when the sheet has a
         fixed height + overflow:hidden (the PDF capture box). */
      natural = Math.max(sheet.scrollHeight || 0, sheet.offsetHeight || 0);
      /* No layout engine (headless DOM in a test) - leave the sheet alone
         rather than guessing and tightening it for nothing. */
      if (!natural) { sheet.className = base; out.density = ""; break; }
      out.density = levels[i].trim();
      if (natural <= targetHpx) break;
    }

    var scale = 1;
    if (natural > targetHpx && mode !== "none") {
      scale = Math.min(1, targetHpx / natural, targetWpx / Math.max(sheet.offsetWidth || 1, 1));
      if (mode === "zoom") {
        sheet.style.zoom = String(scale);
      } else {
        sheet.style.transform = "scale(" + scale.toFixed(4) + ")";
        sheet.style.transformOrigin = "top center";
        /* transform does not shrink the layout box, so reserve the scaled
           height on the wrapper: the printed page stops right here. */
        if (sizer && natural) sizer.style.height = Math.ceil(natural * scale) + "px";
      }
    }

    out.mode = mode;
    out.scale = scale;
    out.naturalPx = natural;
    out.widthPx = (sheet.offsetWidth || 0) * scale;
    out.heightPx = natural * scale;
    return out;
  };

  /* ONE shared full-page PDF builder for the portal card, staff dashboard and admin studio.
     Renders the FULL letterhead sheet (never compact) inside a FIXED A4-proportioned
     capture box, preloads images, captures cleanly without screen drop-shadows, and
     drops the result on ONE A4 page filling the printable area.

     A4 = 210 x 297 mm. With a 14pt (~4.9mm) margin the printable area is
     200.1 x 287.1 mm, so a 190mm-wide sheet is captured 272.6mm tall: exactly the
     same aspect ratio as the printable area, which is why the result always fills
     the page instead of leaving a short strip at the bottom. */
  window.amsCalendarPDF = function (data, sigMap, done, filename) {
    if (!window.html2canvas || !window.jspdf) {
      alert("PDF generator is still loading - try again in a moment.");
      if (done) done();
      return;
    }

    var SHEET_W_MM = 190;
    var SHEET_H_MM = 272.6;

    var stage = document.createElement("div");
    stage.style.cssText = "position:fixed; left:-10000px; top:0; width:" + SHEET_W_MM + "mm; background:#ffffff; padding:0; margin:0;";

    var sheet = amsBuildCalendarSheet(data, sigMap); // FULL letterhead
    /* .cal-pdf pins the DESKTOP letterhead layout (two signatures SIDE BY SIDE,
       lesson times on one line) whatever the phone screen width is - viewport
       media queries would otherwise restyle this off-screen copy. */
    sheet.className += " cal-pdf";
    sheet.style.width = SHEET_W_MM + "mm";
    sheet.style.height = SHEET_H_MM + "mm";
    sheet.style.maxWidth = "none";
    sheet.style.margin = "0";
    sheet.style.boxShadow = "none";
    sheet.style.border = "1px solid #C9A227";
    sheet.style.boxSizing = "border-box";
    sheet.style.overflow = "hidden";

    stage.appendChild(sheet);
    document.body.appendChild(stage);

    /* Shrink the typography until the content is inside the capture box, so
       nothing is clipped by overflow:hidden and nothing is squashed later. */
    window.amsFitCalendarSheet(sheet, {
      widthMm: SHEET_W_MM, heightMm: SHEET_H_MM, allowScale: false
    });

    function waitForImages(container) {
      var imgs = Array.from(container.querySelectorAll("img"));
      var promises = imgs.map(function (img) {
        if (img.complete && img.naturalWidth !== 0) {
          return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
        }
        return new Promise(function (resolve) {
          img.onload = resolve;
          img.onerror = resolve;
        });
      });
      return Promise.all(promises);
    }

    var fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();

    Promise.all([fontsReady, waitForImages(sheet)]).then(function () {
      return window.html2canvas(sheet, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false
      });
    }).then(function (canvas) {
      stage.remove();

      var pdf = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
      var pageW = pdf.internal.pageSize.getWidth();   // 595.28 pt
      var pageH = pdf.internal.pageSize.getHeight();  // 841.89 pt
      var margin = 14;                                // ~4.9mm

      var maxW = pageW - margin * 2;
      var maxH = pageH - margin * 2;

      /* ONE page, always: shrink to the printable area, never crop, never spill. */
      var scale = Math.min(maxW / canvas.width, maxH / canvas.height);
      var imgW = canvas.width * scale;
      var imgH = canvas.height * scale;

      pdf.addImage(
        canvas.toDataURL("image/jpeg", 0.96), "JPEG",
        (pageW - imgW) / 2, (pageH - imgH) / 2, imgW, imgH
      );
      pdf.save(filename || "school-calendar.pdf");
      if (done) done();
    }).catch(function (err) {
      stage.remove();
      console.error("Calendar PDF error:", err);
      alert("Could not build the PDF on this device.");
      if (done) done();
    });
  };
})();
