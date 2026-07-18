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
  window.amsReceiptPDF = function (o) {
    var d = doc();
    var y = header(d, "OFFICIAL FEE PAYMENT RECEIPT", [
      "Receipt No: " + (o.receiptNo || "-") + "      Date: " + (o.date || "-")
    ]);

    d.setDrawColor(15, 61, 46);
    d.setLineWidth(1);
    d.rect(M, y, W - 2 * M, 140);
    var ry = y + 20;
    function label(val, x) { d.setFont("helvetica", "normal"); d.setFontSize(7.5); d.setTextColor(120, 120, 120); d.text(val, x, ry - 4); }
    function value(val, x) { d.setFont("helvetica", "bold"); d.setFontSize(10.5); d.setTextColor(0, 0, 0); amsText(d, val, x, ry + 4); }

    label("RECEIVED FROM", M + 12); value(o.studentName, M + 12);
    label("STUDENT ID", M + 270); value(o.studentId, M + 270); ry += 26;
    label("CLASS", M + 12); value(o.className, M + 12); ry += 26;
    label("FEE TYPE", M + 12); value(o.feeType || "School Fee", M + 12);
    label("TERM", M + 270); value(o.term, M + 270);
    label("SESSION", M + 390); value(o.session, M + 390); ry += 26;
    label("AMOUNT (NAIRA)", M + 12);
    d.setFont("helvetica", "bold"); d.setFontSize(15); d.setTextColor(15, 61, 46);
    d.text(nairaText(o.amount), M + 12, ry + 4);
    label("PAYMENT METHOD", M + 270); value(o.method, M + 270); ry += 26;
    label("RECEIVED BY", M + 12); value(o.receivedBy, M + 12);
    label("NOTE", M + 270); value(o.note || "-", M + 270);

    y += 162;
    d.setFont("helvetica", "italic");
    d.setFontSize(9);
    d.setTextColor(90, 90, 90);
    d.text("Thank you for your payment. Please keep this receipt as proof of payment.", W / 2, y, { align: "center" });

    footer(d, y + 40);
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
})();
