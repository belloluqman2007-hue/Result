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
  // CHANGED (pack 28): the Fees tab is now the guided setup (loadFeeSetup)
  if (finTab === "fees") { loadFeeSetup(); loadFeesOverview(); }
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
      // NEW (pack 28): the fee-setup class picker gets the same list
      var clsSel = document.getElementById("finCls");
      if (clsSel) clsSel.innerHTML = '<option value="" disabled selected>Select Class</option>';
      (classes || []).forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c.class_name;
        opt.textContent = c.class_name;
        sel.appendChild(opt);
        if (clsSel) clsSel.appendChild(opt.cloneNode(true));
      });
      loadExpenses();
      if (clsSel) loadFeesOverview(); // NEW (pack 28): warm the overview on first open
    })
    .catch(function () { /* leave defaults */ });

  document.getElementById("payStudent").addEventListener("change", loadStudentPayments);
  fillSessionList("finSessionList", "finSession"); // NEW (pack 14)
  loadFeeTypes(); // NEW (pack 15)
}

/* ------------------------------ fee structure ------------------------ */
function loadFeeStructure() {
  var ts = finTermSession();
  if (!ts.session) { finNotify("Type the session first (e.g. 2026/2027).", false); return; }
  var tbody = document.querySelector("#feeTable tbody");
  tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#5B6B62;">Loading...</td></tr>';

  var feeType = currentFeeType(); // CHANGED (pack 15)
  Promise.all([
    fetch("/classes").then(function (r) { return r.json(); }),
    fetch("/fee-structure2?term=" + encodeURIComponent(ts.term) + "&session=" + encodeURIComponent(ts.session) +
          "&fee_type=" + encodeURIComponent(feeType))
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
      return fetch("/fee-structure2", { // CHANGED (pack 15): per fee TYPE
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee_type: currentFeeType(), class_name: input.dataset.className, term: ts.term, session: ts.session, amount: Number(input.value) })
      }).then(function (r) {
        if (!r.ok) failed = true; else savedCount++;
      });
    });
  });

  chain
    .then(function () {
      if (failed) finNotify("Some fees could not be saved (admin account required).", false);
      else finNotify("\u2705 " + savedCount + " class fees saved [" + currentFeeType() + "] for " + ts.term + " - " + ts.session, true);
    })
    .catch(function () { finNotify("Network error - fees NOT saved.", false); });
}

/* ==========================================================================
   NEW (pack 28 - owner: "Organize the finance section well ... select class
   term session and select school fee and put the money, and put other money
   also ... so parent will see what they are paying for"): the guided
   per-class charges setup. Storage is the SAME /fee-structure2 table.
   ========================================================================== */

/* row model: {type, amount (string), isNew} rendered in #finChargeRows */
function finChargeRowHtml(type, amount, isMain) {
  var row = document.createElement("div");
  row.className = "fin-charge-row" + (isMain ? " main" : "");
  row.dataset.type = type;
  row.innerHTML =
    '<span class="nm">' + escHtml(type) + (isMain ? "<small>main charge - cannot be removed</small>" : "<small>other money</small>") + "</span>" +
    '<input type="number" min="0" placeholder="0" value="' + (amount === "" ? "" : Number(amount)) + '">';
  if (!isMain) {
    var x = document.createElement("button");
    x.type = "button";
    x.className = "fin-charge-x";
    x.innerHTML = "&times;";
    x.title = "Remove this charge from this class";
    x.addEventListener("click", function () { finRemoveCharge(row); });
    row.appendChild(x);
  }
  row.querySelector("input").addEventListener("input", finChargeTotal);
  return row;
}
function escHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function finChargeTotal() {
  var total = 0, filled = 0;
  document.querySelectorAll("#finChargeRows .fin-charge-row input").forEach(function (i) {
    if (i.value !== "" && Number(i.value) >= 0) { total += Number(i.value); filled++; }
  });
  var el = document.getElementById("finTotalLine");
  el.textContent = filled
    ? "Total per term for this class: " + naira(total) + (filled > 1 ? "  (" + filled + " charges)" : "")
    : "";
}

