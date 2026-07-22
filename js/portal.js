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
      ptStudent = data.student; // FIX (pack 21): the pack-15 fee/statement
                                 // code lives OUTSIDE this IIFE and referenced
                                 // `student` directly -> ReferenceError
                                 // ("student is not defined") every time the
                                 // Statement button was clicked. Publish the
                                 // logged-in student for that scope too.
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
      loadPortalNotices(); // NEW (pack 22): announcements for parents/students
      loadPortalExams();   // NEW (pack 22): exam timetable for this class
      // CHANGED (pack 24): do NOT load messages at boot - showing the
      // thread counts as read, which instantly cleared the bell for
      // parents who never opened the chat. The thread now loads (and
      // marks read) exactly when the parent opens the Chat view.
      ptPrefillSettings(student); // NEW (pack 23): Settings card prefill
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
var ptStudent = null; // FIX (pack 21): file-scope copy of the logged-in
                      // student (see the /portal/me handler above) so the
                      // fee statement can read name/id/class without
                      // breaking on an undefined `student`.
var ptPaymentsRows = []; // pack 21: payment rows for the statement

/* pack 21: fetch helper - image URL -> data URL (for PDF photos). Silently
   resolves to null if the image is missing/failed, so a photo never
   blocks the statement. */
function ptImgToDataUrl(url) {
  return new Promise(function (resolve) {
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      try {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c.toDataURL("image/jpeg", 0.85));
      } catch (e) { resolve(null); }
    };
    img.onerror = function () { resolve(null); };
    img.src = url;
  });
}

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
      loadMyPayments(); // NEW (pack 17): payment rows + snapped receipts
    })
    .catch(function () { /* leave hidden */ });
}

/* NEW (pack 22 - owner: "I can't see messages, notifications, exam
   timetable"): portal notice board (announcements for parents/students +
   dated events) and the class's exam timetable. */
function loadPortalNotices() {
  fetch("/portal/announcements")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var card = document.getElementById("ptNoticesCard");
      var box = document.getElementById("ptNotices");
      var empty = document.getElementById("ptNoticesEmpty"); // NEW (pack 24)
      if (!card || !box || !Array.isArray(rows) || !rows.length) {
        if (empty) empty.style.display = "block"; // NEW (pack 24): friendly empty state
        return;
      }
      if (empty) empty.style.display = "none";
      var AUD = { general: "Everyone", student: "Students", parent: "Parents" };
      box.innerHTML = rows.map(function (n) {
        var when = n.kind === "event" && n.event_date
          ? "Event date: " + esc(String(n.event_date).slice(0, 10))
          : esc(String(n.created_at || "").slice(0, 10));
        return '<div class="pt-fee-row" style="align-items:flex-start;"><span style="text-align:left;">' +
          "<b>" + esc(n.title) + "</b> " +
          '<small style="color:#5B6B62;">[' + (AUD[n.audience] || "Everyone") + (n.kind === "event" ? " - Event" : "") + "]</small>" +
          (n.body ? '<br><span style="font-weight:400;">' + esc(n.body) + "</span>" : "") +
          "</span>" +
          '<span class="pt-right" style="white-space:nowrap;">' + when + "</span></div>";
      }).join("");
      card.style.display = "block";
    })
    .catch(function () { /* notices stay hidden */ });
}

/* NEW (pack 25 - owner request): "exam and class timetable ... will display
   for students after been published."
   Reads the school's PUBLISHED timetable rows for the pupil's own class
   (server filters by session + class + published=1). Before publish the
   parent only sees a friendly "not yet" note - nothing leaks early. */
