/* ==========================================================================
   NEW FILE (pack 14) - js/ams-pdf.js
   Shared PDF makers built with jsPDF's own text/line API (NO html2canvas),
   so every output is a clean, exact A4 on every phone and laptop:
     - fee payment receipt (one payment)
     - payments list per student
     - attendance register (one class, one date)
     - attendance report (date range)
   Requires js/vendor/jspdf.umd.min.js to be loaded first. Additive.
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

  function naira(n) {
    return "N" + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
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
      d.text(line, W / 2, y, { align: "center" });
    });
    return y + 14;
  }

  /* Simple grid table with repeating header + page breaks.
     cols: [{title, w(mm-ratio number), align}], rows: [[..]] */
  function table(d, startY, cols, rows, fontSize) {
    fontSize = fontSize || 9;
    var totalW = cols.reduce(function (a, c) { return a + c.w; }, 0);
    var scale = (W - 2 * M) / totalW;
    var colX = [];
    var acc = M;
    cols.forEach(function (c) { colX.push(acc); acc += c.w * scale; });
    var rowH = fontSize + 8;

    function drawRow(y, cells, isHeader) {
      if (y + rowH > H - M - 30) { // new page
        d.addPage();
        y = M;
        drawHeader(y);
        y += rowH;
      }
      d.setFont("helvetica", isHeader ? "bold" : "normal");
      d.setFontSize(fontSize);
      if (isHeader) {
        d.setFillColor(240, 247, 243);
        d.rect(M, y, W - 2 * M, rowH, "F");
      }
      cells.forEach(function (txt, i) {
        var x = colX[i] + 4;
        var align = cols[i].align || "left";
        var cx = align === "center" ? colX[i] + (cols[i].w * scale) / 2
               : align === "right"  ? colX[i] + (cols[i].w * scale) - 4
               : x;
        d.setTextColor(0, 0, 0);
        d.text(String(txt == null ? "-" : txt), cx, y + rowH - 5, { align: align });
      });
      d.setDrawColor(210, 224, 217);
      d.setLineWidth(0.6);
      d.rect(M, y, W - 2 * M, rowH);
      return y + rowH;
    }

    function drawHeader(y) {
      drawRow(y, cols.map(function (c) { return c.title; }), true);
    }

    var y = startY;
    drawHeader(y);
    y += rowH;
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
    d.rect(M, y, W - 2 * M, 118);
    var ry = y + 20;
    function label(val, x) { d.setFont("helvetica", "normal"); d.setFontSize(8); d.setTextColor(120, 120, 120); d.text(val, x, ry - 4); }
    function value(val, x) { d.setFont("helvetica", "bold"); d.setFontSize(11); d.setTextColor(0, 0, 0); d.text(String(val || "-"), x, ry + 4); }

    label("RECEIVED FROM", M + 12); value(o.studentName, M + 12);
    label("STUDENT ID", M + 270); value(o.studentId, M + 270); ry += 26;
    label("CLASS", M + 12); value(o.className, M + 12);
    label("TERM", M + 270); value(o.term, M + 270);
    label("SESSION", M + 390); value(o.session, M + 390); ry += 26;
    label("AMOUNT (NAIRA)", M + 12);
    d.setFont("helvetica", "bold"); d.setFontSize(15); d.setTextColor(15, 61, 46);
    d.text(naira(o.amount), M + 12, ry + 4);
    label("PAYMENT METHOD", M + 270); value(o.method, M + 270); ry += 26;
    label("RECEIVED BY", M + 12); value(o.receivedBy, M + 12);
    label("NOTE", M + 270); value(o.note || "-", M + 270);

    y += 140;
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
    y = table(d, y, [
      { title: "Date", w: 22 },
      { title: "Amount", w: 22, align: "right" },
      { title: "Method", w: 22 },
      { title: "Received By", w: 26 },
      { title: "Note", w: 28 }
    ], o.rows, 9);

    d.setFont("helvetica", "bold");
    d.setFontSize(10.5);
    d.setTextColor(15, 61, 46);
    d.text("Fee: " + naira(o.fee) + "      Total Paid: " + naira(o.totalPaid) + "      Balance: " + naira(o.balance), M, y + 4);
    footer(d, y + 30);
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
    y = table(d, y, [
      { title: "#", w: 6, align: "center" },
      { title: "Student Name", w: 36 },
      { title: "Present", w: 13, align: "center" },
      { title: "Absent", w: 13, align: "center" },
      { title: "Late", w: 12, align: "center" },
      { title: "Marked", w: 13, align: "center" },
      { title: "Present %", w: 15, align: "center" }
    ], o.rows, 9.5);
    footer(d, y + 26);
    return d;
  };
})();
