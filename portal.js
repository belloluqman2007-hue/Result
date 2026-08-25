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
      ptInitAlerts();    // NEW (pack 32): phone-alerts opt-in card
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

      /* CHANGED (pack 28 - owner: "organize it well ... parent will see
         what they are paying for and what they have paid for"): every
         charge is its own neat card - amount, paid so far, balance and a
         green progress bar; one clear total strip at the bottom. */
      var html = "";
      var tF = 0, tP = 0, tB = 0;
      viewRows.forEach(function (r) {
        var fee = Number(r.fee) || 0, paid = Number(r.paid) || 0, bal = Number(r.balance) || 0;
        tF += fee; tP += paid; tB += bal;
        var cleared = bal <= 0 && fee > 0;
        var pct = fee > 0 ? Math.min(100, Math.round((paid / fee) * 100)) : 100;
        html +=
          '<div class="ptfee-item">' +
            '<div class="ptfee-top">' +
              '<span class="ptfee-name">' + esc(r.fee_type) + "</span>" +
              '<span class="ptfee-badge ' + (cleared ? "paid" : "owing") + '">' + (cleared ? "PAID" : "OWING") + "</span>" +
            "</div>" +
            '<div class="ptfee-amts">' +
              '<span class="due">Fee: <b>' + ptNaira(fee) + "</b></span>" +
              '<span class="paidc">Paid: <b>' + ptNaira(paid) + "</b></span>" +
              '<span class="owec">Balance: <b>' + ptNaira(bal) + "</b></span>" +
            "</div>" +
            '<div class="ptfee-bar"><div class="ptfee-fill" style="width:' + pct + '%;"></div></div>' +
          "</div>";
      });
      html += '<div class="ptfee-total ' + (tB <= 0 ? "clear" : "owing") + '">' +
              "<span>TOTAL - " + esc(ptFeeTS.term) + ", " + esc(ptFeeTS.session) + "</span>" +
              "<span>" + (tB <= 0
                ? "All cleared ✓ (" + ptNaira(tP) + " paid)"
                : ptNaira(tB) + " left of " + ptNaira(tF)) + "</span></div>";
      box.innerHTML = html;
      document.getElementById("ptFeesHint").textContent =
        "What the school charges for this term, what you have paid, and what is left - for " + ptStudent.class_name + ".";
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
      // CHANGED (pack 28): same list, organized under a clear heading
      // ("what you have paid") matching the new fee cards above it.
      var html = '<div class="ptfee-hist-head">&#9989; What You Have Paid (confirmed by the school)</div>' +
        '<div class="pt-fee-row head"><span>Payment</span><span class="pt-right">Amount</span><span class="pt-right">Receipt</span></div>';
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
/* CHANGED (pack 27 - owner: "Make the chat be like Whatsapp"): the parent
   side now mirrors the new staff chat - WhatsApp wallpaper, light-green
   outgoing bubbles, white incoming bubbles, per-message clock and
   double-tick receipts (blue once the school has read the message).
   Same data, same logic - only the look changes. Styles: .wa-* in
   css/school.css. */
var ptMsgRows = [];          // NEW (pack 28): full mail, split into threads
var ptChatThread = "admin";  // NEW (pack 28): active conversation tab

/* NEW (pack 28): which conversation a message belongs to.
   Parent mail: who it was sent to; staff replies carry their thread;
   very old replies default to the office thread. */
function ptThreadOf(m) {
  if (m.thread === "teacher" || m.thread === "admin") return m.thread;
  return m.sender_type === "portal" ? (m.recipient_type === "teacher" ? "teacher" : "admin") : "admin";
}