function loadPortalTimetable(kind) {
  var isExam = kind === "exam";
  var card = document.getElementById(isExam ? "ptTtExamCard" : "ptTtClassCard");
  var box = document.getElementById(isExam ? "ptTtExam" : "ptTtClass");
  var empty = document.getElementById(isExam ? "ptTtExamEmpty" : "ptTtClassEmpty");
  if (!card || !box) return;
  fetch("/portal/timetable/" + kind)
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) {
        card.style.display = "none";
        if (empty) empty.style.display = "block";
        return;
      }
      if (empty) empty.style.display = "none";
      if (isExam) {
        box.innerHTML = '<div class="pt-fee-row head"><span>Subject</span><span class="pt-right">Date</span><span class="pt-right">Time</span></div>' +
          rows.map(function (t) {
            var dt = t.exam_date ? esc(String(t.exam_date).slice(0, 10)) : "To be announced";
            var tm = (t.start_time ? esc(String(t.start_time)) : "") + (t.end_time ? " - " + esc(String(t.end_time)) : "");
            return '<div class="pt-fee-row"><span style="text-align:left;"><b>' + esc(t.subject) + "</b></span>" +
              '<span class="pt-right" style="white-space:nowrap;">' + dt + "</span>" +
              '<span class="pt-right" style="white-space:nowrap;">' + (tm || "-") + "</span></div>";
          }).join("");
      } else {
        // group the periods under each day, Monday first
        var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        var html = "";
        DAYS.forEach(function (d) {
          var dayRows = rows.filter(function (t) { return t.day_of_week === d; });
          if (!dayRows.length) return;
          html += '<div class="pt-fee-row head"><span>' + d + '</span><span class="pt-right">Period</span><span class="pt-right">Time</span></div>' +
            dayRows.map(function (t) {
              var tm = (t.start_time ? esc(String(t.start_time)) : "") + (t.end_time ? " - " + esc(String(t.end_time)) : "");
              return '<div class="pt-fee-row"><span style="text-align:left;"><b>' + esc(t.subject) + "</b></span>" +
                '<span class="pt-right">' + (t.period_no != null ? esc(String(t.period_no)) : "-") + "</span>" +
                '<span class="pt-right" style="white-space:nowrap;">' + (tm || "-") + "</span></div>";
            }).join("");
        });
        box.innerHTML = html;
      }
      card.style.display = "block";
    })
    .catch(function () { /* timetable stays hidden */ });
}

function loadPortalExams() {
  fetch("/portal/exams")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var card = document.getElementById("ptExamsCard");
      var box = document.getElementById("ptExams");
      if (!card || !box || !Array.isArray(rows) || !rows.length) return;
      box.innerHTML = '<div class="pt-fee-row head"><span>Paper</span><span class="pt-right">Date</span><span class="pt-right">Duration</span></div>' +
        rows.map(function (e) {
          var dt = e.exam_date ? esc(String(e.exam_date).slice(0, 10)) : "To be announced";
          return '<div class="pt-fee-row"><span style="text-align:left;"><b>' + esc(e.subject) + "</b>" +
            (e.title ? ' <small style="color:#5B6B62;">(' + esc(e.title) + ")</small>" : "") +
            '<br><small style="color:#5B6B62;">' + esc(e.term || "") + (e.session ? " - " + esc(e.session) : "") + "</small></span>" +
            '<span class="pt-right" style="white-space:nowrap;">' + dt + "</span>" +
            '<span class="pt-right" style="white-space:nowrap;">' + esc(e.duration || "-") + "</span></div>";
        }).join("");
      card.style.display = "block";
    })
    .catch(function () { /* timetable stays hidden */ });
}

/* NEW (pack 17 - owner request): "parent will also see it that admin has
   updated the fees in their portal" - every payment the school recorded
   for this child, WITH the receipt photo the admin snapped in school.
   Tap Receipt to open the photo; it never appears before admin adds it. */
