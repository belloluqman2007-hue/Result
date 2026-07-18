/* ==========================================================================
   NEW FILE (pack 13) - js/finance.js
   Finance module: fee structure per class, fee payments per student,
   expenses, and an expected/received/outstanding summary per term.
   All endpoints were created in pack 13 - nothing existing is touched.
   ========================================================================== */
"use strict";

var finTab = "fees";
var finStudents = []; // current class roster for payments
// NEW (pack 14): last loaded payment rows + selected student meta for
// receipts / list PDF / delete.
var finPayRows = [];
var finPayBalance = null;

// NEW (pack 14): fill a session datalist from the sessions the admin
// created (School Settings page). Falls back silently to the HTML options.
function fillSessionList(listId, inputId) {
  fetch("/sessions").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    var list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = "";
    rows.forEach(function (row) {
      var opt = document.createElement("option");
      opt.value = row.session;
      opt.textContent = row.session + (Number(row.is_current) === 1 ? " (current)" : "");
      list.appendChild(opt);
    });
    // default the input to the current session the admin set
    var cur = rows.find(function (r2) { return Number(r2.is_current) === 1; });
    if (cur && inputId) document.getElementById(inputId).value = cur.session;
  }).catch(function () { /* keep HTML defaults */ });
}

function finNotify(text, ok) {
  var msg = document.getElementById("finMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function naira(n) {
  var v = Number(n) || 0;
  return "\u20A6" + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function finTermSession() {
  return {
    term: document.getElementById("finTerm").value,
    session: document.getElementById("finSession").value.trim()
  };
}

function finSwitchTab(name, btn) {
  finTab = name;
  document.querySelectorAll(".mg-tab").forEach(function (t) { t.classList.remove("active"); });
  document.querySelectorAll(".mg-panel").forEach(function (p) { p.classList.remove("active"); });
  btn.classList.add("active");
  document.getElementById("finPanel" + name.charAt(0).toUpperCase() + name.slice(1)).classList.add("active");
}

function finReloadTab() {
  if (finTab === "fees") loadFeeStructure();
  else if (finTab === "pay") loadPayStudents();
  else if (finTab === "exp") loadExpenses();
  else loadSummary();
}

function initFinance() {
  var d = new Date();
  var today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  document.getElementById("expDate").value = today;

  fetch("/classes")
    .then(function (r) { return r.json(); })
    .then(function (classes) {
      var sel = document.getElementById("payClass");
      sel.innerHTML = '<option value="">Select Class</option>';
      (classes || []).forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c.class_name;
        opt.textContent = c.class_name;
        sel.appendChild(opt);
      });
      loadExpenses();
    })
    .catch(function () { /* leave defaults */ });

  document.getElementById("payStudent").addEventListener("change", loadStudentPayments);
  fillSessionList("finSessionList", "finSession"); // NEW (pack 14)
}

/* ------------------------------ fee structure ------------------------ */
function loadFeeStructure() {
  var ts = finTermSession();
  if (!ts.session) { finNotify("Type the session first (e.g. 2026/2027).", false); return; }
  var tbody = document.querySelector("#feeTable tbody");
  tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#5B6B62;">Loading...</td></tr>';

  Promise.all([
    fetch("/classes").then(function (r) { return r.json(); }),
    fetch("/fee-structure?term=" + encodeURIComponent(ts.term) + "&session=" + encodeURIComponent(ts.session))
      .then(function (r) { return r.json(); })
  ])
    .then(function (res) {
      var classes = Array.isArray(res[0]) ? res[0] : [];
      var fees = Array.isArray(res[1]) ? res[1] : [];
      if (!classes.length) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#5B6B62;">No classes found.</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      classes.forEach(function (c) {
        var existing = fees.find(function (f) { return f.class_name === c.class_name; });
        var tr = document.createElement("tr");

        var td1 = document.createElement("td");
        var b = document.createElement("b");
        b.textContent = c.class_name;
        td1.appendChild(b);
        tr.appendChild(td1);

        var td2 = document.createElement("td");
        var input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.className = "feeAmount";
        input.dataset.className = c.class_name;
        input.placeholder = "0";
        if (existing) input.value = Number(existing.amount) || "";
        td2.appendChild(input);
        tr.appendChild(td2);
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#B3261E;">Could not load fees.</td></tr>';
    });
}