function ptRenderMessages(rows) {
  var box = document.getElementById("ptMsgs");
  if (!box) return;
  if (rows) ptMsgRows = rows; // remember for tab switches without refetching
  var viewRows = ptMsgRows.filter(function (m) { return ptThreadOf(m) === ptChatThread; });
  if (!viewRows.length) {
    box.innerHTML = '<div class="pt-empty">' +
      (ptChatThread === "teacher"
        ? "No messages with the class teacher yet. Say salam below!"
        : "No messages with the school office yet. Say salam below!") + "</div>";
    return;
  }
  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  function dObj(v){ var d = new Date(String(v||"").replace(" ","T")); return isNaN(d.getTime()) ? null : d; }
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function clock(v){ var d=dObj(v); if(!d) return ""; var h=d.getHours(), m=d.getMinutes(); return (h<10?"0"+h:h)+":"+(m<10?"0"+m:m); }
  function dayLabel(v){ var d=dObj(v); if(!d) return ""; var now=new Date();
    if (sameDay(d,now)) return "Today";
    var y=new Date(now); y.setDate(now.getDate()-1); if (sameDay(d,y)) return "Yesterday";
    var lbl = d.getDate()+" "+MONTHS[d.getMonth()]; if (d.getFullYear()!==now.getFullYear()) lbl += " "+d.getFullYear(); return lbl; }
  function ticks(read){
    return '<svg viewBox="0 0 18 12" class="wa-tk'+(read?" read":"")+'" fill="currentColor" aria-hidden="true">'+
      '<path d="M12.6.6 5.9 7.9 4 6 2.8 7.2l3.1 3.4L13.8 1.8zM17.2.6l-6.7 7.3-.6-.6-1.1 1.2 1.7 2.1L18.4 1.8z"/></svg>'; }
  function dur(s){ s=Math.max(0,Number(s)||0); var m2=Math.floor(s/60), r=Math.floor(s%60); return m2+":"+(r<10?"0"+r:r); }
  var html = "";
  var lastDay = "";
  viewRows.forEach(function (m) { // CHANGED (pack 28): only the ACTIVE thread's messages
    var day = dayLabel(m.created_at);
    if (day && day !== lastDay) {
      html += '<div class="wa-daywrap"><span class="wa-day">' + esc(day) + "</span></div>";
      lastDay = day;
    }
    var mine = m.sender_type === "portal";
    var who = m.sender_name || "School";
    var bodyHtml;
    if (m.kind === "voice") { // NEW (pack 28): playable voice bubble
      bodyHtml = '<div class="wa-audio-wrap">' +
        '<audio controls preload="metadata" src="/voice/' + encodeURIComponent(m.id) + '"></audio>' +
        (m.duration ? '<span class="wa-audio-dur">' + esc(dur(m.duration)) + "</span>" : "") + "</div>";
    } else {
      bodyHtml = esc(m.body);
    }
    html += '<div class="wa-row ' + (mine ? "mine" : "theirs") + '">' +
      '<div class="wa-bub">' +
        (mine ? "" : '<div class="wa-who">' + esc(who) + "</div>") +
        bodyHtml +
        '<span class="wa-meta">' + esc(clock(m.created_at)) + (mine ? ticks(!!m.read_at) : "") + "</span>" +
      "</div></div>";
  });
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight; // land on the newest message, like WhatsApp
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
  // NEW (pack 28): while recording, the green plane SENDs the voice note
  // (WhatsApp behaviour) instead of the empty text box.
  if (typeof ptRecorder !== "undefined" && ptRecorder) { ptStopRec(true); return; }
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
  /* A hash makes portal sections directly reachable from separate student
     pages (for example AI Tutor -> portal.html#results). Ignore unknown
     hashes so a typo can never leave the portal with a blank main area. */
  var target = Array.prototype.find.call(document.querySelectorAll(".pt-view[data-view]"), function (view) {
    return view.getAttribute("data-view") === String(name);
  });
  if (!target) return;
  document.querySelectorAll(".pt-view").forEach(function (v) {
    v.classList.toggle("pt-view-on", v.getAttribute("data-view") === name);
  });
  document.querySelectorAll(".pt-navlink[data-view]").forEach(function (l) {
    l.classList.toggle("pt-active", l.getAttribute("data-view") === name);
  });
  document.body.classList.remove("pt-nav-open");
  window.scrollTo({ top: 0 });
  if (window.history && window.history.replaceState && location.hash !== "#" + name) {
    window.history.replaceState(null, "", location.pathname + location.search + "#" + name);
  }
  // lazy loaders: only touch the network when the parent actually opens it
  if (name === "chat") loadPortalMessages();
  if (name === "notifications") loadPortalNotifications();
  if (name === "exams") loadPortalTimetable("exam");
  if (name === "classtt") loadPortalTimetable("class");
  if (name === "attendance") ptLoadAttendance();
  if (name === "profile") ptLoadProfile();
  /* Pack 65 new features — flags managed inside each function */
  if (name === "progress")   ptLoadProgress();
  if (name === "position")   ptLoadPosition();
  if (name === "subjects")   ptLoadSubjects();
  if (name === "homework")   ptLoadHomework();
  if (name === "health")     ptLoadHealth();
  if (name === "library")    ptLoadLibrary();
  if (name === "remarks")    ptLoadRemarks();
  if (name === "transport")  ptLoadTransport();
  if (name === "gallery")    ptLoadGallery();
  if (name === "leave")      ptLoadLeave();
  if (name === "broadcasts") ptLoadBroadcasts();
  if (name === "prayer")     ptLoadPrayer();
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
  /* NEW (pack 27): WhatsApp composer behaviour - Enter sends, Shift+Enter
     adds a new line, and the box grows as you type. */
  var msgBody = document.getElementById("ptMsgBody");
  if (msgBody) {
    msgBody.addEventListener("input", function () {
      msgBody.style.height = "auto";
      msgBody.style.height = Math.min(msgBody.scrollHeight, 120) + "px";
    });
    msgBody.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        ptSendMessage(ev);
      }
    });
  }

  /* ============ NEW (pack 28): Admin / Class Teacher conversation tabs ====
     Two separate chats - switching tabs re-renders the bubbles and aims
     the composer at that side. #ptMsgTo (hidden) stays the value holder
     that ptSendMessage already used. */
  var chatTabs = document.getElementById("ptChatTabs");
  if (chatTabs) {
    chatTabs.addEventListener("click", function (ev) {
      var b = ev.target.closest(".ptchat-tab");
      if (!b) return;
      chatTabs.querySelectorAll(".ptchat-tab").forEach(function (t) { t.classList.remove("active"); });
      b.classList.add("active");
      ptChatThread = b.getAttribute("data-thread") === "teacher" ? "teacher" : "admin";
      document.getElementById("ptMsgTo").value = ptChatThread;
      ptRenderMessages(); // re-render from ptMsgRows (no refetch needed)
    });
  }

  /* ============ NEW (pack 28 - owner: "Allow voice note") ============
     Tap the mic -> talk -> tap the green plane to send (or Cancel).
     Uploads to /portal/messages/voice; audio shows as a playable bubble. */
  var ptMicBtn = document.getElementById("ptMicBtn");
  var ptRecorder = null, ptRecChunks = [], ptRecStart = 0, ptRecTimer = null, ptRecStream = null;
  var ptRecOK = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  if (ptMicBtn && !ptRecOK) { ptMicBtn.disabled = true; ptMicBtn.title = "Voice notes are not supported on this browser"; }

  function ptPickMime() {
    var c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/mpeg"];
    for (var i = 0; i < c.length; i++) {
      try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {}
    }
    return "";
  }

  if (ptMicBtn) ptMicBtn.addEventListener("click", function () {
    if (ptRecorder) { ptStopRec(true); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      ptRecStream = stream;
      ptRecChunks = [];
      var mime = ptPickMime();
      ptRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      ptRecorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) ptRecChunks.push(ev.data); };
      ptRecorder.onstop = function () {
        var blob = new Blob(ptRecChunks, { type: (ptRecorder && ptRecorder.mimeType) || "audio/webm" });
        var sendIt = ptRecorder._amsSend;
        ptRecorder = null;
        if (ptRecStream) { ptRecStream.getTracks().forEach(function (tr) { tr.stop(); }); ptRecStream = null; }
        clearInterval(ptRecTimer);
        document.getElementById("ptComposer").classList.remove("recording");
        if (sendIt) ptUploadVoice(blob, Math.round((Date.now() - ptRecStart) / 1000));
      };
      ptRecStart = Date.now();
      ptRecorder.start(250);
      document.getElementById("ptComposer").classList.add("recording");
      var timeEl = document.getElementById("ptRecTime");
      timeEl.textContent = "0:00";
      ptRecTimer = setInterval(function () {
        var s = Math.round((Date.now() - ptRecStart) / 1000);
        var mm = Math.floor(s / 60), rr = s % 60;
        timeEl.textContent = mm + ":" + (rr < 10 ? "0" + rr : rr);
        if (s >= 120) ptStopRec(true);
      }, 500);
    }).catch(function () {
      var note = document.getElementById("ptMsgNote");
      note.textContent = "Microphone blocked - allow mic access for this site and try again.";
      note.style.color = "#C0392B";
    });
  });

  function ptStopRec(andSend) {
    if (!ptRecorder) return;
    ptRecorder._amsSend = !!andSend;
    try { ptRecorder.stop(); } catch (e) {}
  }
  var ptRecCancelBtn = document.getElementById("ptRecCancel");
  if (ptRecCancelBtn) ptRecCancelBtn.addEventListener("click", function () { ptStopRec(false); });

  function ptUploadVoice(blob, seconds) {
    var note = document.getElementById("ptMsgNote");
    if (!blob || !blob.size) return;
    if (blob.size > 6 * 1024 * 1024) {
      note.textContent = "That recording is too large - keep it under 2 minutes.";
      note.style.color = "#C0392B";
      return;
    }
    note.textContent = "Sending voice note...";
    note.style.color = "";
    var fd = new FormData();
    var ext = (blob.type || "").indexOf("mp4") !== -1 ? "m4a" : ((blob.type || "").indexOf("ogg") !== -1 ? "ogg" : "webm");
    fd.append("voice", blob, "note." + ext);
    fd.append("to", ptChatThread);
    fd.append("duration", String(Math.max(1, seconds || 1)));
    fetch("/portal/messages/voice", { method: "POST", body: fd })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        note.textContent = res.d.message || (res.ok ? "Voice note sent." : "Could not send.");
        note.style.color = res.ok ? "#14532d" : "#C0392B";
        if (res.ok) loadPortalMessages();
      })
      .catch(function () {
        note.textContent = "Network error - the voice note was not sent.";
        note.style.color = "#C0392B";
      });
  }

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

