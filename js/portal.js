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
      loadMyFees();      // NEW (pack 15)
      loadBankAccounts();// NEW (pack 15)
      loadMySubs();      // NEW (pack 15)
      loadCalendar();    // NEW (pack 15)
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


/* ======================== NEW (pack 15) ===============================
   Fees & balance per fee TYPE (+ printable statement), bank accounts,
   payment proof upload, published calendar viewer.
   ==================================================================== */
var ptFeeRows = [];
var ptFeeTS = null;

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ptNaira(n) {
  return "\u20A6" + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function ptPickTermSession(rows) {
  var best = null;
  rows.forEach(function (r) {
    var key = r.session + "|" + r.term;
    if (!best || key > best.key) best = { key: key, term: r.term, session: r.session };
  });
  return best;
}

function loadMyFees() {
  fetch("/portal/fees")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      ptFeeRows = Array.isArray(rows) ? rows : [];
      var card = document.getElementById("ptFeesCard");
      var box = document.getElementById("ptFees");
      if (!ptFeeRows.length) { card.style.display = "none"; return; }

      ptFeeTS = ptPickTermSession(ptFeeRows);
      var viewRows = ptFeeRows.filter(function (r) { return r.term === ptFeeTS.term && r.session === ptFeeTS.session; });

      var html = '<div class="pt-fee-row head"><span>Fee Type</span><span class="pt-right">Fee</span><span class="pt-right">Paid</span><span class="pt-right">Balance</span></div>';
      var tF = 0, tP = 0, tB = 0;
      viewRows.forEach(function (r) {
        tF += Number(r.fee); tP += Number(r.paid); tB += Number(r.balance);
        var state = (Number(r.balance) <= 0 && Number(r.fee) > 0)
          ? '<span class="pt-status-paid">PAID</span>' : '<span class="pt-status-owing">OWING</span>';
        html += '<div class="pt-fee-row"><span><b>' + esc(r.fee_type) + '</b> ' + state + '</span>' +
                '<span class="pt-right">' + ptNaira(r.fee) + '</span>' +
                '<span class="pt-right">' + ptNaira(r.paid) + '</span>' +
                '<span class="pt-right"><b>' + ptNaira(r.balance) + '</b></span></div>';
      });
      html += '<div class="pt-fee-row pt-fee-total"><span>TOTAL (' + esc(ptFeeTS.term) + ' - ' + esc(ptFeeTS.session) + ')</span>' +
              '<span class="pt-right">' + ptNaira(tF) + '</span>' +
              '<span class="pt-right">' + ptNaira(tP) + '</span>' +
              '<span class="pt-right"><b>' + ptNaira(tB) + '</b></span></div>';
      box.innerHTML = html;
      document.getElementById("ptFeesHint").textContent =
        "Showing " + ptFeeTS.term + " - " + ptFeeTS.session + ".";
      card.style.display = "block";
    })
    .catch(function () { /* leave hidden */ });
}

document.getElementById("ptStmtBtn").addEventListener("click", function () {
  if (!ptFeeTS || !student) return;
  var viewRows = ptFeeRows.filter(function (r) { return r.term === ptFeeTS.term && r.session === ptFeeTS.session; });
  var d = window.amsFeeStatementPDF({
    studentName: student.full_name,
    studentId: student.student_id,
    className: student.class_name,
    term: ptFeeTS.term,
    session: ptFeeTS.session,
    rows: viewRows,
    totalFee: viewRows.reduce(function (a, r) { return a + Number(r.fee); }, 0),
    totalPaid: viewRows.reduce(function (a, r) { return a + Number(r.paid); }, 0),
    totalBalance: viewRows.reduce(function (a, r) { return a + Number(r.balance); }, 0)
  });
  d.save("fee-statement-" + student.student_id + ".pdf");
});

/* --------------------- where to pay (bank accounts) ----------------- */
function loadBankAccounts() {
  fetch("/bank-accounts")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      var card = document.getElementById("ptBankCard");
      var box = document.getElementById("ptBanks");
      if (!rows.length) { card.style.display = "none"; return; }
      box.innerHTML = rows.map(function (b) {
        return '<div class="pt-bank"><b>' + esc(b.bank_name) + '</b>' +
               '<span class="num">' + esc(b.account_number) + '</span>' +
               '<span style="color:#5B6B62;">' + esc(b.account_name || "") + "</span></div>";
      }).join("");
      card.style.display = "block";
    })
    .catch(function () { /* hidden */ });

  // prefill the proof form (fee types from their fees; latest term/session)
  fetch("/portal/fees").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    var types = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) { if (!types.includes(r.fee_type)) types.push(r.fee_type); });
    if (!types.length) types = ["School Fee"];
    document.getElementById("ptPayType").innerHTML = types.map(function (t) { return "<option>" + esc(t) + "</option>"; }).join("");
    if (rows.length) {
      var best = ptPickTermSession(rows);
      if (best) {
        document.getElementById("ptPayTerm").value = best.term;
        document.getElementById("ptPaySession").innerHTML = "<option>" + esc(best.session) + "</option>";
      }
    }
  }).catch(function () {
    document.getElementById("ptPayType").innerHTML = "<option>School Fee</option>";
  });
}