function saveFeeStructure() {
  var ts = finTermSession();
  var inputs = Array.prototype.slice.call(document.querySelectorAll(".feeAmount"))
    .filter(function (i) { return i.value !== "" && Number(i.value) >= 0; });
  if (!ts.session || !inputs.length) { finNotify("Enter at least one fee amount first.", false); return; }

  // Save the class fees one after another (server upserts each).
  var chain = Promise.resolve();
  var savedCount = 0, failed = false;
  inputs.forEach(function (input) {
    chain = chain.then(function () {
      if (failed) return;
      return fetch("/fee-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_name: input.dataset.className, term: ts.term, session: ts.session, amount: Number(input.value) })
      }).then(function (r) {
        if (!r.ok) failed = true; else savedCount++;
      });
    });
  });

  chain
    .then(function () {
      if (failed) finNotify("Some fees could not be saved (admin account required).", false);
      else finNotify("\u2705 " + savedCount + " class fees saved for " + ts.term + " - " + ts.session, true);
    })
    .catch(function () { finNotify("Network error - fees NOT saved.", false); });
}

/* -------------------------------- payments --------------------------- */
function loadPayStudents() {
  var cls = document.getElementById("payClass").value;
  var sel = document.getElementById("payStudent");
  sel.innerHTML = '<option value="">Loading...</option>';
  document.getElementById("payBalance").textContent = "";
  if (!cls) { sel.innerHTML = '<option value="">Choose class first</option>'; return; }

  fetch("/students")
    .then(function (r) { return r.json(); })
    .then(function (students) {
      finStudents = (students || []).filter(function (s) { return s.class_name === cls; });
      sel.innerHTML = '<option value="">Select Student</option>';
      finStudents.forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = s.student_id;
        opt.textContent = s.full_name + " (" + s.student_id + ")";
        sel.appendChild(opt);
      });
      if (!finStudents.length) sel.innerHTML = '<option value="">No students in this class</option>';
    })
    .catch(function () { sel.innerHTML = '<option value="">Could not load students</option>'; });
}

function savePayment() {
  var ts = finTermSession();
  var body = {
    student_id: document.getElementById("payStudent").value,
    term: ts.term,
    session: ts.session,
    amount: Number(document.getElementById("payAmount").value),
    method: document.getElementById("payMethod").value,
    note: document.getElementById("payNote").value.trim()
  };
  if (!body.student_id || !(body.amount > 0) || !ts.session) {
    finNotify("Pick the student and enter a valid amount.", false); return;
  }

  fetch("/fee-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) {
        finNotify("\u2705 Payment of " + naira(body.amount) + " recorded.", true);
        document.getElementById("payAmount").value = "";
        document.getElementById("payNote").value = "";
        loadStudentPayments();
      } else {
        finNotify(res.d.message || "Could not save payment.", false);
      }
    })
    .catch(function () { finNotify("Network error - payment NOT saved.", false); });
}