function loadMyPayments() {
  fetch("/portal/payments")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var box = document.getElementById("ptFees");
      if (!box || !Array.isArray(rows)) return;
      ptPaymentsRows = rows; // FIX (pack 21): keep the rows for the statement PDF
      if (!rows.length) return;
      var html = '<div style="margin-top:10px; border-top:1px dashed #d7e0da; padding-top:10px;">' +
        '<div class="pt-fee-row head"><span>Payments Recorded by the School</span><span class="pt-right">Amount</span><span class="pt-right">Receipt</span></div>';
      rows.forEach(function (p) {
        var dt = p.created_at ? String(p.created_at).slice(0, 10) : "-";
        var label = esc(p.fee_type || "School Fee") + ' <small style="color:#5B6B62;">' + esc(dt) + (p.method ? " \u00B7 " + esc(p.method) : "") + "</small>";
        // FIX (pack 23 - owner: "the View takes me to a blank page"): open
        // the friendly receipt viewer instead of the raw file URL. Old
        // receipts whose photo is gone now show a clear explanation page,
        // never a blank tab.
        var rec = p.receipt_path
          ? '<a href="/portal/receipt/' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener" style="font-weight:800; color:#0d6b4f;">\u{1F9FE} View</a>'
          : '<span style="color:#93a19a;" title="The school has not snapped the receipt yet">-</span>';
        html += '<div class="pt-fee-row"><span>' + label + '</span>' +
                '<span class="pt-right">' + ptNaira(p.amount) + '</span>' +
                '<span class="pt-right">' + rec + '</span></div>';
      });
      html += "</div>";
      box.insertAdjacentHTML("beforeend", html);
    })
    .catch(function () { /* receipts stay hidden */ });
}

document.getElementById("ptStmtBtn").addEventListener("click", function () {
  if (!ptFeeTS || !ptStudent) return;  // FIX (pack 21): was `student` (undefined in this scope -> ReferenceError -> silent dead button)
  var btn = this;
  btn.disabled = true;
  var viewRows = ptFeeRows.filter(function (r) { return r.term === ptFeeTS.term && r.session === ptFeeTS.session; });
  // FIX (pack 21 - master list): enrich the statement with parent info,
  // passport photo and the full payment history (dates + receipt refs).
  fetch("/student/" + encodeURIComponent(ptStudent.student_id))
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var full = Array.isArray(rows) && rows.length ? rows[0] : {};
      var parentLine = (full.parent_name ? full.parent_name : "-") +
                       (full.parent_phone ? "   Tel: " + full.parent_phone : "");
      return ptImgToDataUrl("/" + (full.photo_path || "")).then(function (photo) {
        return { parentLine: parentLine, photo: photo };
      });
    })
    .catch(function () { return { parentLine: "", photo: null }; })
    .then(function (extra) {
      var d = window.amsFeeStatementPDF({
        studentName: ptStudent.full_name,
        studentId: ptStudent.student_id,
        className: ptStudent.class_name,
        parentLine: extra.parentLine,
        photoDataUrl: extra.photo,
        term: ptFeeTS.term,
        session: ptFeeTS.session,
        rows: viewRows,
        payments: ptPaymentsRows.map(function (p) {
          return { id: p.id, date: p.created_at ? String(p.created_at).slice(0, 10) : "",
                   fee_type: p.fee_type, amount: p.amount, method: p.method };
        }),
        totalFee: viewRows.reduce(function (a, r) { return a + Number(r.fee); }, 0),
        totalPaid: viewRows.reduce(function (a, r) { return a + Number(r.paid); }, 0),
        totalBalance: viewRows.reduce(function (a, r) { return a + Number(r.balance); }, 0)
      });
      d.save("fee-statement-" + ptStudent.student_id + ".pdf");
    })
    .finally(function () { btn.disabled = false; });
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
var ptCalSigMap = null; // NEW (pack 17): signature map for the full-page PDF
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
        ptCalSigMap = map; // NEW (pack 17): kept for the PDF
        var holder = document.getElementById("ptCalHolder");
        holder.innerHTML = "";
        // CHANGED (pack 17 - owner request): compact view on screen (the
        // big letterhead hides so the page is not long); the PDF download
        // still builds the FULL letterhead calendar.
        holder.appendChild(amsBuildCalendarSheet(data, map, { compact: true }));
        wrap.style.display = "block";
      });
    })
    .catch(function () { /* hidden */ });
}