/* ==========================================================================
   NEW (pack 32 - owner picked "push notifications"): parent phone alerts.
   The overview shows a gold-green card when this phone supports push:
   Enable -> permission + subscription saved on the server; the parent's
   phone then rings for results/fees/replies even with the app closed.
   ========================================================================== */
function ptInitAlerts() {
  if (!window.amsPush) return;
  var card = document.getElementById("ptAlertCard");
  var btn = document.getElementById("ptAlertBtn");
  var title = document.getElementById("ptAlertTitle");
  var sub = document.getElementById("ptAlertSub");
  var ic = document.getElementById("ptAlertIc");
  if (!card || !btn) return;

  function paint(st) {
    if (st === "on") {
      btn.className = "pt-alertcard-btn on";
      btn.textContent = "On \u2713";
      title.textContent = "Phone alerts are ON";
      sub.textContent = "This phone rings for results, payments and school replies. Tap the button to turn off.";
      ic.innerHTML = "&#128276;";
    } else if (st === "denied") {
      btn.className = "pt-alertcard-btn";
      btn.textContent = "Blocked";
      btn.disabled = true;
      title.textContent = "Notifications are blocked";
      sub.textContent = "Allow them in your phone: browser settings \u2192 Site settings \u2192 Notifications.";
    } else {
      btn.className = "pt-alertcard-btn";
      btn.textContent = "Enable";
      title.textContent = "Turn on phone alerts";
      sub.textContent = "Your phone rings the moment results are out, a payment is received, or the school replies.";
      ic.innerHTML = "&#128276;";
    }
  }

  window.amsPush.status().then(function (st) {
    if (st === "unsupported") return; // old phone/browser - keep the card hidden
    card.style.display = "block";
    paint(st);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      var turnOn = btn.textContent !== "On \u2713";
      var p = turnOn ? window.amsPush.subscribe("portal") : window.amsPush.unsubscribe("portal");
      p.then(function (st) {
        paint(st);
        if (window.amsToast) window.amsToast(st === "on" ? "Alerts ON - this phone will ring for school news \u{1F514}" : "Alerts off.", st === "on" ? "success" : "info", 4000);
      }).catch(function (e) {
        var why = e && e.amsWhy;
        if (why === "denied") paint("denied");
        else { paint("off"); if (window.amsToast) window.amsToast("Could not switch alerts - check your connection and try again.", "error", 4000); }
      }).finally(function () {
        if (btn.textContent !== "Blocked") btn.disabled = false;
      });
    });
  }).catch(function () { /* stay hidden */ });
}

/* ==========================================================================
   NEW: Attendance view for parent portal
   ========================================================================== */
var ptAttLoaded = false;

function ptLoadAttendance() {
  if (ptAttLoaded) return;
  var list = document.getElementById("ptAttList");
  var summary = document.getElementById("ptAttSummary");
  if (!list) return;
  ptAttLoaded = true;

  var timer = setTimeout(function () {
    ptAttLoaded = false; // allow retry
    if (list) list.innerHTML = '<span style="color:#9b1c1c;">⚠️ Loading took too long. Tap Attendance again to retry.</span>';
  }, 15000);

  fetch("/portal/attendance", { credentials: "same-origin" })
    .then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) {
        list.textContent = "No attendance records found yet.";
        return;
      }

      // Summary counts
      var counts = { present: 0, absent: 0, late: 0 };
      rows.forEach(function (r) { if (counts[r.status] !== undefined) counts[r.status]++; });
      var total = counts.present + counts.absent + counts.late;
      var pct = total ? Math.round((counts.present / total) * 100) : 0;

      if (summary) {
        summary.innerHTML = [
          { label: "Present", val: counts.present, color: "#14532d", bg: "#eaf3ec" },
          { label: "Absent",  val: counts.absent,  color: "#9b1c1c", bg: "#fef2f2" },
          { label: "Late",    val: counts.late,    color: "#92400e", bg: "#fffbeb" },
          { label: "Rate",    val: pct + "%",      color: "#1d4a30", bg: "#f0fdf4" }
        ].map(function (s) {
          return '<div style="flex:1; min-width:70px; background:' + s.bg + '; border-radius:10px; padding:10px 8px; text-align:center;">' +
            '<div style="font-size:20px; font-weight:800; color:' + s.color + ';">' + s.val + '</div>' +
            '<div style="font-size:11px; color:#5B6B62; font-weight:600;">' + s.label + '</div></div>';
        }).join("");
      }

      // Table
      var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      var html = '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
        '<thead><tr style="background:#f0fdf4;">' +
        '<th style="padding:7px 8px; text-align:left; color:#14532d; font-weight:700;">Date</th>' +
        '<th style="padding:7px 8px; text-align:left; color:#14532d; font-weight:700;">Status</th>' +
        '<th style="padding:7px 8px; text-align:left; color:#14532d; font-weight:700;">Class</th>' +
        '</tr></thead><tbody>';

      var statusColor = { present: "#14532d", absent: "#9b1c1c", late: "#92400e" };
      var statusBg    = { present: "#eaf3ec", absent: "#fef2f2", late: "#fffbeb" };
      var statusLabel = { present: "✓ Present", absent: "✗ Absent", late: "⏰ Late" };

      rows.forEach(function (r, i) {
        var d = new Date(r.att_date);
        var dateStr = d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
        var st = r.status || "present";
        html += '<tr style="background:' + (i % 2 === 0 ? "#fff" : "#fafafa") + ';">' +
          '<td style="padding:7px 8px;">' + dateStr + '</td>' +
          '<td style="padding:7px 8px;"><span style="background:' + (statusBg[st] || "#eee") + '; color:' + (statusColor[st] || "#333") + '; border-radius:6px; padding:2px 8px; font-size:12px; font-weight:700;">' + (statusLabel[st] || st) + '</span></td>' +
          '<td style="padding:7px 8px; color:#5B6B62;">' + (r.class_name || "-") + '</td>' +
          '</tr>';
      });

      list.innerHTML = html + "</tbody></table>";
    })
    .catch(function () {
      clearTimeout(timer);
      ptAttLoaded = false; // reset so user can retry
      if (list) list.innerHTML = '<span style="color:#9b1c1c;">⚠️ Could not load attendance. Tap Attendance again to retry.</span>';
    });
}