function loadStudentPayments() {
  var sid = document.getElementById("payStudent").value;
  var ts = finTermSession();
  var tbody = document.querySelector("#payTable tbody");
  var balanceBox = document.getElementById("payBalance");
  if (!sid) { return; }

  // payments list
  fetch("/fee-payments?student_id=" + encodeURIComponent(sid) + "&term=" + encodeURIComponent(ts.term) +
        "&session=" + encodeURIComponent(ts.session))
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      finPayRows = rows; // NEW (pack 14): kept for PDF / receipts
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#5B6B62;">No payments yet for this term.</td></tr>';
      } else {
        tbody.innerHTML = "";
        rows.forEach(function (row) {
          var tr = document.createElement("tr");
          var dt = row.paid_at ? String(row.paid_at).slice(0, 10) : "-";
          [dt, naira(row.amount), row.method, row.received_by].forEach(function (v) {
            var td = document.createElement("td");
            td.textContent = v || "-";
            tr.appendChild(td);
          });
          // NEW (pack 14): Receipt PDF + Delete (both admin actions)
          var tdAct = document.createElement("td");
          tdAct.style.whiteSpace = "nowrap";

          var btnR = document.createElement("button");
          btnR.className = "mg-btn-light";
          btnR.type = "button";
          btnR.title = "Download receipt (PDF)";
          btnR.textContent = "\u{1F9FE}";
          btnR.addEventListener("click", function () { downloadReceipt(row); });
          tdAct.appendChild(btnR);

          var btnD = document.createElement("button");
          btnD.className = "mg-btn-light mg-btn-danger";
          btnD.type = "button";
          btnD.title = "Delete payment (admin)";
          btnD.textContent = "\u{1F5D1}";
          btnD.style.marginLeft = "6px";
          btnD.addEventListener("click", function () { deletePayment(row); });
          tdAct.appendChild(btnD);

          tr.appendChild(tdAct);
          tbody.appendChild(tr);
        });
      }
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#B3261E;">Could not load payments.</td></tr>';
    });

  // balance
  var cls = document.getElementById("payClass").value;
  fetch("/fee-balance?term=" + encodeURIComponent(ts.term) + "&session=" + encodeURIComponent(ts.session) +
        "&class_name=" + encodeURIComponent(cls))
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      var rec = (Array.isArray(rows) ? rows : []).find(function (r2) { return r2.student_id === sid; });
      finPayBalance = rec || null; // NEW (pack 14)
      if (!rec) { balanceBox.textContent = ""; return; }
      var bal = Number(rec.balance);
      balanceBox.textContent =
        "Fee: " + naira(rec.fee) + "  |  Paid: " + naira(rec.paid) + "  |  Balance: " + naira(bal) +
        (bal <= 0 && Number(rec.fee) > 0 ? "  \u2705 (fully paid)" : "");
    })
    .catch(function () { balanceBox.textContent = ""; });
}

/* -------------------------------- expenses --------------------------- */
function loadExpenses() {
  var tbody = document.querySelector("#expTable tbody");
  fetch("/expenses")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#5B6B62;">No expenses recorded yet.</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      rows.forEach(function (row) {
        var tr = document.createElement("tr");
        var dt = row.spent_on ? String(row.spent_on).slice(0, 10) : "-";
        [dt, row.title, row.category, naira(row.amount)].forEach(function (v) {
          var td = document.createElement("td");
          td.textContent = v || "-";
          tr.appendChild(td);
        });
        var tdDel = document.createElement("td");
        var btn = document.createElement("button");
        btn.className = "mg-btn-light mg-btn-danger";
        btn.type = "button";
        btn.textContent = "\u{1F5D1}";
        btn.title = "Delete (admin)";
        btn.addEventListener("click", function () {
          if (!confirm("Delete this expense: " + row.title + "?")) return;
          fetch("/expense/" + row.id, { method: "DELETE" })
            .then(function (r) {
              if (r.ok) { finNotify("Expense deleted.", true); loadExpenses(); }
              else finNotify("Could not delete (admin account required).", false);
            })
            .catch(function () { finNotify("Network error.", false); });
        });
        tdDel.appendChild(btn);
        tr.appendChild(tdDel);
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#B3261E;">Could not load expenses.</td></tr>';
    });
}

function saveExpense() {
  var body = {
    title: document.getElementById("expTitle").value.trim(),
    category: document.getElementById("expCategory").value,
    amount: Number(document.getElementById("expAmount").value),
    spent_on: document.getElementById("expDate").value,
    note: document.getElementById("expNote").value.trim()
  };
  if (!body.title || !(body.amount > 0)) { finNotify("Enter a title and a valid amount.", false); return; }

  fetch("/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) {
        finNotify("\u2705 Expense of " + naira(body.amount) + " recorded.", true);
        document.getElementById("expTitle").value = "";
        document.getElementById("expAmount").value = "";
        document.getElementById("expNote").value = "";
        loadExpenses();
      } else {
        finNotify(res.d.message || "Could not save (admin account required).", false);
      }
    })
    .catch(function () { finNotify("Network error - expense NOT saved.", false); });
}