/* Load the ONE class's charges for the toolbar's term/session */
function loadFeeSetup() {
  var clsEl = document.getElementById("finCls");
  var card = document.getElementById("finSetupCard");
  if (!clsEl || !card) return;
  var cls = clsEl.value, ts = finTermSession();
  if (!cls) { card.style.display = "none"; return; }
  if (!ts.session) { finNotify("Type the session first (e.g. 2026/2027).", false); return; }
  card.style.display = "flex";
  document.getElementById("finSetupTitle").textContent = "Charges for " + cls + "  -  " + ts.term + ", " + ts.session;
  var box = document.getElementById("finChargeRows");
  box.innerHTML = '<div class="fin-ov-empty">Loading charges...</div>';
  fetch("/fee-structure2?term=" + encodeURIComponent(ts.term) + "&session=" + encodeURIComponent(ts.session))
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      var mine = rows.filter(function (f) { return f.class_name === cls; });
      box.innerHTML = "";
      // School Fee always first (main charge)
      var sf = mine.find(function (f) { return f.fee_type === "School Fee"; });
      box.appendChild(finChargeRowHtml("School Fee", sf ? sf.amount : "", true));
      mine.filter(function (f) { return f.fee_type !== "School Fee"; })
          .sort(function (a, b) { return a.fee_type.localeCompare(b.fee_type); })
          .forEach(function (f) { box.appendChild(finChargeRowHtml(f.fee_type, f.amount, false)); });
      finChargeTotal();
    })
    .catch(function () { box.innerHTML = '<div class="fin-ov-empty">Could not load charges - check connection.</div>'; });
}

/* "put other money also" - append a new charge row */
function finAddCharge() {
  var nameEl = document.getElementById("finNewName");
  var amtEl = document.getElementById("finNewAmount");
  var name = nameEl.value.trim();
  if (!name) { finNotify("Type the name of the other money first (e.g. PTA Fee).", false); return; }
  var box = document.getElementById("finChargeRows");
  var dup = Array.prototype.some.call(box.children, function (row) {
    return (row.dataset.type || "").toLowerCase() === name.toLowerCase();
  });
  if (dup) { finNotify("\"" + name + "\" is already in the list - just type its amount.", false); return; }
  var row = finChargeRowHtml(name, amtEl.value === "" ? "" : amtEl.value, false);
  row.dataset.isNew = "1";
  box.appendChild(row);
  nameEl.value = "";
  amtEl.value = "";
  finChargeTotal();
  row.querySelector("input").focus();
}

/* X on a non-main charge: if it was already saved, delete it on the server */
function finRemoveCharge(row) {
  var type = row.dataset.type;
  if (type === "School Fee") return;
  var cls = document.getElementById("finCls").value, ts = finTermSession();
  var drop = function () { row.remove(); finChargeTotal(); loadFeesOverview(); };
  if (row.dataset.isNew) { drop(); return; } // never saved - just remove the row
  if (!confirm("Remove \"" + type + "\" from " + cls + " for " + ts.term + " - " + ts.session + "?\n(Payments already recorded stay on record.)")) return;
  fetch("/fee-structure2", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fee_type: type, class_name: cls, term: ts.term, session: ts.session })
  })
    .then(function (r) {
      if (r.ok) { finNotify("\u{1F5D1} " + type + " removed from " + cls + ".", true); drop(); }
      else finNotify("Could not remove (admin account required).", false);
    })
    .catch(function () { finNotify("Network error.", false); });
}

