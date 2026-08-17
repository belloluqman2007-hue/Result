/* ==========================================================================
   js/ams-pdf.js  (REWRITTEN in pack 15)
   Shared PDF makers built with jsPDF's own text/line API (NO html2canvas),
   so every output is a clean, exact A4 on every phone and laptop.

   FIX (pack 15 - "let the download PDF display well"): jsPDF's built-in
   fonts cannot draw non-Latin text (e.g. ARABIC class names like
   الأوّل الثّانويّ - they printed as garbage). Every text now goes through
   amsText(): plain Latin text uses the crisp built-in font; anything
   non-Latin is rendered by the device's OWN Arabic font onto a tiny
   canvas and placed as an image - always correct on the user's device.

   Builders:
     - fee payment receipt (one payment)
     - payments list per student
     - fee statement (per fee TYPE: fee/paid/balance + totals)  [NEW]
     - attendance register (one class, one date)
     - attendance report (date range)
   Requires js/vendor/jspdf.umd.min.js first. Additive.
   ========================================================================== */
(function () {
  "use strict";

  var SCHOOL = {
    name: "AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES",
    address: "3, Temidire street, Off Ondo Road, Ijebu-Ode, Ogun State.",
    contact: "Tel: 08062445559, 08058306889  |  Email: madrasatuameenillah22@gmail.com",
    motto: "MOTTO: KNOWLEDGE AND WORSHIP"
  };

  function doc() { return new window.jspdf.jsPDF({ unit: "pt", format: "a4" }); }
  var W = 595, H = 842, M = 42; // A4 pt + margins

  function nairaText(n) {
    // "N150,000" (plain - jsPDF fonts have no Naira glyph)
    return "N" + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  /* NEW (pack 82): amount in words for the official receipt
     (e.g. 45000 -> "Forty Five Thousand Naira Only"). */
  function numberToWords(num) {
    var n = Math.round(Math.abs(Number(num) || 0));
    var ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
                "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
                "Seventeen", "Eighteen", "Nineteen"];
    var tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    function under100(x) {
      return x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
    }
    function under1000(x) {
      var h = Math.floor(x / 100), r = x % 100, s = "";
      if (h) s = ones[h] + " Hundred";
      if (r) s += (s ? " " : "") + under100(r);
      return s;
    }
    if (n === 0) return "Zero Naira Only";
    var parts = [];
    var scales = [[1000000000, "Billion"], [1000000, "Million"], [1000, "Thousand"]];
    for (var i = 0; i < scales.length; i++) {
      var v = scales[i][0];
      if (n >= v) {
        parts.push(under1000(Math.floor(n / v)) + " " + scales[i][1]);
        n = n % v;
      }
    }
    if (n) parts.push(under1000(n));
    return parts.join(" ") + " Naira Only";
  }

  /* True when the string has only characters jsPDF's fonts can draw. */
  function isLatin(s) { return !/[^\x00-\xFF]/.test(String(s == null ? "" : s)); }

  /* Draw ANY text safely. Latin: native (sharp). Non-Latin (Arabic...):
     painted by the device fonts on a canvas and inserted as an image. */
  function amsText(d, str, x, y, opts) {
    opts = opts || {};
    var s = String(str == null ? "-" : str);
    if (isLatin(s)) { d.text(s, x, y, opts); return; }
    var size = d.getFontSize();
    var bold = (d.getFont().fontStyle || "").indexOf("bold") >= 0 ? "bold " : "";
    var px = Math.ceil(size * 2.2); // 2.2x for crisp output
    var cv = document.createElement("canvas");
    var c0 = cv.getContext("2d");
    c0.font = bold + px + "px 'Amiri', Arial, sans-serif";
    var w = Math.ceil(c0.measureText(s).width) + 10;
    var h = Math.ceil(px * 1.45);
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    ctx.font = bold + px + "px 'Amiri', Arial, sans-serif";
    ctx.fillStyle = opts.color || "#000000";
    ctx.textBaseline = "middle";
    ctx.direction = /[\u0600-\u06FF]/.test(s) ? "rtl" : "ltr";
    ctx.fillText(s, 5, h / 2);
    var url = cv.toDataURL("image/png");
    var wPt = w / 2.2, hPt = h / 2.2;
    var ax = x;
    if (opts.align === "center") ax = x - wPt / 2;
    else if (opts.align === "right") ax = x - wPt;
    d.addImage(url, "PNG", ax, y - hPt * 0.72, wPt, hPt);
  }

  function header(d, title, subLines) {
    var y = M + 14;
    d.setDrawColor(15, 61, 46);
    d.setLineWidth(2);
    d.line(M, M, W - M, M);
    d.setFont("helvetica", "bold");
    d.setFontSize(13.5);
    d.setTextColor(15, 61, 46);
    d.text(SCHOOL.name, W / 2, y, { align: "center" });
    y += 14;
    d.setFont("helvetica", "normal");
    d.setFontSize(8.5);
    d.setTextColor(60, 60, 60);
    d.text(SCHOOL.address, W / 2, y, { align: "center" });
    y += 11;
    d.text(SCHOOL.contact, W / 2, y, { align: "center" });
    y += 11;
    d.text(SCHOOL.motto, W / 2, y, { align: "center" });
    y += 10;
    d.setLineWidth(0.8);
    d.line(M, y, W - M, y);
    y += 18;
    d.setFont("helvetica", "bold");
    d.setFontSize(12.5);
    d.setTextColor(0, 0, 0);
    d.text(title, W / 2, y, { align: "center" });
    y += 8;
    (subLines || []).forEach(function (line) {
      y += 11;
      d.setFont("helvetica", "normal");
      d.setFontSize(9.5);
      amsText(d, line, W / 2, y, { align: "center", color: "#000000" });
    });
    return y + 14;
  }

  function table(d, startY, cols, rows, fontSize) {
    fontSize = fontSize || 9;
    var totalW = cols.reduce(function (a, c) { return a + c.w; }, 0);
    var scale = (W - 2 * M) / totalW;
    var colX = [];
    var acc = M;
    cols.forEach(function (c) { colX.push(acc); acc += c.w * scale; });
    var rowH = Math.max(fontSize + 8, 15);

    function drawRow(y, cells, isHeader) {
      if (y + rowH > H - M - 30) {
        d.addPage();
        y = M;
        y = drawHeader(y);
      }
      d.setFont("helvetica", isHeader ? "bold" : "normal");
      d.setFontSize(fontSize);
      if (isHeader) {
        d.setFillColor(240, 247, 243);
        d.rect(M, y, W - 2 * M, rowH, "F");
      }
      cells.forEach(function (txt, i) {
        var align = cols[i].align || "left";
        var cx = align === "center" ? colX[i] + (cols[i].w * scale) / 2
               : align === "right"  ? colX[i] + (cols[i].w * scale) - 4
               : colX[i] + 4;
        amsText(d, txt == null ? "-" : txt, cx, y + rowH - 5.5, { align: align, color: "#000000" });
      });
      d.setDrawColor(210, 224, 217);
      d.setLineWidth(0.6);
      d.rect(M, y, W - 2 * M, rowH);
      return y + rowH;
    }

    function drawHeader(y) {
      return drawRow(y, cols.map(function (c) { return c.title; }), true);
    }

    var y = drawHeader(startY);
    rows.forEach(function (r) { y = drawRow(y, r, false); });
    return y + 8;
  }

  function footer(d, y) {
    if (y > H - M - 40) y = H - M - 40;
    y = Math.max(y, H - M - 60);
    d.setDrawColor(15, 61, 46);
    d.setLineWidth(0.8);
    d.line(M + 30, y + 34, M + 180, y + 34);
    d.line(W - M - 180, y + 34, W - M - 30, y + 34);
    d.setFont("helvetica", "normal");
    d.setFontSize(8.5);
    d.setTextColor(60, 60, 60);
    d.text("Official's Signature", M + 30, y + 44);
    d.text("Date", W - M - 180, y + 44);
  }

  /* ---------------------- fee payment RECEIPT ----------------------- */
  /* REDESIGNED (pack 82): "OFFICIAL SCHOOL PAYMENT RECEIPT" - school
     letterhead, receipt no + date strip, a labelled details box (student
     name, student ID / admission no, class, term/session, purpose, method),
     a prominent green AMOUNT PAID banner, amount in words, optional note,
     and Bursar ("Received by") + Principal signature areas. Still returns
     the jsPDF doc, so the existing download path is unchanged. */
  window.amsReceiptPDF = function (o) {
    var d = doc();
    var y = header(d, "OFFICIAL SCHOOL PAYMENT RECEIPT", []);
    y += 8;

    /* receipt no + date strip */
    d.setFillColor(240, 247, 243);
    d.rect(M, y, W - 2 * M, 24, "F");
    d.setFont("helvetica", "bold");
    d.setFontSize(10.5);
    d.setTextColor(15, 61, 46);
    d.text("Receipt No: " + (o.receiptNo || "-"), M + 12, y + 16);
    d.text("Date: " + (o.date || "-"), W - M - 12, y + 16, { align: "right" });
    y += 36;

    /* --------------------------- details box --------------------------- */
    var boxH = 150;
    d.setDrawColor(15, 61, 46);
    d.setLineWidth(1.5);
    d.rect(M, y, W - 2 * M, boxH);
    var ry = y + 24;

    function drawBox(lbl, val, x, topY) {
      d.setFont("helvetica", "normal");
      d.setFontSize(8);
      d.setTextColor(100, 100, 100);
      d.text(lbl, x, topY);
      d.setFont("helvetica", "bold");
      d.setFontSize(11);
      d.setTextColor(10, 30, 20);
      amsText(d, val || "-", x, topY + 14);
    }

    drawBox("STUDENT NAME", o.studentName, M + 20, ry);
    drawBox("STUDENT ID / ADMISSION NO", o.studentId, M + 290, ry);
    ry += 46;

    drawBox("CLASS", o.className, M + 20, ry);
    drawBox("TERM / SESSION", (o.term || "-") + " (" + (o.session || "-") + ")", M + 290, ry);
    ry += 46;

    drawBox("PURPOSE (FEE TYPE)", o.purpose || o.feeType || "School Fee", M + 20, ry);
    drawBox("PAYMENT METHOD", o.method || "Cash / Transfer", M + 290, ry);
    y += boxH + 16;

    /* ------------------- prominent AMOUNT PAID banner ------------------- */
    d.setFillColor(15, 61, 46);
    d.rect(M, y, W - 2 * M, 38, "F");
    d.setFont("helvetica", "bold");
    d.setFontSize(15);
    d.setTextColor(255, 255, 255);
    d.text("AMOUNT PAID:   " + nairaText(o.amount), W / 2, y + 24.5, { align: "center" });
    y += 38 + 12;

    /* ------------------------- amount in words ------------------------- */
    d.setFont("helvetica", "italic");
    d.setFontSize(9.8);
    d.setTextColor(60, 60, 60);
    var wordLines = d.splitTextToSize("Amount in words: " + numberToWords(o.amount), W - 2 * M - 24);
    d.text(wordLines, M + 12, y + 4);
    y += wordLines.length * 13 + 4;

    /* --------------------------- optional note --------------------------- */
    if (o.note && String(o.note).trim()) {
      d.setFont("helvetica", "normal");
      d.setFontSize(9.5);
      d.setTextColor(60, 60, 60);
      amsText(d, "Note: " + o.note, M + 12, y + 2);
      y += 16;
    }

    /* --------------------------- closing line --------------------------- */
    d.setFont("helvetica", "italic");
    d.setFontSize(9);
    d.setTextColor(80, 80, 80);
    d.text("Thank you for your payment. This receipt remains valid proof of payment for this academic session.", W / 2, y + 20, { align: "center" });

    /* ----------------- Bursar + Principal signature areas ----------------- */
    var sigY = Math.max(y + 55, H - M - 110);
    d.setDrawColor(15, 61, 46);
    d.setLineWidth(0.9);
    d.line(M + 30, sigY, M + 210, sigY);
    d.line(W - M - 210, sigY, W - M - 30, sigY);
    d.setFont("helvetica", "normal");
    d.setFontSize(8.5);
    d.setTextColor(90, 90, 90);
    d.text("Received by: " + (o.receivedBy || "__________"), M + 32, sigY - 6);
    d.setFont("helvetica", "bold");
    d.setFontSize(9);
    d.setTextColor(10, 30, 20);
    d.text("THE BURSAR / ACCOUNTANT", M + 40, sigY + 13);
    d.text("THE PRINCIPAL", W - M - 175, sigY + 13);

    return d;
  };

  /* ------------------- payments list per student -------------------- */
  window.amsPaymentsPDF = function (o) {
    var d = doc();
    var y = header(d, "FEE PAYMENT RECORDS", [
      o.studentName + "  (" + o.studentId + ")" + (o.className ? "  -  " + o.className : ""),
      "Term: " + o.term + "      Session: " + o.session
    ]);
    // CHANGED (pack 15): the Fee Type column is included.
    y = table(d, y, [
      { title: "Date", w: 18 },
      { title: "Fee Type", w: 24 },
      { title: "Amount", w: 18, align: "right" },
      { title: "Method", w: 18 },
      { title: "Received By", w: 22 },
      { title: "Note", w: 20 }
    ], o.rows, 8.5);

    d.setFont("helvetica", "bold");
    d.setFontSize(10.5);
    d.setTextColor(15, 61, 46);
    d.text("Fee: " + nairaText(o.fee) + "      Total Paid: " + nairaText(o.totalPaid) + "      Balance: " + nairaText(o.balance), M, y + 4);
    footer(d, y + 30);
    return d;
  };

  /* ------------- NEW (pack 15): fee STATEMENT per fee type ---------- */
  window.amsFeeStatementPDF = function (o) {
    var d = doc();
    var y = header(d, "FEE STATEMENT", [
      o.studentName + "  (" + o.studentId + ")" + (o.className ? "  -  " + o.className : ""),
      "Term: " + o.term + "      Session: " + o.session
    ]);
    y = table(d, y, [
      { title: "Fee Type", w: 34 },
      { title: "Fee", w: 20, align: "right" },
      { title: "Paid", w: 20, align: "right" },
      { title: "Balance", w: 20, align: "right" },
      { title: "Status", w: 16, align: "center" }
    ], o.rows.map(function (r) {
      var bal = Number(r.balance);
      return [r.fee_type, nairaText(r.fee), nairaText(r.paid), nairaText(r.balance),
              bal <= 0 && Number(r.fee) > 0 ? "PAID" : "OWING"];
    }), 9.5);

    d.setFont("helvetica", "bold");
    d.setFontSize(11);
    d.setTextColor(15, 61, 46);
    d.text("TOTAL:  Fee " + nairaText(o.totalFee) + "   |   Paid " + nairaText(o.totalPaid) + "   |   Balance " + nairaText(o.totalBalance), M, y + 4);
    y += 14;

    /* NEW (pack 21 - master list): complete the statement with parent info,
       every PAYMENT ever recorded (date + receipt reference) and the pupil's
       passport photo when available. All optional - the original statement
       renders exactly as before when they are absent. */
    if (o.parentLine) {
      d.setFont("helvetica", "normal");
      d.setFontSize(9);
      d.setTextColor(95, 107, 98);
      d.text("Parent: " + o.parentLine, M, y);
      y += 6;
    }
    if (Array.isArray(o.payments) && o.payments.length) {
      y = table(d, y + 2, [
        { title: "#", w: 8, align: "center" },
        { title: "Date", w: 24, align: "center" },
        { title: "Fee Type", w: 40 },
        { title: "Amount Paid", w: 26, align: "right" },
        { title: "Method", w: 24, align: "center" },
        { title: "Receipt Ref", w: 24, align: "center" }
      ], o.payments.map(function (p, i) {
        return [String(i + 1), String(p.date || "-"), String(p.fee_type || "School Fee"),
                nairaText(p.amount), String(p.method || "-"), "RCP-" + String(p.id).padStart(4, "0")];
      }), 9);
    }
    if (o.photoDataUrl) {
      try {
        const pw = 20, ph = 25;
        d.addImage(o.photoDataUrl, "JPEG", W - M - pw, 42, pw, ph);
        d.setDrawColor(31, 90, 66);
        d.rect(W - M - pw, 42, pw, ph);
      } catch (e) { /* photo failed to embed - statement still complete */ }
    }
    footer(d, y + 32);
    return d;
  };

  /* -------------------- attendance REGISTER (one day) --------------- */
  window.amsAttendanceRegisterPDF = function (o) {
    var d = doc();
    var y = header(d, "STUDENT ATTENDANCE REGISTER", [
      "Class: " + o.className + "      Date: " + o.date,
      "Present: " + o.summary.present + "      Absent: " + o.summary.absent + "      Late: " + o.summary.late + "      Total: " + o.summary.total
    ]);
    y = table(d, y, [
      { title: "#", w: 6, align: "center" },
      { title: "Student ID", w: 22 },
      { title: "Student Name", w: 46 },
      { title: "Status", w: 20, align: "center" }
    ], o.rows, 9.5);
    footer(d, y + 26);
    return d;
  };

  /* -------------------- attendance REPORT (range) ------------------- */
  window.amsAttendanceReportPDF = function (o) {
    var d = doc();
    var y = header(d, "ATTENDANCE REPORT", [
      "Class: " + o.className + "      From: " + o.from + "   To: " + o.to
    ]);
    table(d, y, [
      { title: "#", w: 6, align: "center" },
      { title: "Student Name", w: 36 },
      { title: "Present", w: 13, align: "center" },
      { title: "Absent", w: 13, align: "center" },
      { title: "Late", w: 12, align: "center" },
      { title: "Marked", w: 13, align: "center" },
      { title: "Present %", w: 15, align: "center" }
    ], o.rows, 9.5);
    footer(d, H - M - 60);
    return d;
  };

  /* NEW (pack 17 - owner request): ONE student's full attendance history -
   every marked day in a row (date | day | status). Compact 3-column
   layout so even a full year stays short and easy to read. */
  window.amsStudentAttendancePDF = function (o) {
    var d = doc();
    var y = header(d, "STUDENT ATTENDANCE HISTORY", [
      "Name: " + o.studentName + "      ID: " + o.studentId + "      Class: " + o.className,
      "Present: " + o.summary.present + "      Absent: " + o.summary.absent + "      Late: " + o.summary.late +
      "      Days Marked: " + o.summary.total + "      Present %: " + o.summary.pct + "%"
    ]);
    y = table(d, y, [
      { title: "#", w: 6, align: "center" },
      { title: "Date", w: 22, align: "center" },
      { title: "Day", w: 20, align: "center" },
      { title: "Status", w: 18, align: "center" }
    ], o.rows, 9.5);
    footer(d, y + 26);
    return d;
  };

  /* ---------------- STUDENT INFORMATION CONFIRMATION REGISTER ----------------
     NEW: a beautiful one-glance register the school can print and post so
     every student confirms their NAME, ADMISSION NO and CLASS. Grouped by
     class with green section bands, a summary strip, zebra rows and a blank
     signature column for students to sign. Handles Arabic names/classes via
     amsText. Returns the jsPDF doc (download path stays with the caller). */
  window.amsStudentInfoConfirmPDF = function (o) {
    o = o || {};
    var d = doc();
    var students = Array.isArray(o.students) ? o.students : [];
    var session = o.session || "—";
    var term = o.term || "—";

    function today() {
      var now = new Date();
      var m = ["January","February","March","April","May","June","July","August","September","October","November","December"][now.getMonth()];
      return now.getDate() + " " + m + " " + now.getFullYear();
    }

    /* ---- group by class, sort classes + names ---- */
    var groups = {}, order = [];
    students.forEach(function (s) {
      var c = String(s.class_name || "").trim() || "Unassigned";
      if (!groups[c]) { groups[c] = []; order.push(c); }
      groups[c].push(s);
    });
    /* natural (numeric-aware) sort so classes order sensibly, e.g.
       "Primary 1" before "Primary 10", and grouped class-by-class */
    function naturalCmp(a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    }
    order.sort(naturalCmp);
    order.forEach(function (c) {
      groups[c].sort(function (a, b) { return naturalCmp(a.full_name || "", b.full_name || ""); });
    });
    var males = students.filter(function (s) { return String(s.gender || "").toLowerCase() === "male"; }).length;
    var females = students.filter(function (s) { return String(s.gender || "").toLowerCase() === "female"; }).length;

    var y = header(d, "STUDENT INFORMATION CONFIRMATION REGISTER", [
      "Academic Session: " + session + "      Term: " + term + "      Generated: " + today(),
      "Please confirm your details below and report any correction to the school office."
    ]);

    /* ---- summary strip (4 stat chips) ---- */
    function chip(x, w, val, label) {
      d.setFillColor(244, 249, 246);
      d.setDrawColor(203, 219, 209);
      d.setLineWidth(0.7);
      d.roundedRect(x, y, w, 30, 4, 4, "FD");
      d.setFont("helvetica", "bold");
      d.setFontSize(13);
      d.setTextColor(21, 83, 45);
      d.text(String(val), x + w / 2, y + 13, { align: "center" });
      d.setFont("helvetica", "normal");
      d.setFontSize(7.5);
      d.setTextColor(95, 110, 100);
      d.text(label, x + w / 2, y + 23, { align: "center" });
    }
    var cw = (W - 2 * M - 24) / 4;
    var chips = [
      { v: students.length, l: "STUDENTS" },
      { v: order.length, l: "CLASSES" },
      { v: males, l: "MALE" },
      { v: females, l: "FEMALE" }
    ];
    chips.forEach(function (c, i) { chip(M + i * (cw + 8), cw, c.v, c.l); });
    y += 40;

    /* ---- column geometry ---- */
    var cols = [
      { title: "S/N", w: 20, align: "center" },
      { title: "Full Name", w: 158, align: "left" },
      { title: "Admission No.", w: 122, align: "left" },
      { title: "Gender", w: 40, align: "center" },
      { title: "Class", w: 95, align: "left" },
      { title: "Confirmed (Sign)", w: 76, align: "center" }
    ];
    var totalW = cols.reduce(function (a, c) { return a + c.w; }, 0);
    var scale = (W - 2 * M) / totalW;
    var colX = [];
    var acc = M;
    cols.forEach(function (c) { colX.push(acc); acc += c.w * scale; });
    var rowH = 16;

    function classBand(cls, count, isCont) {
      if (y + 40 > H - M - 26) { d.addPage(); y = M; }
      d.setFillColor(21, 83, 45);
      d.roundedRect(M, y, W - 2 * M, 22, 3, 3, "F");
      d.setFont("helvetica", "bold");
      d.setFontSize(10.5);
      d.setTextColor(255, 255, 255);
      amsText(d, (isCont ? "Continued - " : "") + "CLASS:  " + cls, M + 10, y + 15, { color: "#FFFFFF" });
      d.setFont("helvetica", "normal");
      d.setFontSize(8.5);
      d.text(count + " student" + (count === 1 ? "" : "s"), W - M - 10, y + 15, { align: "right" });
      y += 28;
      return y;
    }

    function colHeader() {
      if (y + 26 > H - M - 20) { d.addPage(); y = M; }
      d.setFillColor(236, 245, 239);
      d.setDrawColor(203, 219, 209);
      d.setLineWidth(0.6);
      d.rect(M, y, W - 2 * M, 20, "FD");
      d.setFont("helvetica", "bold");
      d.setFontSize(8.5);
      d.setTextColor(21, 83, 45);
      cols.forEach(function (c, i) {
        var cx = c.align === "center" ? colX[i] + (c.w * scale) / 2
               : c.align === "right"  ? colX[i] + c.w * scale - 4
               : colX[i] + 4;
        amsText(d, c.title, cx, y + 13.5, { align: c.align, color: "#15532D" });
      });
      y += 20;
      return y;
    }

    function bodyRow(s, n) {
      if (y + rowH > H - M - 26) {
        d.addPage(); y = M;
        /* re-draw the class band + column header so continuation pages
           stay self-explanatory when a class runs past one page */
        if (currentClass) { y = classBand(currentClass, currentCount, true); y = colHeader(); }
      }
      if (n % 2 === 0) {
        d.setFillColor(248, 251, 249);
        d.rect(M, y, W - 2 * M, rowH, "F");
      }
      var cells = [
        { t: String(n), align: "center" },
        { t: s.full_name, align: "left" },
        { t: s.student_id, align: "left" },
        { t: s.gender, align: "center" },
        { t: s.class_name, align: "left" },
        { t: "", align: "center" }
      ];
      d.setFont("helvetica", "normal");
      d.setFontSize(9);
      d.setTextColor(30, 40, 34);
      cells.forEach(function (c, i) {
        if (c.t) {
          var cx = c.align === "center" ? colX[i] + (cols[i].w * scale) / 2
                 : c.align === "right"  ? colX[i] + cols[i].w * scale - 4
                 : colX[i] + 4;
          amsText(d, c.t, cx, y + rowH - 5, { align: c.align, color: "#1E2822" });
        }
      });
      /* dashed signature line in the last column */
      var sx = colX[5] + 6, ex = colX[5] + cols[5].w * scale - 6;
      d.setDrawColor(180, 195, 185);
      d.setLineWidth(0.5);
      d.setLineDashPattern([2, 2], 0);
      d.line(sx, y + rowH - 4, ex, y + rowH - 4);
      d.setLineDashPattern([], 0);
      /* faint row separators */
      d.setDrawColor(226, 234, 229);
      d.setLineWidth(0.4);
      d.line(M, y + rowH, W - M, y + rowH);
      y += rowH;
      return y;
    }

    var n = 0, currentClass = "", currentCount = 0;
    order.forEach(function (cls) {
      currentClass = cls;
      currentCount = groups[cls].length;
      y = classBand(cls, currentCount);
      y = colHeader();
      groups[cls].forEach(function (s) {
        n++;
        y = bodyRow(s, n);
      });
      y += 6;
    });

    /* ---- closing note + signatures ---- */
    if (y + 70 > H - M - 30) { d.addPage(); y = M + 20; }
    y += 12;
    d.setFillColor(244, 249, 246);
    d.setDrawColor(203, 219, 209);
    d.setLineWidth(0.7);
    d.roundedRect(M, y, W - 2 * M, 34, 4, 4, "FD");
    d.setFont("helvetica", "bold");
    d.setFontSize(9.5);
    d.setTextColor(21, 83, 45);
    d.text("Kindly confirm your Name, Admission Number and Class above.", M + 12, y + 14);
    d.setFont("helvetica", "normal");
    d.setFontSize(8.5);
    d.setTextColor(95, 110, 100);
    d.text("If any detail is wrong, please report it to the school office for correction. Thank you.", M + 12, y + 25);
    y += 46;
    footer(d, y);

    return d;
  };
})();