/* -------------------------------- summary ---------------------------- */
function loadSummary() {
  var ts = finTermSession();
  if (!ts.session) { finNotify("Type the session first.", false); return; }

  fetch("/finance-summary?term=" + encodeURIComponent(ts.term) + "&session=" + encodeURIComponent(ts.session))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.message) { finNotify(d.message, false); return; }
      document.getElementById("sumExpected").textContent = naira(d.expected);
      document.getElementById("sumReceived").textContent = naira(d.received);
      document.getElementById("sumOutstanding").textContent = naira(d.outstanding);
      document.getElementById("sumPayCount").textContent = d.payments_count;
      document.getElementById("sumExpenses").textContent = naira(d.expenses_total);
      document.getElementById("sumChips").style.display = "grid";
      var note = document.getElementById("sumNote");
      note.style.display = "block";
      note.textContent = "Expected = class fee \u00D7 students in each class, for " + d.term + " - " + d.session +
        ". Set the fees in the Fee Structure tab first.";
    })
    .catch(function () { finNotify("Could not load summary.", false); });
}


/* ======================== NEW (pack 14) ===============================
   Receipt PDF per payment, whole payments list PDF, and payment delete.
   Uses js/ams-pdf.js (pure jsPDF - always a clean one-page A4).
   ==================================================================== */
function finStudentMeta() {
  var sid = document.getElementById("payStudent").value;
  var st = finStudents.find(function (s) { return s.student_id === sid; }) || {};
  return {
    studentId: sid,
    studentName: st.full_name || sid,
    className: st.class_name || document.getElementById("payClass").value
  };
}

function downloadReceipt(row) {
  var ts = finTermSession();
  var meta = finStudentMeta();
  var d = window.amsReceiptPDF({
    receiptNo: "REC-" + row.id,
    date: row.paid_at ? String(row.paid_at).slice(0, 10) : "-",
    studentName: meta.studentName,
    studentId: meta.studentId,
    className: meta.className,
    term: ts.term,
    session: ts.session,
    amount: row.amount,
    method: row.method,
    receivedBy: row.received_by,
    note: row.note
  });
  d.save("receipt-" + row.id + ".pdf");
}

function deletePayment(row) {
  if (!confirm("Delete this payment of " + naira(row.amount) + "? This cannot be undone.")) return;
  fetch("/fee-payment/" + row.id, { method: "DELETE" })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) { finNotify("Payment deleted.", true); loadStudentPayments(); }
      else finNotify(res.d.message || "Could not delete (admin account required).", false);
    })
    .catch(function () { finNotify("Network error.", false); });
}

function downloadPaymentsPDF() {
  var sid = document.getElementById("payStudent").value;
  if (!sid) { finNotify("Pick a student first.", false); return; }
  var ts = finTermSession();
  var meta = finStudentMeta();
  var rows = finPayRows.map(function (r) {
    return [
      r.paid_at ? String(r.paid_at).slice(0, 10) : "-",
      naira(r.amount),
      r.method || "-",
      r.received_by || "-",
      r.note || "-"
    ];
  });
  var fee = finPayBalance ? Number(finPayBalance.fee) : 0;
  var paid = finPayBalance ? Number(finPayBalance.paid) : finPayRows.reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0);
  var d = window.amsPaymentsPDF({
    studentName: meta.studentName,
    studentId: sid,
    className: meta.className,
    term: ts.term,
    session: ts.session,
    rows: rows,
    fee: fee,
    totalPaid: paid,
    balance: fee - paid
  });
  d.save("payments-" + sid + "-" + ts.term.replace(/\s+/g, "") + ".pdf");
}