/* Save every visible charge row for THIS class (+ term/session above) */
function saveFeeSetup() {
  var cls = document.getElementById("finCls").value, ts = finTermSession();
  if (!cls) { finNotify("Choose the class first.", false); return; }
  if (!ts.session) { finNotify("Type the session first (e.g. 2026/2027).", false); return; }
  var rows = Array.prototype.slice.call(document.querySelectorAll("#finChargeRows .fin-charge-row"));
  var items = rows.map(function (row) {
    return { type: row.dataset.type, amount: row.querySelector("input").value };
  }).filter(function (it) { return it.amount !== "" && Number(it.amount) >= 0; });
  if (!items.length) { finNotify("Enter at least one amount first.", false); return; }

  // 1) make sure any brand-new charge NAMES exist as fee types (best effort)
  var newTypes = items
    .filter(function (it) { return !finTypes.some(function (t) { return t.name.toLowerCase() === it.type.toLowerCase(); }); })
    .map(function (it) { return it.type; });
  var typeChain = Promise.resolve();
  newTypes.forEach(function (name) {
    typeChain = typeChain.then(function () {
      return fetch("/fee-type", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name })
      }).catch(function () { /* fine if it fails - the charge still saves */ });
    });
  });

  // 2) save the charges one after another (server upserts each)
  typeChain.then(function () {
    var saved = 0, failed = false;
    var chain = Promise.resolve();
    items.forEach(function (it) {
      chain = chain.then(function () {
        if (failed) return;
        return fetch("/fee-structure2", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fee_type: it.type, class_name: cls, term: ts.term, session: ts.session, amount: Number(it.amount) })
        }).then(function (r) { if (!r.ok) failed = true; else saved++; });
      });
    });
    chain.then(function () {
      if (failed) finNotify("Some charges could not be saved (admin account required).", false);
      else finNotify("\u2705 " + saved + " charge(s) saved for " + cls + " - parents see them itemized now.", true);
      loadFeeTypes();
      loadFeeSetup();
      loadFeesOverview();
    }).catch(function () { finNotify("Network error - charges NOT saved.", false); });
  });
}

