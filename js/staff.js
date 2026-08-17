/* ==========================================================================
   js/staff.js
   Staff profiles (qualification, salary, bank details) + payroll ledger.
   Endpoints used: GET/POST/PUT/DELETE /staff, GET/POST/DELETE /payroll
   (all admin-only on the server). csrf.js already patches window.fetch.
   ========================================================================== */
"use strict";

var stfAllStaff = []; // cached staff list (for the payroll dropdown + editing)

function stfNotify(text, ok) {
    var msg = document.getElementById("stfMsg");
    msg.textContent = text;
    msg.className = "mg-msg " + (ok ? "ok" : "err");
    setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function naira(v) {
    return "N" + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function monthLabel(m) {
    // "2026-08" -> "August 2026"
    if (!m) return "-";
    var parts = String(m).split("-");
    if (parts.length !== 2) return m;
    var y = parts[0], mm = parseInt(parts[1], 10);
    var names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return (names[mm - 1] || mm) + " " + y;
}

function currentMonth() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function initStaff() {
    document.getElementById("payMonth").value = currentMonth();
    loadStaff();
    loadPayroll();

    // auto-fill the salary amount when a staff member is picked for payment
    document.getElementById("payStaff").addEventListener("change", function () {
        var sel = document.getElementById("payStaff");
        var st = (stfAllStaff || []).find(function (s) { return String(s.id) === sel.value; });
        if (st && st.salary > 0) document.getElementById("payAmount").value = st.salary;
    });
}

/* ------------------------------ staff list ------------------------------ */
function loadStaff() {
    var tbody = document.querySelector("#staffTable tbody");
    fetch("/staff", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
            rows = Array.isArray(rows) ? rows : [];
            stfAllStaff = rows;
            fillPayrollDropdown(rows);
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#5B6B62;">No staff members yet. Add your first one above.</td></tr>';
                return;
            }
            tbody.innerHTML = "";
            rows.forEach(function (s) {
                var tr = document.createElement("tr");
                var nameTd = document.createElement("td");
                nameTd.innerHTML = "<b>" + esc(s.full_name) + "</b>" +
                    (s.bank_name ? '<br><span style="font-size:11px;color:#93a19a;">' + esc(s.bank_name) + " &middot; " + esc(s.account_number || "") + "</span>" : "");
                tr.appendChild(nameTd);
                [s.subject, s.qualification, s.phone].forEach(function (v) {
                    var td = document.createElement("td");
                    td.textContent = v || "-";
                    tr.appendChild(td);
                });
                var salTd = document.createElement("td");
                salTd.innerHTML = "<b>" + naira(s.salary) + "</b>" +
                    (s.last_pay_month ? '<br><span style="font-size:11px;color:#93a19a;">last: ' + monthLabel(s.last_pay_month) + "</span>" : "");
                tr.appendChild(salTd);
                var stTd = document.createElement("td");
                stTd.innerHTML = s.status === "active"
                    ? '<span class="sc-chip sc-chip-live">active</span>'
                    : '<span class="sc-chip sc-chip-soon">inactive</span>';
                tr.appendChild(stTd);
                var actTd = document.createElement("td");
                actTd.style.whiteSpace = "nowrap";
                var btnEdit = document.createElement("button");
                btnEdit.className = "mg-btn-light"; btnEdit.type = "button"; btnEdit.textContent = "✏️";
                btnEdit.title = "Edit staff member";
                btnEdit.addEventListener("click", function () { stfFillForm(s); });
                actTd.appendChild(btnEdit);
                var btnDel = document.createElement("button");
                btnDel.className = "mg-btn-light mg-btn-danger"; btnDel.type = "button"; btnDel.textContent = "🗑";
                btnDel.title = "Delete staff member (and payroll history)";
                btnDel.style.marginLeft = "6px";
                btnDel.addEventListener("click", function () {
                    if (!confirm("Delete " + s.full_name + " and their payroll history?")) return;
                    fetch("/staff/" + s.id, { method: "DELETE", credentials: "same-origin" })
                        .then(function (r) { return r.json(); })
                        .then(function (d) { stfNotify(d.message || "Deleted.", true); loadStaff(); loadPayroll(); })
                        .catch(function () { stfNotify("Network error.", false); });
                });
                actTd.appendChild(btnDel);
                tr.appendChild(actTd);
                tbody.appendChild(tr);
            });
        })
        .catch(function () {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#B3261E;">Could not load staff.</td></tr>';
        });
}

function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

function fillPayrollDropdown(list) {
    var sel = document.getElementById("payStaff");
    if (!sel) return;
    var active = (list || []).filter(function (s) { return s.status === "active"; });
    sel.innerHTML = active.length
        ? '<option value="">Select staff member</option>' + active.map(function (s) {
            return '<option value="' + s.id + '">' + esc(s.full_name) + (s.subject ? " (" + esc(s.subject) + ")" : "") + "</option>";
        }).join("")
        : '<option value="">No active staff yet</option>';
}

/* ------------------------------ save staff ------------------------------ */
function saveStaff() {
    var id = document.getElementById("staffEditId").value;
    var body = {
        full_name: document.getElementById("stfName").value.trim(),
        subject: document.getElementById("stfSubject").value.trim(),
        qualification: document.getElementById("stfQualification").value.trim(),
        phone: document.getElementById("stfPhone").value.trim(),
        salary: Number(document.getElementById("stfSalary").value) || 0,
        status: document.getElementById("stfStatus").value,
        bank_name: document.getElementById("stfBankName").value.trim(),
        account_name: document.getElementById("stfAccountName").value.trim(),
        account_number: document.getElementById("stfAccountNumber").value.trim()
    };
    if (!body.full_name) { stfNotify("Staff full name is required.", false); return; }

    var method = id ? "PUT" : "POST";
    var url = id ? "/staff/" + id : "/staff";
    fetch(url, {
        method: method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
            if (res.ok) {
                stfNotify("✅ " + (res.d.message || "Saved."), true);
                stfResetForm();
                loadStaff();
            } else {
                stfNotify(res.d.message || "Could not save.", false);
            }
        })
        .catch(function () { stfNotify("Network error — NOT saved.", false); });
}