document.getElementById("ptCalPdfBtn").addEventListener("click", function () {
  if (!ptCalDoc) return;
  var btn = document.getElementById("ptCalPdfBtn");
  btn.disabled = true;
  btn.textContent = "Building...";
  // CHANGED (pack 17): shared builder - FULL letterhead, FILLS the whole
  // A4 page top to bottom (no more shrunken calendar).
  amsCalendarPDF(ptCalDoc, ptCalSigMap || {}, function () {
    btn.disabled = false;
    btn.textContent = "\u{2B07} Download PDF";
  });
});

/* ==========================================================================
   NEW (pack 23 - owner requests):
     1. MESSAGES: parent <-> class teacher, parent <-> school administration
     2. NOTIFICATIONS: bell badge = unread replies from the school
     3. SETTINGS: change portal password + update contact details
   All backend calls are new, guarded routes; nothing existing removed.
   ========================================================================== */

/* ---- settings: prefill the contact form from the school register ---- */
function ptPrefillSettings(st) {
  if (!st) return;
  var n = document.getElementById("ptParentName");
  var p = document.getElementById("ptParentPhone");
  var a = document.getElementById("ptAddress");
  if (n) n.value = st.parent_name || "";
  if (p) p.value = st.parent_phone || "";
  if (a) a.value = st.address || "";
}

/* ------------------------- MESSAGES UI ------------------------------ */
function ptRenderMessages(rows) {
  var box = document.getElementById("ptMsgs");
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = '<div class="pt-empty">No messages yet. Say salam below - the school replies right here.</div>';
    return;
  }
  box.innerHTML = rows.map(function (m) {
    var mine = m.sender_type === "portal";
    var who = mine ? "You" : (m.sender_name || "School");
    var when = String(m.created_at || "").replace("T", " ").slice(0, 16);
    return '<div style="display:flex; justify-content:' + (mine ? "flex-end" : "flex-start") + "; margin:6px 0;\">" +
      '<div style="max-width:82%; padding:8px 12px; border-radius:14px; ' +
      (mine
        ? "background:#14532d; color:#fff; border-bottom-right-radius:4px;"
        : "background:#eef4ef; color:#1f2d26; border:1px solid #d7e0da; border-bottom-left-radius:4px;") + '">' +
      '<div style="font-size:11px; opacity:.75; font-weight:700;">' + esc(who) + " · " + esc(when) + "</div>" +
      '<div style="font-size:14px; line-height:1.45; white-space:pre-wrap;">' + esc(m.body) + "</div>" +
      "</div></div>";
  }).join("");
}

function loadPortalMessages() {
  fetch("/portal/messages")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      ptRenderMessages(Array.isArray(rows) ? rows : []);
      // everything on screen counts as read -> then refresh the bell
      return fetch("/portal/messages/read", { method: "POST" });
    })
    .then(function () { ptRefreshUnread(); })
    .catch(function () { /* keep old view */ });
}

var ptMsgSending = false;
function ptSendMessage(ev) {
  ev.preventDefault();
  if (ptMsgSending) return;
  var toSel = document.getElementById("ptMsgTo");
  var bodyEl = document.getElementById("ptMsgBody");
  var note = document.getElementById("ptMsgNote");
  var body = (bodyEl.value || "").trim();
  if (!body) return;
  ptMsgSending = true;
  fetch("/portal/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: toSel.value, body: body })
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (note) { note.textContent = res.d.message || (res.ok ? "Sent." : "Could not send."); note.style.color = res.ok ? "#14532d" : "#C0392B"; }
      if (res.ok) { bodyEl.value = ""; loadPortalMessages(); }
    })
    .catch(function () { if (note) { note.textContent = "Network error - try again."; note.style.color = "#C0392B"; } })
    .finally(function () { ptMsgSending = false; });
}

/* --------------------- NOTIFICATIONS (bell + badges, pack 24) -------- */
function ptRefreshUnread() {
  fetch("/portal/messages/unread")
    .then(function (r) { return r.ok ? r.json() : { count: 0 }; })
    .then(function (d) {
      var c = d && d.count ? d.count : 0;
      var label = c > 9 ? "9+" : String(c);
      // CHANGED (pack 24): one count feeds the top bell AND both sidebar badges.
      [["ptBellBadge", "inline-block"], ["ptChatBadge", "inline-block"], ["ptNotifBadge", "inline-block"]].forEach(function (pair) {
        var el = document.getElementById(pair[0]);
        if (!el) return;
        el.style.display = c > 0 ? pair[1] : "none";
        el.textContent = label;
      });
    })
    .catch(function () { /* keep old badge */ });
}