/* Step 3 - every class's charges for the toolbar's term/session, at a glance */
function loadFeesOverview() {
  var box = document.getElementById("finFeesOverview");
  if (!box) return;
  var ts = finTermSession();
  if (!ts.session) { box.innerHTML = '<div class="fin-ov-empty">Type the session first (e.g. 2026/2027).</div>'; return; }
  box.innerHTML = '<div class="fin-ov-empty">Loading...</div>';
  Promise.all([
    fetch("/classes").then(function (r) { return r.ok ? r.json() : []; }),
    fetch("/fee-structure2?term=" + encodeURIComponent(ts.term) + "&session=" + encodeURIComponent(ts.session))
      .then(function (r) { return r.ok ? r.json() : []; })
  ]).then(function (res) {
    var classes = Array.isArray(res[0]) ? res[0] : [];
    var rows = Array.isArray(res[1]) ? res[1] : [];
    if (!classes.length) { box.innerHTML = '<div class="fin-ov-empty">No classes found.</div>'; return; }
    var html = "";
    classes.forEach(function (c) {
      var mine = rows.filter(function (f) { return f.class_name === c.class_name; });
      var chips = mine.length
        ? mine.map(function (f) {
            return '<span class="fin-ov-chip' + (f.fee_type === "School Fee" ? " main" : "") + '">' +
                   escHtml(f.fee_type) + ": " + naira(f.amount) + "</span>";
          }).join("")
        : '<span style="color:#B3261E; font-size:12.5px;">No charges set yet</span>';
      var total = mine.reduce(function (a, f) { return a + (Number(f.amount) || 0); }, 0);
      html += '<div class="fin-ov-row">' +
                '<span class="fin-ov-cls">' + escHtml(c.class_name) + "</span>" +
                '<span class="fin-ov-chips">' + chips + "</span>" +
                '<span class="fin-ov-total">' + (mine.length ? "Total: " + naira(total) : "") + "</span>" +
              "</div>";
    });
    box.innerHTML = html;
  }).catch(function () { box.innerHTML = '<div class="fin-ov-empty">Could not load the overview.</div>'; });
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
    fee_type: currentPayType(), // NEW (pack 15)
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

/* NEW (pack 17): upload the snapped receipt photo for ONE payment, then
   refresh the list so the View/Remove buttons appear. */
function uploadReceiptPhoto(row, file) {
  if (file.size && file.size > 8 * 1024 * 1024) { finNotify("Photo is too big (max 8MB).", false); return; }
  var fd = new FormData();
  fd.append("receipt", file);
  finNotify("Uploading receipt photo\u2026", true);
  fetch("/fee-payment/" + row.id + "/receipt", { method: "POST", body: fd })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      finNotify(res.ok ? "\u2705 " + (res.d.message || "Receipt saved") : (res.d.message || "Could not save the receipt photo."), res.ok);
      if (res.ok) loadStudentPayments();
    })
    .catch(function () { finNotify("Network error - receipt photo NOT saved.", false); });
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
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#5B6B62;">No payments yet for this term.</td></tr>';
      } else {
        tbody.innerHTML = "";
        rows.forEach(function (row) {
          var tr = document.createElement("tr");
          var dt = row.paid_at ? String(row.paid_at).slice(0, 10) : "-";
          [dt, row.fee_type || "School Fee", naira(row.amount), row.method, row.received_by].forEach(function (v) {
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

          /* NEW (pack 17 - owner request): snap a photo of the receipt
             written in school and pin it to this payment. The parent
             sees it in their portal; admin can view/replace/remove it
             (e.g. if the photo is not clear). */
          var fileInput = document.createElement("input");
          fileInput.type = "file";
          fileInput.accept = "image/*";
          fileInput.style.display = "none";
          fileInput.addEventListener("change", function () {
            if (fileInput.files && fileInput.files[0]) uploadReceiptPhoto(row, fileInput.files[0]);
          });
          tdAct.appendChild(fileInput);

          var btnSnap = document.createElement("button");
          btnSnap.className = "mg-btn-light";
          btnSnap.type = "button";
          btnSnap.textContent = "\u{1F4F7}";
          btnSnap.title = row.receipt_path ? "Replace the receipt photo" : "Upload the receipt photo (parent sees it)";
          btnSnap.style.marginLeft = "6px";
          btnSnap.addEventListener("click", function () { fileInput.click(); });
          tdAct.appendChild(btnSnap);

          if (row.receipt_path) {
            var btnView = document.createElement("button");
            btnView.className = "mg-btn-light";
            btnView.type = "button";
            btnView.textContent = "\u{1F5BC}";
            btnView.title = "View the receipt photo";
            btnView.style.marginLeft = "6px";
            btnView.addEventListener("click", function () { window.open("/" + row.receipt_path, "_blank"); });
            tdAct.appendChild(btnView);

            var btnNoRec = document.createElement("button");
            btnNoRec.className = "mg-btn-light mg-btn-danger";
            btnNoRec.type = "button";
            btnNoRec.textContent = "\u2716";
            btnNoRec.title = "Remove the receipt photo (unclear/wrong)";
            btnNoRec.style.marginLeft = "6px";
            btnNoRec.addEventListener("click", function () {
              if (!confirm("Remove this receipt photo? The parent will stop seeing it.")) return;
              fetch("/fee-payment/" + row.id + "/receipt", { method: "DELETE" })
                .then(function (r) { return r.json(); })
                .then(function (d) { finNotify(d.message || "Receipt removed.", true); loadStudentPayments(); })
                .catch(function () { finNotify("Could not remove the receipt photo.", false); });
            });
            tdAct.appendChild(btnNoRec);
          }

          tr.appendChild(tdAct);
          tbody.appendChild(tr);
        });
      }
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#B3261E;">Could not load payments.</td></tr>';
    });

  // CHANGED (pack 15): balances come from v2 (per fee TYPE).
  var cls = document.getElementById("payClass").value;
  fetch("/fee-balance-v2?term=" + encodeURIComponent(ts.term) + "&session=" + encodeURIComponent(ts.session) +
        "&class_name=" + encodeURIComponent(cls))
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      rows = (Array.isArray(rows) ? rows : []).filter(function (r2) { return r2.student_id === sid; });
      var selType = currentPayType();
      var rec = rows.find(function (r2) { return r2.fee_type === selType; }) || null;
      finPayBalance = rec;
      if (!rec) { balanceBox.textContent = "No " + selType + " has been set for this class yet."; }
      else {
        var bal = Number(rec.balance);
        balanceBox.textContent = rec.fee_type + " - Fee: " + naira(rec.fee) + "  |  Paid: " + naira(rec.paid) +
          "  |  Balance: " + naira(bal) + (bal <= 0 && Number(rec.fee) > 0 ? "  \u2705 (fully paid)" : "");
      }
      var brk = document.getElementById("payTypeBreak");
      if (rows.length) {
        brk.innerHTML = rows.map(function (r2) {
          var line = document.createElement("div");
          line.textContent = "\u2022 " + r2.fee_type + ": fee " + naira(r2.fee) + " | paid " + naira(r2.paid) + " | balance " + naira(r2.balance);
          if (r2.fee_type === selType) { line.style.fontWeight = "700"; line.style.color = "#1C5A42"; }
          return line.outerHTML;
        }).join("");
      } else {
        brk.innerHTML = "<i>No fees set for this class for " + ts.term + " - " + ts.session + " yet (see Fee Structure tab).</i>";
      }
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
    feeType: row.fee_type || "School Fee",
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
      r.fee_type || "School Fee",
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