/* --------------------- payment proof upload -------------------------- */
document.getElementById("ptProofForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var fileEl = document.getElementById("ptEvidence");
  var msg = document.getElementById("ptProofMsg");
  var btn = document.getElementById("ptProofBtn");
  function show(t, ok) { msg.textContent = t; msg.className = "pt-msg " + (ok ? "ok" : "err"); }
  if (!fileEl.files.length) { show("Choose the screenshot or PDF of the payment.", false); return; }

  var fd = new FormData();
  fd.append("fee_type", document.getElementById("ptPayType").value);
  fd.append("term", document.getElementById("ptPayTerm").value);
  fd.append("session", document.getElementById("ptPaySession").value);
  fd.append("amount", document.getElementById("ptPayAmount").value);
  fd.append("note", document.getElementById("ptPayNote").value);
  fd.append("evidence", fileEl.files[0]);

  btn.disabled = true;
  btn.textContent = "Sending...";
  fetch("/portal/payment-submission", { method: "POST", body: fd })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) {
        show(res.d.message || "Sent! The school will review it shortly.", true);
        e.target.reset();
        loadMySubs();
      } else {
        show(res.d.message || "Could not send. Please try again.", false);
      }
    })
    .catch(function () { show("Network error - please try again.", false); })
    .finally(function () { btn.disabled = false; btn.textContent = "\u{23F1} Send for Review"; });
});

function loadMySubs() {
  fetch("/portal/my-submissions")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      var box = document.getElementById("ptMySubs");
      if (!rows.length) { box.innerHTML = ""; return; }
      var html = '<div class="pt-fee-row head"><span>Payment Sent</span><span class="pt-right">Amount</span><span class="pt-right">Proof</span><span class="pt-right">Status</span></div>';
      rows.forEach(function (r) {
        var badge = r.status === "approved" ? '<span class="pt-sub-badge pt-sub-approved">Approved</span>'
                  : r.status === "rejected" ? '<span class="pt-sub-badge pt-sub-rejected">Rejected</span>'
                  : '<span class="pt-sub-badge pt-sub-pending">Pending review</span>';
        var proof = r.evidence_path
          ? '<a href="/' + esc(r.evidence_path) + '" target="_blank">' + (r.evidence_path.toLowerCase().endsWith(".pdf") ? "PDF" : "Image") + "</a>"
          : "-";
        html += '<div class="pt-fee-row"><span><b>' + esc(r.fee_type || "School Fee") + "</b><br>" +
                '<small style="color:#5B6B62;">' + esc(String(r.created_at || "").slice(0, 10)) + " - " + esc(r.term) + "</small></span>" +
                '<span class="pt-right">' + ptNaira(r.amount) + '</span>' +
                '<span class="pt-right">' + proof + '</span>' +
                '<span class="pt-right">' + badge + "</span></div>";
      });
      box.innerHTML = html;
    })
    .catch(function () { /* silent */ });
}

/* --------------------- madrasah calendar (published only) ------------ */
var ptCalDoc = null;
function loadCalendar() {
  fetch("/portal/calendars")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      var card = document.getElementById("ptCalCard");
      var wrap = document.getElementById("ptCalWrap");
      if (!rows.length) {
        card.style.display = "none";
        wrap.style.display = "none";
        ptCalDoc = null;
        return;
      }
      var cal = rows[0]; // only ONE can be published at a time by design
      var data = {};
      try { data = JSON.parse(cal.doc || "{}"); } catch (e) { data = {}; }
      ptCalDoc = data;
      document.getElementById("ptCalHint").textContent = cal.title;
      card.style.display = "block";
      amsFetchSignatureMap(function (map) {
        var holder = document.getElementById("ptCalHolder");
        holder.innerHTML = "";
        holder.appendChild(amsBuildCalendarSheet(data, map));
        wrap.style.display = "block";
      });
    })
    .catch(function () { /* hidden */ });
}

document.getElementById("ptCalPdfBtn").addEventListener("click", function () {
  var sheet = document.querySelector("#ptCalHolder .cal-sheet");
  if (!sheet) return;
  var btn = document.getElementById("ptCalPdfBtn");
  btn.disabled = true;
  btn.textContent = "Building...";
  window.html2canvas(sheet, { scale: 2, backgroundColor: "#ffffff", useCORS: true })
    .then(function (canvas) {
      var pdf = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
      var pageW = 595.28, pageH = 841.89, margin = 18;
      var ratio = canvas.height / canvas.width;
      var imgW = pageW - margin * 2;
      var imgH = imgW * ratio;
      if (imgH > pageH - margin * 2) { imgH = pageH - margin * 2; imgW = imgH / ratio; }
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (pageW - imgW) / 2, margin, imgW, imgH);
      pdf.save("school-calendar.pdf");
    })
    .catch(function () { alert("Could not build the PDF on this device."); })
    .finally(function () { btn.disabled = false; btn.textContent = "\u{2B07} Download PDF"; });
});