/* ==========================================================================
   NEW: Student profile view for parent portal
   ========================================================================== */
var ptProfileLoaded = false;

function ptLoadProfile() {
  if (ptProfileLoaded) return;
  var content = document.getElementById("ptProfileContent");
  if (!content) return;
  ptProfileLoaded = true;

  var timer = setTimeout(function () {
    ptProfileLoaded = false;
    if (content) content.innerHTML = '<span style="color:#9b1c1c;">⚠️ Loading too slow. Tap My Profile again to retry.</span>';
  }, 15000);

  fetch("/portal/me", { credentials: "same-origin" })
    .then(function (r) { clearTimeout(timer); return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.loggedIn) {
        ptProfileLoaded = false;
        if (content) content.innerHTML = '<span style="color:#9b1c1c;">⚠️ Session expired. Please log out and log in again.</span>';
        return;
      }
      var stu = d.student || d;
      var photoSrc = stu.photo_path ? "/" + stu.photo_path : "images/default.png";
      content.innerHTML =
        '<img src="' + photoSrc + '" onerror="this.src=\'images/default.png\'" ' +
        'style="width:90px; height:90px; border-radius:50%; object-fit:cover; border:3px solid #14532d; margin-bottom:12px;">' +
        '<h2 style="font-size:18px; font-weight:800; color:#14291c; margin:0 0 4px;">' + (stu.full_name || "-") + '</h2>' +
        '<p style="color:#5B6B62; font-size:13px; margin:0 0 14px;">Admission No: <b>' + (stu.student_id || "-") + '</b></p>' +
        '<div style="display:grid; gap:8px; text-align:left;">' +
        ptProfileRow("Class", stu.class_name) +
        ptProfileRow("Gender", stu.gender) +
        ptProfileRow("Date of Birth", stu.date_of_birth ? new Date(stu.date_of_birth).toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" }) : "-") +
        ptProfileRow("Parent / Guardian", stu.parent_name) +
        ptProfileRow("Parent Phone", stu.parent_phone) +
        ptProfileRow("Address", stu.address) +
        "</div>";

      // Pre-fill contact form
      var pn = document.getElementById("ptParentName");
      var pp = document.getElementById("ptParentPhone");
      var pa = document.getElementById("ptAddress");
      if (pn) pn.value = stu.parent_name || "";
      if (pp) pp.value = stu.parent_phone || "";
      if (pa) pa.value = stu.address || "";
    })
    .catch(function () {
      clearTimeout(timer);
      ptProfileLoaded = false;
      if (content) content.innerHTML = '<span style="color:#9b1c1c;">⚠️ Could not load profile. Tap My Profile again to retry.</span>';
    });
}

function ptProfileRow(label, value) {
  if (!value) return "";
  return '<div style="background:#f7faf7; border-radius:8px; padding:8px 11px;">' +
    '<span style="font-size:11px; font-weight:700; color:#3a5441; text-transform:uppercase; letter-spacing:.04em;">' + label + '</span>' +
    '<div style="font-size:14px; color:#14291c; font-weight:600; margin-top:2px;">' + value + '</div>' +
    '</div>';
}

function ptSaveProfile() {
  var pn = (document.getElementById("ptParentName")  || {}).value || "";
  var pp = (document.getElementById("ptParentPhone") || {}).value || "";
  var pa = (document.getElementById("ptAddress")     || {}).value || "";
  var msg = document.getElementById("ptProfileMsg");

  fetch("/portal/profile", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_name: pn, parent_phone: pp, address: pa })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (msg) { msg.textContent = d.message || "Saved!"; msg.style.color = "#14532d"; }
      setTimeout(function () { if (msg) msg.textContent = ""; }, 3000);
    })
    .catch(function () {
      if (msg) { msg.textContent = "Could not save. Check your connection."; msg.style.color = "#9b1c1c"; }
    });
}

/* ==========================================================================
   PACK 65 — ALL NEW PORTAL FEATURES
   ========================================================================== */

/* ── lazy-load flags ── */
var ptProgressLoaded=false, ptPositionLoaded=false, ptSubjectsLoaded=false,
    ptHomeworkLoaded=false, ptHealthLoaded=false, ptLibraryLoaded=false,
    ptRemarksLoaded=false, ptTransportLoaded=false,
    ptGalleryLoaded=false, ptLeaveLoaded=false, ptBroadcastsLoaded=false,
    ptPrayerLoaded=false;

/* ── hook into ptShowView ── already patched above, add remaining views ── */
var _ptShowViewOrig = window.ptShowViewExtra || function(){};
window.ptShowViewExtra = function(name) {
  /* flags are managed inside each function — call unconditionally,
     each loader decides whether it needs to run */
  if (name==="progress")   ptLoadProgress();
  if (name==="position")   ptLoadPosition();
  if (name==="subjects")   ptLoadSubjects();
  if (name==="homework")   ptLoadHomework();
  if (name==="health")     ptLoadHealth();
  if (name==="library")    ptLoadLibrary();
  if (name==="remarks")    ptLoadRemarks();
  if (name==="transport")  ptLoadTransport();
  if (name==="gallery")    ptLoadGallery();
  if (name==="leave")      ptLoadLeave();
  if (name==="broadcasts") ptLoadBroadcasts();
  if (name==="prayer")     ptLoadPrayer();
  _ptShowViewOrig(name);
};

/* ── patch ptShowView to call extra ── */
(function(){
  var orig = window.ptShowView;
  if (orig) window.ptShowView = function(name) { orig(name); window.ptShowViewExtra(name); };
})();

/* ====================================================================
   PROGRESS CHART
   ==================================================================== */
var ptProgressData = [];

function ptLoadProgress() {
  if (ptProgressLoaded) return; ptProgressLoaded = true;
  fetch("/portal/progress", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(rows) {
      ptProgressData = rows || [];
      // Populate subject dropdown
      var sel = document.getElementById("ptProgressSubject");
      if (sel) {
        var subjects = [...new Set(rows.map(function(r){ return r.subject; }))].sort();
        sel.innerHTML = '<option value="">All Subjects</option>' +
          subjects.map(function(s){ return '<option value="'+s+'">'+s+'</option>'; }).join("");
      }
      ptRenderChart();
    })
    .catch(function(){ document.getElementById("ptProgressEmpty").style.display="block"; });
}