/* ======================== NEW (pack 15) ===============================
   Fee TYPES management + Parent payment proof review (approve/reject).
   ==================================================================== */
var finTypes = [];

function currentFeeType() {
  var sel = document.getElementById("finType");
  return sel && sel.value ? sel.value : "School Fee";
}
function currentPayType() {
  var sel = document.getElementById("payType");
  return sel && sel.value ? sel.value : "School Fee";
}

function loadFeeTypes() {
  fetch("/fee-types")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      finTypes = Array.isArray(rows) ? rows : [];
      fillTypeSelects();
      renderTypeChips();
      refreshSubsBadge();
    })
    .catch(function () { /* dropdowns stay empty */ });
}

function fillTypeSelects() {
  // NEW (pack 28): the "other money name" box also suggests existing names
  var dl = document.getElementById("finTypeList");
  if (dl) {
    dl.innerHTML = "";
    finTypes.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.name;
      dl.appendChild(o);
    });
  }
  ["finType", "payType"].forEach(function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = "";
    finTypes.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t.name;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    if (current && finTypes.some(function (t) { return t.name === current; })) sel.value = current;
  });
}

function toggleTypeMgr() {
  var w = document.getElementById("typeMgr");
  w.style.display = w.style.display === "none" ? "block" : "none";
}

function renderTypeChips() {
  var box = document.getElementById("typeChips");
  if (!box) return;
  box.innerHTML = "";
  finTypes.forEach(function (t) {
    var chip = document.createElement("span");
    chip.style.cssText = "display:inline-flex; align-items:center; gap:6px; background:#F0F7F3; border:1.5px solid #D9E8E0; border-radius:999px; padding:6px 12px; font-size:12.5px; font-weight:700; color:#0F3D2E;";
    chip.textContent = t.name;
    var x = document.createElement("button");
    x.type = "button";
    x.textContent = "\u00D7";
    x.title = "Remove type";
    x.style.cssText = "border:none; background:none; color:#B3261E; font-size:15px; cursor:pointer; font-weight:800;";
    x.addEventListener("click", function () {
      if (!confirm("Remove the fee type '" + t.name + "'? (Old payments stay recorded.)")) return;
      fetch("/fee-type/" + t.id, { method: "DELETE" })
        .then(function (r) {
          if (r.ok) { finNotify("Fee type removed.", true); loadFeeTypes(); }
          else finNotify("Could not remove (admin account required).", false);
        })
        .catch(function () { finNotify("Network error.", false); });
    });
    chip.appendChild(x);
    box.appendChild(chip);
  });
}

function addFeeType() {
  var name = document.getElementById("newTypeName").value.trim();
  if (!name) { finNotify("Type the fee type name first (e.g. Uniform Fee).", false); return; }
  fetch("/fee-type", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name })
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) {
        finNotify("\u2705 Fee type added: " + name, true);
        document.getElementById("newTypeName").value = "";
        loadFeeTypes();
      } else {
        finNotify(res.d.message || "Could not add.", false);
      }
    })
    .catch(function () { finNotify("Network error.", false); });
}