function stfFillForm(s) {
    document.getElementById("staffFormTitle").textContent = "✏️ Edit: " + s.full_name;
    document.getElementById("staffEditId").value = s.id;
    document.getElementById("stfName").value = s.full_name || "";
    document.getElementById("stfSubject").value = s.subject || "";
    document.getElementById("stfQualification").value = s.qualification || "";
    document.getElementById("stfPhone").value = s.phone || "";
    document.getElementById("stfSalary").value = s.salary || "";
    document.getElementById("stfStatus").value = s.status === "inactive" ? "inactive" : "active";
    document.getElementById("stfBankName").value = s.bank_name || "";
    document.getElementById("stfAccountName").value = s.account_name || "";
    document.getElementById("stfAccountNumber").value = s.account_number || "";
    document.getElementById("stfCancelEdit").style.display = "inline-block";
    document.getElementById("stfName").scrollIntoView({ behavior: "smooth", block: "center" });
}

function stfResetForm() {
    document.getElementById("staffFormTitle").textContent = "➕ Add Staff Member";
    document.getElementById("staffEditId").value = "";
    ["stfName","stfSubject","stfQualification","stfPhone","stfSalary","stfBankName","stfAccountName","stfAccountNumber"].forEach(function (id) {
        document.getElementById(id).value = "";
    });
    document.getElementById("stfStatus").value = "active";
    document.getElementById("stfCancelEdit").style.display = "none";
}

/* ------------------------------ payroll ------------------------------ */
function recordPayroll() {
    var body = {
        staff_id: Number(document.getElementById("payStaff").value),
        pay_month: document.getElementById("payMonth").value,
        amount: Number(document.getElementById("payAmount").value),
        method: document.getElementById("payMethod").value,
        note: document.getElementById("payNote").value.trim()
    };
    if (!body.staff_id || !body.pay_month || !(body.amount > 0)) {
        stfNotify("Pick the staff member, month and a valid amount.", false);
        return;
    }
    fetch("/payroll", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
            if (res.ok) {
                stfNotify("✅ " + (res.d.message || "Payment recorded."), true);
                document.getElementById("payAmount").value = "";
                document.getElementById("payNote").value = "";
                loadPayroll();
                loadStaff();
            } else {
                stfNotify(res.d.message || "Could not record payment.", false);
            }
        })
        .catch(function () { stfNotify("Network error — NOT recorded.", false); });
}

function loadPayroll() {
    var tbody = document.querySelector("#payrollTable tbody");
    var month = document.getElementById("payFilterMonth").value;
    var url = "/payroll" + (month ? "?month=" + encodeURIComponent(month) : "");
    fetch(url, { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
            rows = Array.isArray(rows) ? rows : [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#5B6B62;">No salary payments recorded' + (month ? " for " + monthLabel(month) : "") + '.</td></tr>';
                return;
            }
            tbody.innerHTML = "";
            rows.forEach(function (p) {
                var tr = document.createElement("tr");
                var dtTd = document.createElement("td");
                dtTd.textContent = p.paid_at ? String(p.paid_at).slice(0, 10) : "-";
                tr.appendChild(dtTd);
                var nmTd = document.createElement("td");
                nmTd.innerHTML = "<b>" + esc(p.full_name) + "</b>" + (p.subject ? '<br><span style="font-size:11px;color:#93a19a;">' + esc(p.subject) + "</span>" : "");
                tr.appendChild(nmTd);
                var moTd = document.createElement("td");
                moTd.textContent = monthLabel(p.pay_month);
                tr.appendChild(moTd);
                var amTd = document.createElement("td");
                amTd.innerHTML = "<b>" + naira(p.amount) + "</b>";
                tr.appendChild(amTd);
                var meTd = document.createElement("td");
                meTd.textContent = p.method || "-";
                tr.appendChild(meTd);
                var noTd = document.createElement("td");
                noTd.textContent = p.note || "-";
                tr.appendChild(noTd);
                var pbTd = document.createElement("td");
                pbTd.textContent = p.paid_by || "-";
                tr.appendChild(pbTd);
                var actTd = document.createElement("td");
                var btnDel = document.createElement("button");
                btnDel.className = "mg-btn-light mg-btn-danger"; btnDel.type = "button"; btnDel.textContent = "🗑";
                btnDel.title = "Delete this payroll entry";
                btnDel.addEventListener("click", function () {
                    if (!confirm("Delete this salary payment of " + naira(p.amount) + " for " + p.full_name + "?")) return;
                    fetch("/payroll/" + p.id, { method: "DELETE", credentials: "same-origin" })
                        .then(function (r) { return r.json(); })
                        .then(function () { stfNotify("Payroll entry deleted.", true); loadPayroll(); loadStaff(); })
                        .catch(function () { stfNotify("Network error.", false); });
                });
                actTd.appendChild(btnDel);
                tr.appendChild(actTd);
                tbody.appendChild(tr);
            });
        })
        .catch(function () {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#B3261E;">Could not load payroll.</td></tr>';
        });
}