function ptRenderChart() {
  var canvas = document.getElementById("ptProgressCanvas");
  var empty  = document.getElementById("ptProgressEmpty");
  var sel    = document.getElementById("ptProgressSubject");
  if (!canvas) return;
  var filter = sel ? sel.value : "";
  var rows = filter ? ptProgressData.filter(function(r){ return r.subject===filter; }) : ptProgressData;
  if (!rows.length) { canvas.style.display="none"; if(empty) empty.style.display="block"; return; }
  canvas.style.display="block"; if(empty) empty.style.display="none";

  // Group by term+session label
  var labels = [], dataMap = {};
  rows.forEach(function(r) {
    var lbl = r.term + " " + r.session;
    if (!labels.includes(lbl)) labels.push(lbl);
    if (!dataMap[r.subject]) dataMap[r.subject] = {};
    var prev = dataMap[r.subject][lbl];
    dataMap[r.subject][lbl] = prev ? Math.max(prev, Number(r.total)) : Number(r.total);
  });

  var subjects = Object.keys(dataMap);
  var colors = ["#2f7a4e","#d9a419","#1d4a30","#a0522d","#4a7c59","#8b6914","#3a5441","#c75"];
  var ctx = canvas.getContext("2d");
  var W = canvas.offsetWidth || 340;
  canvas.width = W; canvas.height = Math.min(260, W * 0.7);
  var H = canvas.height;
  var padL=38, padR=14, padT=16, padB=40;
  var chartW = W-padL-padR, chartH = H-padT-padB;
  ctx.clearRect(0,0,W,H);

  // Find max
  var maxVal = 100;
  subjects.forEach(function(s){ labels.forEach(function(l){ var v=dataMap[s][l]; if(v && v>maxVal) maxVal=v; }); });
  maxVal = Math.ceil(maxVal/10)*10;

  // Grid lines
  ctx.strokeStyle="#e8f0e9"; ctx.lineWidth=1;
  for (var gi=0; gi<=5; gi++) {
    var gy = padT + chartH - (gi/5)*chartH;
    ctx.beginPath(); ctx.moveTo(padL,gy); ctx.lineTo(padL+chartW,gy); ctx.stroke();
    ctx.fillStyle="#7d9488"; ctx.font="10px sans-serif"; ctx.textAlign="right";
    ctx.fillText(Math.round(gi/5*maxVal), padL-4, gy+3);
  }

  // Bars (grouped)
  var barGroup = chartW / Math.max(labels.length, 1);
  var barW = Math.max(6, barGroup / Math.max(subjects.length,1) - 2);

  labels.forEach(function(lbl, li) {
    var gx = padL + li * barGroup;
    subjects.forEach(function(subj, si) {
      var val = dataMap[subj][lbl] || 0;
      var bh = (val/maxVal)*chartH;
      var bx = gx + si*(barW+2) + (barGroup - subjects.length*(barW+2))/2;
      var by = padT + chartH - bh;
      ctx.fillStyle = colors[si % colors.length];
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx,by,barW,bh,2) : ctx.rect(bx,by,barW,bh);
      ctx.fill();
    });
    // X label
    ctx.fillStyle="#3a5441"; ctx.font="9px sans-serif"; ctx.textAlign="center";
    var shortLbl = lbl.length>14 ? lbl.slice(0,13)+"…" : lbl;
    ctx.fillText(shortLbl, gx+barGroup/2, H-padB+14);
  });

  // Legend (small)
  if (subjects.length>1) {
    var lx=padL, ly=H-padB+26;
    subjects.forEach(function(s,i){
      ctx.fillStyle=colors[i%colors.length];
      ctx.fillRect(lx,ly-7,10,8);
      ctx.fillStyle="#1f2d26"; ctx.font="9px sans-serif"; ctx.textAlign="left";
      var tw = ctx.measureText(s).width;
      ctx.fillText(s,lx+13,ly); lx+=tw+22;
      if(lx>W-40){ lx=padL; ly+=14; }
    });
  }
}

/* ====================================================================
   CLASS POSITION
   ==================================================================== */
function ptLoadPosition() {
  if (ptPositionLoaded) return; ptPositionLoaded = true;
  var box = document.getElementById("ptPositionList");
  if (!box) return;
  fetch("/portal/position", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(rows) {
      if (!rows.length) { box.innerHTML='<p style="color:#5B6B62;">No position data yet.</p>'; return; }
      var medals = ["🥇","🥈","🥉"];
      box.innerHTML = rows.map(function(r) {
        var medal = r.position<=3 ? medals[r.position-1] : "🏅";
        var suffix = r.position===1?"st":r.position===2?"nd":r.position===3?"rd":"th";
        var pct = Math.round((1-r.position/r.total)*100);
        var color = r.position===1?"#d9a419":r.position<=3?"#2f7a4e":"#3a5441";
        return '<div style="background:#f7faf7;border:1.5px solid #d3e8d6;border-radius:12px;padding:14px 16px;margin-bottom:10px;">' +
          '<div style="font-size:12px;color:#7d9488;font-weight:600;">' + r.term + ' — ' + r.session + '</div>' +
          '<div style="display:flex;align-items:center;gap:12px;margin-top:8px;">' +
          '<span style="font-size:36px;">' + medal + '</span>' +
          '<div>' +
          '<div style="font-size:24px;font-weight:900;color:'+color+';">' + r.position + '<sup>'+suffix+'</sup></div>' +
          '<div style="font-size:12px;color:#5B6B62;">out of ' + r.total + ' students · top ' + pct + '%</div>' +
          '</div></div></div>';
      }).join("");
    })
    .catch(function(){ if(box) box.textContent="Could not load position data."; });
}

/* ====================================================================
   SUBJECTS LIST
   ==================================================================== */
function ptLoadSubjects() {
  if (ptSubjectsLoaded) return; ptSubjectsLoaded = true;
  var box = document.getElementById("ptSubjectsList");
  if (!box) return;
  fetch("/portal/subjects", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(subs) {
      if (!subs.length) { box.textContent="No subjects found for your class."; return; }
      box.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;">' +
        subs.map(function(s,i) {
          var emojis=["📖","✏️","🔢","🌍","🔬","🕌","🌿","🎨","📐","🧪","📝","🌙"];
          return '<div style="background:linear-gradient(135deg,#eaf3ec,#f7faf7);border:1.5px solid #d3e8d6;border-radius:10px;padding:12px;text-align:center;">' +
            '<div style="font-size:22px;margin-bottom:4px;">' + (emojis[i%emojis.length]) + '</div>' +
            '<div style="font-size:13px;font-weight:700;color:#14291c;">' + s + '</div></div>';
        }).join("") + '</div>';
    })
    .catch(function(){ if(box) box.textContent="Could not load subjects."; });
}

/* ====================================================================
   HOMEWORK
   ==================================================================== */