/* ---------------- Parent payment proofs (approve/reject) ------------- */
function refreshSubsBadge() {
  fetch("/payment-submissions?status=pending").then(function (r) { return r.ok ? r.json() : []; }).then(function (pend) {
    var badge = document.getElementById("subsBadge");
    if (!badge) return;
    var n = Array.isArray(pend) ? pend.length : 0;
    badge.style.display = n ? "inline-block" : "none";
    badge.textContent = n;
  }).catch(function () {});
}

function loadSubmissions() {
  var status = document.getElementById("subsStatus") ? document.getElementById("subsStatus").value : "pending";
  var tbody = document.querySelector("#subsTable tbody");
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#5B6B62;">Loading...</td></tr>';
  refreshSubsBadge();
  fetch("/payment-submissions" + (status ? "?status=" + encodeURIComponent(status) : ""))
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#5B6B62;">No parent payment uploads' + (status ? " (" + status + ")" : "") + ".</td></tr>";
        return;
      }
      tbody.innerHTML = "";
      rows.forEach(function (row) {
        var tr = document.createElement("tr");
        var dt = row.created_at ? String(row.created_at).slice(0, 10) : "-";

        function td(v) { var c = document.createElement("td"); c.textContent = (v === null || v === undefined || v === "") ? "-" : v; return c; }
        tr.appendChild(td(dt));
        var tdName = td("");
        var b = document.createElement("b"); b.textContent = row.full_name || row.student_id;
        tdName.appendChild(b);
        tdName.appendChild(document.createTextNode(" (" + row.student_id + ")"));
        tr.appendChild(tdName);
        tr.appendChild(td(row.class_name));
        tr.appendChild(td(row.fee_type || "School Fee"));
        tr.appendChild(td(naira(row.amount)));

        var tdProof = document.createElement("td");
        if (row.evidence_path) {
          var a = document.createElement("a");
          a.href = "/" + row.evidence_path;
          a.target = "_blank";
          a.textContent = row.evidence_path.toLowerCase().endsWith(".pdf") ? "\u{1F4C4} PDF" : "\u{1F5BC} Image";
          tdProof.appendChild(a);
        } else tdProof.textContent = "none";
        tr.appendChild(tdProof);

        var tdStatus = document.createElement("td");
        tdStatus.innerHTML = row.status === "approved" ? '<span class="sc-chip sc-chip-live">approved</span>'
           : row.status === "rejected" ? '<span class="sc-chip" style="background:#FBE9E7; color:#B3261E;">rejected</span>'
           : '<span class="sc-chip sc-chip-soon">pending</span>';
        tr.appendChild(tdStatus);

        var tdAct = document.createElement("td");
        tdAct.style.whiteSpace = "nowrap";
        if (row.status === "pending") {
          var okBtn = document.createElement("button");
          okBtn.className = "mg-btn";
          okBtn.type = "button";
          okBtn.style.padding = "7px 12px";
          okBtn.textContent = "\u2705 Approve";
          okBtn.addEventListener("click", function () { reviewSub(row, true); });
          tdAct.appendChild(okBtn);

          var noBtn = document.createElement("button");
          noBtn.className = "mg-btn-light mg-btn-danger";
          noBtn.type = "button";
          noBtn.style.marginLeft = "6px";
          noBtn.style.padding = "7px 12px";
          noBtn.textContent = "\u274C Reject";
          noBtn.addEventListener("click", function () { reviewSub(row, false); });
          tdAct.appendChild(noBtn);
        } else {
          tdAct.textContent = row.reviewed_by ? "by " + row.reviewed_by : "-";
        }
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#B3261E;">Could not load (admin account required).</td></tr>';
    });
}

function reviewSub(row, approve) {
  var msg = approve
    ? "Approve " + naira(row.amount) + " (" + (row.fee_type || "School Fee") + ") for " + (row.full_name || row.student_id) + "? It becomes a real payment."
    : "Reject this payment proof from " + (row.full_name || row.student_id) + "?";
  if (!confirm(msg)) return;
  fetch("/payment-submission/" + row.id + (approve ? "/approve" : "/reject"), { method: "POST" })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      finNotify(res.d.message || (res.ok ? "Done." : "Failed."), res.ok);
      if (res.ok) loadSubmissions();
    })
    .catch(function () { finNotify("Network error.", false); });
}