/* ------------------------- SETTINGS forms --------------------------- */
function ptWireSettings() {
  var pwForm = document.getElementById("ptPwForm");
  var contactForm = document.getElementById("ptContactForm");
  var note = document.getElementById("ptSettingsNote");

  if (pwForm) pwForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var cur = document.getElementById("ptPwCurrent").value;
    var n1 = document.getElementById("ptPwNew").value;
    var n2 = document.getElementById("ptPwNew2").value;
    if (n1 !== n2) { if (note) { note.textContent = "The two new passwords do not match."; note.style.color = "#C0392B"; } return; }
    fetch("/portal/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: cur, newPassword: n1 })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (note) { note.textContent = res.d.message || ""; note.style.color = res.ok ? "#14532d" : "#C0392B"; }
        if (res.ok) pwForm.reset();
      })
      .catch(function () { if (note) { note.textContent = "Network error - try again."; note.style.color = "#C0392B"; } });
  });

  if (contactForm) contactForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    fetch("/portal/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parent_name: document.getElementById("ptParentName").value,
        parent_phone: document.getElementById("ptParentPhone").value,
        address: document.getElementById("ptAddress").value
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (note) { note.textContent = res.d.message || ""; note.style.color = res.ok ? "#14532d" : "#C0392B"; }
      })
      .catch(function () { if (note) { note.textContent = "Network error - try again."; note.style.color = "#C0392B"; } });
  });
}

/* ==========================================================================
   NEW (pack 24 - owner requests):
     "make it like the OPay/PalmPay one - press the notification icon, it
      takes you to another page, you see all notifications listed, press
      one and it shows you where you need to go."
   View router for the sidebar shell + the Notifications page builder.
   ========================================================================== */
function ptShowView(name) {
  document.querySelectorAll(".pt-view").forEach(function (v) {
    v.classList.toggle("pt-view-on", v.getAttribute("data-view") === name);
  });
  document.querySelectorAll(".pt-navlink[data-view]").forEach(function (l) {
    l.classList.toggle("pt-active", l.getAttribute("data-view") === name);
  });
  document.body.classList.remove("pt-nav-open");
  window.scrollTo({ top: 0 });
  // lazy loaders: only touch the network when the parent actually opens it
  if (name === "chat") loadPortalMessages();           // shows + marks read -> bell clears
  if (name === "notifications") loadPortalNotifications();
  if (name === "exams") loadPortalTimetable("exam");    // NEW (pack 25): published exam schedule
  if (name === "classtt") loadPortalTimetable("class"); // NEW (pack 25): published weekly timetable
}

/* Build the OPay-style list: unread replies, school notices & events,
   dated exams, recent payments - every row jumps to its own place. */