function ptLoadHomework() {
  if (ptHomeworkLoaded) return; ptHomeworkLoaded = true;
  var box = document.getElementById("ptHomeworkList");
  if (!box) return;
  fetch("/portal/homework", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(rows) {
      if (!rows.length) { box.innerHTML='<p style="color:#5B6B62;text-align:center;padding:12px;">No homework assigned yet. &#127881;</p>'; return; }
      var now = new Date();
      box.innerHTML = rows.map(function(hw) {
        var due = hw.due_date ? new Date(hw.due_date) : null;
        var overdue = due && due < now;
        var dueStr = due ? due.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "No due date";
        var dueColor = overdue ? "#9b1c1c" : due ? "#92400e" : "#7d9488";
        return '<div style="background:#f7faf7;border:1.5px solid #d3e8d6;border-radius:11px;padding:13px 14px;margin-bottom:10px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
          '<div><div style="font-size:14px;font-weight:800;color:#14291c;">' + hw.title + '</div>' +
          '<div style="font-size:12px;color:#3a5441;font-weight:600;margin-top:2px;">📚 ' + hw.subject + '</div></div>' +
          '<span style="font-size:11px;background:#eaf3ec;color:'+dueColor+';border-radius:6px;padding:3px 8px;font-weight:700;white-space:nowrap;">' +
          (overdue?"⚠️ ":"📅 ")+dueStr+'</span></div>' +
          (hw.description ? '<p style="font-size:13px;color:#3a5441;margin:8px 0 0;line-height:1.5;">' + hw.description + '</p>' : '') +
          '<div style="font-size:11px;color:#99b09e;margin-top:6px;">Posted by ' + (hw.posted_by||"School") + '</div></div>';
      }).join("");
    })
    .catch(function(){ if(box) box.textContent="Could not load homework."; });
}

/* ====================================================================
   HEALTH RECORD
   ==================================================================== */
function ptLoadHealth() {
  if (ptHealthLoaded) return; ptHealthLoaded = true;
  var box = document.getElementById("ptHealthContent");
  if (!box) return;
  fetch("/portal/health", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(h) {
      var hasData = h.blood_group||h.genotype||h.height_cm||h.weight_kg||h.allergies||h.medical_conditions||h.current_medications||h.emergency_contact_name||h.emergency_contact_phone||h.doctor_name||h.insurance_no||h.special_needs||h.notes||h.last_checkup;
      if (!hasData) {
        box.innerHTML='<p style="color:#5B6B62;text-align:center;">No health record on file. Contact the school to add your child\'s medical information.</p>';
        return;
      }
      var measurements=[];
      if (h.height_cm) measurements.push(esc(h.height_cm)+" cm");
      if (h.weight_kg) measurements.push(esc(h.weight_kg)+" kg");
      if (h.bmi) measurements.push("BMI "+esc(h.bmi));
      var rows = [
        {icon:"🩸",label:"Blood Group",val:h.blood_group},
        {icon:"🧬",label:"Genotype",val:h.genotype},
        {icon:"📏",label:"Measurements",val:measurements.join(" · ")},
        {icon:"🩺",label:"Last Check-up",val:h.last_checkup ? String(h.last_checkup).slice(0,10) : ""},
        {icon:"💊",label:"Current Medications",val:h.current_medications},
        {icon:"⚠️",label:"Allergies",val:h.allergies},
        {icon:"🏥",label:"Medical Conditions",val:h.medical_conditions},
        {icon:"♿",label:"Special Needs",val:h.special_needs},
        {icon:"👨‍⚕️",label:"Family Doctor",val:[h.doctor_name,h.doctor_phone].filter(Boolean).join(" · ")},
        {icon:"🪪",label:"NHIS / Insurance",val:h.insurance_no},
        {icon:"🚨",label:"Emergency Contact",val:h.emergency_contact_name},
        {icon:"📞",label:"Emergency Phone",val:h.emergency_contact_phone},
        {icon:"📋",label:"Notes",val:h.notes}
      ].filter(function(r){ return r.val; });
      box.innerHTML='<div style="display:grid;gap:9px;">'+
        rows.map(function(r){
          return '<div style="background:#f7faf7;border:1.5px solid #d3e8d6;border-radius:9px;padding:10px 13px;display:flex;gap:10px;align-items:flex-start;">' +
            '<span style="font-size:20px;flex:0 0 auto;">' + r.icon + '</span>' +
            '<div><div style="font-size:11px;font-weight:700;color:#7d9488;text-transform:uppercase;letter-spacing:.04em;">' + r.label + '</div>' +
            '<div style="font-size:14px;color:#14291c;font-weight:600;margin-top:2px;">' + r.val + '</div></div></div>';
        }).join("") + '</div>';
    })
    .catch(function(){ if(box) box.textContent="Could not load health record."; });
}

/* ====================================================================
   LIBRARY BOOKS
   ==================================================================== */
function ptLoadLibrary() {
  if (ptLibraryLoaded) return; ptLibraryLoaded = true;
  var box = document.getElementById("ptLibraryList");
  if (!box) return;
  fetch("/portal/library", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(loans) {
      if (!loans || !loans.length) {
        box.innerHTML='<div style="text-align:center;padding:14px;"><div style="font-size:48px;margin-bottom:8px;">📚</div><p style="color:#5B6B62;">No library books issued yet. Books you borrow from the school library will appear here.</p></div>';
        return;
      }
      box.innerHTML='<div style="display:grid;gap:9px;">' +
        loans.map(function(l) {
          var status;
          if (l.returned_at) { status = '<span style="background:#eaf3ec;color:#14532d;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;">Returned ' + esc(String(l.returned_at).slice(0,10)) + '</span>'; }
          else if (l.due_date && String(l.due_date) < new Date().toISOString().slice(0,10)) { status = '<span style="background:#fdeaea;color:#9b1c1c;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;">⚠️ Overdue</span>'; }
          else { status = '<span style="background:#e8f1ff;color:#1d4a30;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;">📖 On loan</span>'; }
          return '<div style="background:#f7faf7;border:1.5px solid #d3e8d6;border-radius:9px;padding:10px 13px;display:flex;gap:10px;align-items:flex-start;">' +
            '<span style="font-size:20px;flex:0 0 auto;">📕</span>' +
            '<div style="flex:1;"><div style="font-size:14px;color:#14291c;font-weight:700;">' + esc(l.title) + '</div>' +
            '<div style="font-size:12px;color:#7d9488;">' + (l.author ? esc(l.author) + ' · ' : '') + 'issued ' + esc(String(l.issued_at).slice(0,10)) +
            (l.due_date ? ' · due ' + esc(String(l.due_date).slice(0,10)) : '') + '</div></div>' + status + '</div>';
        }).join("") + '</div>';
    })
    .catch(function(){ if(box) box.textContent="Could not load library records."; });
}

