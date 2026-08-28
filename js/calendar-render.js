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

  /* ONE shared full-page PDF builder for the portal card, staff dashboard and admin studio.
     Renders the FULL letterhead sheet (never compact), preloads images, captures cleanly
     without screen drop-shadows, and fits proportionally onto an A4 page preserving aspect ratio. */
  window.amsCalendarPDF = function (data, sigMap, done, filename) {
    if (!window.html2canvas || !window.jspdf) {
      alert("PDF generator is still loading - try again in a moment.");
      if (done) done();
      return;
    }

    var stage = document.createElement("div");
    stage.style.cssText = "position:fixed; left:-10000px; top:0; width:190mm; background:#ffffff; padding:0; margin:0;";

    var sheet = amsBuildCalendarSheet(data, sigMap); // FULL letterhead
    // Strip web drop-shadows and ensure clean 190mm width for A4 PDF capture
    sheet.style.boxShadow = "none";
    sheet.style.margin = "0";
    sheet.style.width = "190mm";
    sheet.style.maxWidth = "100%";
    sheet.style.border = "1px solid #C9A227";
    sheet.style.boxSizing = "border-box";

    stage.appendChild(sheet);
    document.body.appendChild(stage);

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
      var pageW = 595.28; // A4 width pt (210mm)
      var pageH = 841.89; // A4 height pt (297mm)
      var margin = 14;    // 14pt (~5mm) margin

      var maxW = pageW - margin * 2; // 567.28 pt
      var maxH = pageH - margin * 2; // 813.89 pt

      var canvasW = canvas.width;
      var canvasH = canvas.height;

      // Calculate height at full printable width
      var naturalH = (canvasH * maxW) / canvasW;

      var imgW, imgH, x, y;

      if (naturalH <= maxH) {
        // Fits comfortably on single A4 page with natural aspect ratio preserved
        imgW = maxW;
        imgH = naturalH;
        x = margin;
        y = Math.max(margin, (pageH - imgH) / 2); // Vertically centered
      } else {
        // Slightly taller than page; scale down proportionally so it fits on 1 page without clipping
        var scale = Math.min(maxW / canvasW, maxH / canvasH);
        imgW = canvasW * scale;
        imgH = canvasH * scale;
        x = (pageW - imgW) / 2;
        y = (pageH - imgH) / 2;
      }

      pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", x, y, imgW, imgH);
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