function loadPortalNotifications() {
  var box = document.getElementById("ptNotifList");
  if (!box) return;
  box.innerHTML = '<div class="pt-empty">Loading notifications...</div>';
  var items = [];
  var done = function () {
    // newest first across every source
    items.sort(function (a, b) { return String(b.when).localeCompare(String(a.when)); });
    if (!items.length) {
      box.innerHTML = '<div class="pt-empty">Nothing new from the school yet. Messages, notices, exam dates and payments will land here.</div>';
      return;
    }
    box.innerHTML = "";
    items.forEach(function (it) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "pt-notif-item" + (it.unread ? " pt-unread" : "");
      row.innerHTML =
        '<span class="pt-nico">' + it.icon + "</span>" +
        '<span class="pt-nt"><b>' + esc(it.title) + "</b><span>" + esc(it.text) + "</span></span>" +
        '<span class="pt-nwhen">' + esc(String(it.when).slice(0, 10)) + "</span>" +
        '<span class="pt-nchev">&#8250;</span>';
      row.addEventListener("click", function () { ptShowView(it.view); });
      box.appendChild(row);
    });
  };
  // 4 small parallel fetches (all existing routes)
  var pending = 4;
  var step = function () { if (--pending === 0) done(); };

  fetch("/portal/messages/unread").then(function (r) { return r.ok ? r.json() : {}; }).then(function (d) {
    if (d.count > 0) items.push({
      icon: "&#128172;", title: d.count + " new message" + (d.count > 1 ? "s" : "") + " from the school",
      text: "Tap to open Chat and read the reply.", when: new Date().toISOString().slice(0, 10),
      view: "chat", unread: true
    });
    step();
  }).catch(step);

  fetch("/portal/announcements").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    (Array.isArray(rows) ? rows : []).slice(0, 6).forEach(function (n) {
      var isEvent = n.kind === "event";
      var dt = isEvent && n.event_date ? String(n.event_date).slice(0, 10) : String(n.created_at || "").slice(0, 10);
      items.push({
        icon: isEvent ? "&#128197;" : "&#128227;",
        title: (isEvent ? "Event: " : "Notice: ") + (n.title || ""),
        text: isEvent && n.event_date ? "Happening on " + dt + (n.body ? " - " + n.body : "") : (n.body || "Tap to read"),
        when: String(n.created_at || dt), view: "notices", unread: false
      });
    });
    step();
  }).catch(step);

  fetch("/portal/exams").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    var today = new Date().toISOString().slice(0, 10);
    (Array.isArray(rows) ? rows : []).filter(function (e) { return e.exam_date && String(e.exam_date).slice(0, 10) >= today; })
      .slice(0, 5).forEach(function (e) {
        items.push({
          icon: "&#128394;", title: "Exam: " + (e.subject || e.title || ""),
          text: "Scheduled for " + String(e.exam_date).slice(0, 10),
          when: String(e.exam_date).slice(0, 10), view: "exams", unread: false
        });
      });
    step();
  }).catch(step);

  fetch("/portal/payments").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    (Array.isArray(rows) ? rows : []).slice(0, 3).forEach(function (p) {
      items.push({
        icon: "&#128184;", title: "Payment recorded: " + (p.fee_type || "School Fee"),
        text: "The school recorded " + (p.amount != null ? "\u20A6" + Number(p.amount).toLocaleString() : "a payment") + (p.method ? " (" + p.method + ")" : ""),
        when: String(p.created_at || ""), view: "fees", unread: false
      });
    });
    step();
  }).catch(step);
}

/* Boot the pack-23/24 widgets (DOM is ready - this script loads last). */
(function ptPack23Boot() {
  var msgForm = document.getElementById("ptMsgForm");
  if (msgForm) msgForm.addEventListener("submit", ptSendMessage);

  // pack 24: sidebar view switching
  document.querySelectorAll(".pt-navlink[data-view]").forEach(function (link) {
    link.addEventListener("click", function () { ptShowView(link.getAttribute("data-view")); });
  });
  document.querySelectorAll("[data-jump]").forEach(function (btn) {
    btn.addEventListener("click", function () { ptShowView(btn.getAttribute("data-jump")); });
  });
  var ham = document.getElementById("ptHam");
  if (ham) ham.addEventListener("click", function () { document.body.classList.toggle("pt-nav-open"); });
  var scrim = document.getElementById("ptScrim");
  if (scrim) scrim.addEventListener("click", function () { document.body.classList.remove("pt-nav-open"); });

  // CHANGED (pack 24): bell opens the Notifications PAGE (OPay-style),
  // not just a jump to chat.
  var bell = document.getElementById("ptBellBtn");
  if (bell) bell.addEventListener("click", function () { ptShowView("notifications"); });

  ptWireSettings();
  ptRefreshUnread();
  // gentle poll so a new school reply lights the bell even while the
  // parent is on another view (the "notifications" the owner asked for).
  setInterval(ptRefreshUnread, 60000);
})();