/* ====================================================================
   TEACHER COMMENTS (term remarks)
   ==================================================================== */
function ptLoadRemarks() {
  if (ptRemarksLoaded) return; ptRemarksLoaded = true;
  var box = document.getElementById("ptRemarksList");
  if (!box) return;
  fetch("/portal/remarks", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(rows) {
      if (!rows || !rows.length) {
        box.innerHTML='<div style="text-align:center;padding:14px;"><div style="font-size:48px;margin-bottom:8px;">💬</div><p style="color:#5B6B62;">No teacher comments yet. Comments written by your child\'s teacher for each term will appear here.</p></div>';
        return;
      }
      box.innerHTML='<div style="display:grid;gap:9px;">' +
        rows.map(function(r) {
          var comment = r.teacher_remark || r.principal_remark;
          return '<div style="background:#f7faf7;border:1.5px solid #d3e8d6;border-radius:9px;padding:11px 13px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<b style="font-size:14px;color:#14291c;">' + esc(r.term) + ' · ' + esc(r.session) + '</b>' +
            '<span style="font-size:11px;color:#7d9488;">' + esc(String(r.updated_at||"").slice(0,10)) + '</span></div>' +
            (r.teacher_remark ? '<div style="margin-top:8px;"><span style="font-size:11px;font-weight:700;color:#7d9488;text-transform:uppercase;">Class Teacher</span><p style="margin:3px 0 0;font-size:14px;color:#3a5441;line-height:1.5;">' + esc(r.teacher_remark) + '</p></div>' : '') +
            (r.principal_remark ? '<div style="margin-top:8px;"><span style="font-size:11px;font-weight:700;color:#7d9488;text-transform:uppercase;">Principal</span><p style="margin:3px 0 0;font-size:14px;color:#3a5441;line-height:1.5;">' + esc(r.principal_remark) + '</p></div>' : '') +
            (comment ? '' : '<p style="margin:6px 0 0;font-size:13px;color:#99b09e;">No remarks written for this term yet.</p>') +
            '</div>';
        }).join("") + '</div>';
    })
    .catch(function(){ if(box) box.textContent="Could not load teacher comments."; });
}

/* ====================================================================
   TRANSPORT
   ==================================================================== */
function ptLoadTransport() {
  if (ptTransportLoaded) return; ptTransportLoaded = true;
  var box = document.getElementById("ptTransportContent");
  if (!box) return;
  fetch("/portal/transport", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(t) {
      if (!t) {
        box.innerHTML='<div style="text-align:center;padding:14px;"><div style="font-size:48px;margin-bottom:8px;">🚶</div><p style="color:#5B6B62;">No transport assigned. Contact school if your child uses the school bus.</p></div>';
        return;
      }
      var fields=[
        {icon:"🚌",label:"Route",val:t.route_name},
        {icon:"🔢",label:"Bus Number",val:t.bus_number},
        {icon:"👨‍✈️",label:"Driver Name",val:t.driver_name},
        {icon:"📞",label:"Driver Phone",val:t.driver_phone},
        {icon:"🌅",label:"Morning Pick-up",val:t.pickup_time},
        {icon:"🌆",label:"Afternoon Drop-off",val:t.dropoff_time},
        {icon:"📍",label:"Your Pick-up Point",val:t.pickup_point},
        {icon:"📋",label:"Notes",val:t.route_notes||t.assignment_notes}
      ].filter(function(f){ return f.val; });
      box.innerHTML='<div style="display:grid;gap:9px;">'+
        fields.map(function(f){
          return '<div style="background:#f7faf7;border:1.5px solid #d3e8d6;border-radius:9px;padding:10px 13px;display:flex;gap:10px;align-items:center;">' +
            '<span style="font-size:22px;flex:0 0 auto;">' + f.icon + '</span>' +
            '<div><div style="font-size:11px;font-weight:700;color:#7d9488;text-transform:uppercase;">' + f.label + '</div>' +
            '<div style="font-size:14px;font-weight:700;color:#14291c;">' + f.val + '</div></div></div>';
        }).join("") + '</div>';
    })
    .catch(function(){ if(box) box.textContent="Could not load transport info."; });
}

/* ====================================================================
   GALLERY
   ==================================================================== */
function ptLoadGallery() {
  if (ptGalleryLoaded) return; ptGalleryLoaded = true;
  var grid = document.getElementById("ptGalleryGrid");
  if (!grid) return;
  fetch("/portal/gallery", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(photos) {
      if (!photos.length) {
        grid.innerHTML='<div style="text-align:center;padding:20px;"><div style="font-size:48px;margin-bottom:8px;">📷</div><p style="color:#5B6B62;">No photos uploaded yet.</p></div>';
        return;
      }
      grid.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;">'+
        photos.map(function(p){
          return '<div style="border-radius:10px;overflow:hidden;background:#1f2d26;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12);" onclick="ptOpenLightbox('+p.id+',\''+encodeURIComponent(p.title||'')+'\',\''+encodeURIComponent(p.caption||'')+'\')">'+
            '<img src="/portal/gallery/image/'+p.id+'" alt="'+p.title+'" style="width:100%;aspect-ratio:1;object-fit:cover;display:block;" loading="lazy">'+
            '<div style="padding:5px 7px;"><div style="font-size:11px;font-weight:700;color:#eaf3ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+(p.title||'Photo')+'</div></div></div>';
        }).join("") + '</div>';
    })
    .catch(function(){ if(grid) grid.textContent="Could not load gallery."; });
}

function ptOpenLightbox(id, title, caption) {
  var lb = document.getElementById("ptLightbox");
  var img = document.getElementById("ptLightboxImg");
  var cap = document.getElementById("ptLightboxCaption");
  if (!lb||!img) return;
  img.src="/portal/gallery/image/"+id;
  if(cap) cap.textContent=decodeURIComponent(caption)||decodeURIComponent(title)||"";
  lb.style.display="flex";
}

/* ====================================================================
   LEAVE REQUEST
   ==================================================================== */
function ptLoadLeave() {
  var box = document.getElementById("ptLeaveHistory");
  if (!box) return;
  var today = new Date().toISOString().slice(0,10);
  var fromEl=document.getElementById("ptLeaveFrom"), toEl=document.getElementById("ptLeaveTo");
  if(fromEl && !fromEl.value) fromEl.value=today;
  if(toEl && !toEl.value) toEl.value=today;

  fetch("/portal/leave", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(rows) {
      if (!rows.length) { box.innerHTML='<p style="color:#5B6B62;text-align:center;">No leave requests yet.</p>'; return; }
      var statusColors={approved:"#14532d",rejected:"#9b1c1c",pending:"#92400e"};
      var statusBg={approved:"#eaf3ec",rejected:"#fef2f2",pending:"#fffbeb"};
      box.innerHTML=rows.map(function(r){
        var st=r.status||"pending";
        return '<div style="background:#f7faf7;border:1.5px solid #d3e8d6;border-radius:10px;padding:12px 14px;margin-bottom:8px;">'+
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'+
          '<div style="font-size:13px;font-weight:700;color:#14291c;">'+new Date(r.from_date).toLocaleDateString("en-GB",{day:"numeric",month:"short"})+" — "+new Date(r.to_date).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})+'</div>'+
          '<span style="background:'+(statusBg[st]||"#eee")+';color:'+(statusColors[st]||"#333")+';border-radius:6px;padding:2px 9px;font-size:11px;font-weight:800;text-transform:uppercase;">'+st+'</span></div>'+
          '<p style="font-size:13px;color:#3a5441;margin:6px 0 0;line-height:1.4;">'+r.reason+'</p>'+
          (r.admin_note?'<p style="font-size:12px;color:#5B6B62;margin:4px 0 0;font-style:italic;">School note: '+r.admin_note+'</p>':'')+
          '</div>';
      }).join("");
    })
    .catch(function(){ if(box) box.textContent="Could not load requests."; });
}

function ptSubmitLeave() {
  var reason=document.getElementById("ptLeaveReason").value.trim();
  var from=document.getElementById("ptLeaveFrom").value;
  var to=document.getElementById("ptLeaveTo").value;
  var msg=document.getElementById("ptLeaveMsg");
  if(!reason||!from||!to){if(msg){msg.textContent="Please fill in all fields.";msg.style.color="#9b1c1c";}return;}
  fetch("/portal/leave",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:reason,from_date:from,to_date:to})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(msg){msg.textContent=d.message||"Submitted.";msg.style.color="#14532d";}
      document.getElementById("ptLeaveReason").value="";
      ptLeaveLoaded=false; ptLoadLeave();
      setTimeout(function(){if(msg)msg.textContent="";},4000);
    })
    .catch(function(){if(msg){msg.textContent="Network error.";msg.style.color="#9b1c1c";}});
}

/* ====================================================================
   BROADCASTS
   ==================================================================== */
function ptLoadBroadcasts() {
  if (ptBroadcastsLoaded) return; ptBroadcastsLoaded = true;
  var box = document.getElementById("ptBroadcastsList");
  if (!box) return;
  fetch("/portal/broadcasts", { credentials:"same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(rows) {
      if (!rows.length) { box.innerHTML='<div style="text-align:center;padding:16px;"><div style="font-size:40px;margin-bottom:8px;">📭</div><p style="color:#5B6B62;">No announcements yet.</p></div>'; return; }
      box.innerHTML=rows.map(function(b){
        var dt=new Date(b.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});
        return '<div style="background:'+(b.pinned?"#fffbeb":"#f7faf7")+';border:1.5px solid '+(b.pinned?"#f3c94e":"#d3e8d6")+';border-radius:11px;padding:14px;margin-bottom:10px;">'+
          (b.pinned?'<div style="font-size:11px;font-weight:800;color:#92400e;margin-bottom:4px;">📌 PINNED</div>':'')+
          '<div style="font-size:15px;font-weight:800;color:#14291c;margin-bottom:6px;">'+b.title+'</div>'+
          '<p style="font-size:13.5px;color:#3a5441;line-height:1.55;margin:0 0 8px;">'+b.message+'</p>'+
          '<div style="font-size:11px;color:#99b09e;">'+dt+' · '+b.posted_by+'</div></div>';
      }).join("");
    })
    .catch(function(){ if(box) box.textContent="Could not load announcements."; });
}

/* ====================================================================
   PRAYER TIMES (Aladhan API — free, no key)
   ==================================================================== */
function ptLoadPrayer() {
  if (ptPrayerLoaded) return; ptPrayerLoaded = true;
  var box = document.getElementById("ptPrayerTimes");
  var dateBox = document.getElementById("ptPrayerDate");
  if (!box) return;
  var today = new Date();
  var url = "https://api.aladhan.com/v1/timingsByCity?city=Ijebu-Ode&country=Nigeria&method=2&date=" +
    today.getDate()+"-"+(today.getMonth()+1)+"-"+today.getFullYear();
  fetch(url)
    .then(function(r){ return r.json(); })
    .then(function(d) {
      var t = d.data && d.data.timings;
      if (!t) throw new Error("No data");
      var hijri = d.data.date && d.data.date.hijri;
      if (dateBox && hijri) {
        dateBox.textContent = today.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) +
          " | " + hijri.day + " " + (hijri.month&&hijri.month.en||"") + " " + hijri.year + " AH";
      }
      var prayers = [
        {name:"Fajr",time:t.Fajr,icon:"🌙"},
        {name:"Sunrise",time:t.Sunrise,icon:"🌅"},
        {name:"Dhuhr",time:t.Dhuhr,icon:"☀️"},
        {name:"Asr",time:t.Asr,icon:"🌤"},
        {name:"Maghrib",time:t.Maghrib,icon:"🌆"},
        {name:"Isha",time:t.Isha,icon:"🌙"}
      ];
      var nowH=today.getHours(), nowM=today.getMinutes(), nowMins=nowH*60+nowM;
      var nextPrayer = null;
      prayers.forEach(function(p){
        var parts=(p.time||"00:00").split(":"); var pm=parseInt(parts[0])*60+parseInt(parts[1]);
        p.mins=pm; if(!nextPrayer && pm>nowMins) nextPrayer=p.name;
      });
      box.innerHTML='<div style="display:grid;gap:8px;">'+
        prayers.map(function(p){
          var isNext=p.name===nextPrayer;
          return '<div style="background:'+(isNext?"linear-gradient(135deg,#1d4a30,#2f7a4e)":"#f7faf7")+';border:1.5px solid '+(isNext?"#1d4a30":"#d3e8d6")+';border-radius:10px;padding:12px 15px;display:flex;justify-content:space-between;align-items:center;">'+
            '<div style="display:flex;align-items:center;gap:10px;">'+
            '<span style="font-size:22px;">'+p.icon+'</span>'+
            '<div><div style="font-size:14px;font-weight:800;color:'+(isNext?"#fff":"#14291c")+';">'+p.name+'</div>'+
            (isNext?'<div style="font-size:10px;color:#a8d5b5;font-weight:700;">NEXT PRAYER</div>':'')+
            '</div></div>'+
            '<div style="font-size:18px;font-weight:900;color:'+(isNext?"#f3c94e":"#14532d")+';">'+p.time+'</div></div>';
        }).join("")+'</div>';
    })
    .catch(function(){
      if(box) box.innerHTML='<div style="text-align:center;padding:16px;color:#5B6B62;"><div style="font-size:32px;margin-bottom:8px;">🕌</div>Could not load prayer times. Check your connection.</div>';
    });
}
