/* ==========================================================================
   js/admissions.js - website admission enquiries board.

   CHANGED (pack 37 - admission pipeline): this file was the pack-13
   read-only viewer. It is now a full little pipeline:
     - clickable status counters (new / contacted / admitted / declined)
     - status filtering
     - one-tap ADMIT: creates the real student record straight from an
       enquiry (Student/Parent portal login starts working immediately)
     - printable PROVISIONAL ADMISSION LETTER (print / save as PDF)
     - delete spam enquiries
   Everything the pack-13 page relied on (loadAdmissions global,
   admNotify, fmtWhen, the status PUT) is kept intact and extended.
========================================================================== */
"use strict";

function admNotify(text, ok) {
  var msg = document.getElementById("admMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function fmtWhen(v) {
  if (!v) return "-";
  var d = new Date(v);
  return isNaN(d) ? String(v).slice(0, 10) : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/* ------------------------------ pack 37 state ------------------------------ */
var admCache = [];            /* last fetched enquiry rows */
var admStatusFilter = "";     /* "" = all */
var admClassPromise = null;   /* /classes fetched once */
var admSigPromise = null;     /* /signatures fetched once (for the letter) */
var admModalRow = null;       /* enquiry currently inside the admit modal */

function admEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Current academic session the school works in, e.g. 2026/2027.
   Sessions roll over mid-year (June), like the fee session the school
   already created. Display only - the students table stores no session. */
function admSessionNow() {
  var n = new Date();
  var y = n.getFullYear();
  return (n.getMonth() >= 5) ? y + "/" + (y + 1) : (y - 1) + "/" + y;
}

/* ------------------------------ data loading ------------------------------ */
function loadAdmissions() {
  var tbody = document.querySelector("#admTable tbody");
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#5B6B62;">Loading...</td></tr>';

  fetch("/admission-enquiries")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      admCache = Array.isArray(rows) ? rows : [];
      admRenderChips();
      admRenderTable();
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#B3261E;">Could not load enquiries. Please refresh.</td></tr>';
    });
}

/* ------------------------------ chips + filter --------------------------- */
function admRenderChips() {
  var box = document.getElementById("admChips");
  if (!box) return;
  var counts = { total: admCache.length, new: 0, contacted: 0, admitted: 0, declined: 0 };
  admCache.forEach(function (r) { if (counts[r.status] !== undefined) counts[r.status]++; });
  var defs = [
    ["", "All", counts.total],
    ["new", "New", counts.new],
    ["contacted", "Contacted", counts.contacted],
    ["admitted", "Admitted", counts.admitted],
    ["declined", "Declined", counts.declined]
  ];
  box.innerHTML = "";
  defs.forEach(function (d) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "adm-chip" + (admStatusFilter === d[0] ? " adm-active" : "");
    b.innerHTML = admEsc(d[1]) + " <b>" + d[2] + "</b>";
    b.onclick = function () { admSetFilter(d[0]); };
    box.appendChild(b);
  });
}

function admSetFilter(v) {
  admStatusFilter = v || "";
  var sel = document.getElementById("admFilter");
  if (sel && sel.value !== admStatusFilter) sel.value = admStatusFilter;
  admRenderChips();
  admRenderTable();
}

/* ------------------------------ table render ----------------------------- */
function admRenderTable() {
  var tbody = document.querySelector("#admTable tbody");
  var rows = admCache.filter(function (r) { return !admStatusFilter || r.status === admStatusFilter; });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#5B6B62;">' +
      (admCache.length ? "No enquiries with this status." :
        "No enquiries yet. Share the website link so parents can apply.") + "</td></tr>";
    return;
  }
  tbody.innerHTML = "";
  rows.forEach(function (row) {
    var tr = document.createElement("tr");

    function td(text) {
      var cell = document.createElement("td");
      cell.textContent = text || "-";
      return cell;
    }

    tr.appendChild(td(fmtWhen(row.created_at)));
    // FIX (pack 38): td("") used to leave a stray "-" before the bold name.
    var nameCell = document.createElement("td");
    var b = document.createElement("b");
    b.textContent = row.child_name || "-";
    nameCell.appendChild(b);
    if (row.admitted_student_id) {
      var tag = document.createElement("div");
      tag.style.cssText = "font-size:11px;color:#1d5c3f;font-weight:800;";
      tag.textContent = "🎓 " + row.admitted_student_id;
      nameCell.appendChild(tag);
    }
    tr.appendChild(nameCell);
    tr.appendChild(td(row.parent_name));
    var phoneCell = document.createElement("td"); // FIX (pack 38): same stray "-" before the number
    var link = document.createElement("a");
    link.href = "tel:" + (row.phone || "");
    link.textContent = row.phone || "-";
    phoneCell.appendChild(link);
    tr.appendChild(phoneCell);
    tr.appendChild(td(row.class_applied));
    tr.appendChild(td(row.message));

    // status selector (pack 13 - kept; 'declined' added in pack 37)
    var statusCell = document.createElement("td");
    var sel = document.createElement("select");
    ["new", "contacted", "admitted", "declined"].forEach(function (st) {
      var opt = document.createElement("option");
      opt.value = st;
      opt.textContent = st.charAt(0).toUpperCase() + st.slice(1);
      if (row.status === st) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
      fetch("/admission-enquiry/" + row.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: sel.value })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (res.ok) { row.status = sel.value; admRenderChips(); admRenderTable(); admNotify("Status updated: " + (row.child_name || "") + " -> " + sel.value, true); }
          else admNotify(res.d.message || "Could not update (admin account required).", false);
        })
        .catch(function () { admNotify("Network error - status NOT saved.", false); });
    });
    statusCell.appendChild(sel);
    tr.appendChild(statusCell);

    // actions (NEW pack 37)
    var actCell = document.createElement("td");
    actCell.style.whiteSpace = "nowrap";
    if (row.status === "admitted") {
      var letterBtn = document.createElement("button");
      letterBtn.type = "button";
      letterBtn.className = "adm-act adm-letter";
      letterBtn.textContent = "📄 Letter";
      letterBtn.title = "Print the provisional admission letter";
      letterBtn.onclick = function () { admOpenLetter(row); };
      actCell.appendChild(letterBtn);
    } else {
      var admitBtn = document.createElement("button");
      admitBtn.type = "button";
      admitBtn.className = "adm-act adm-admit";
      admitBtn.textContent = "🎓 Admit";
      admitBtn.title = "Admit this child - creates the student record instantly";
      admitBtn.onclick = function () { admOpenModal(row); };
      actCell.appendChild(admitBtn);
    }
    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "adm-act adm-del";
    delBtn.textContent = "🗑";
    delBtn.title = "Delete this enquiry";
    delBtn.onclick = function () {
      if (!confirm("Delete the enquiry from " + (row.child_name || "this child") + "? This cannot be undone.")) return;
      fetch("/admission-enquiry/" + row.id, { method: "DELETE" })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (res.ok) { admNotify("Enquiry deleted.", true); loadAdmissions(); }
          else admNotify(res.d.message || "Could not delete (admin account required).", false);
        })
        .catch(function () { admNotify("Network error - NOT deleted.", false); });
    };
    actCell.appendChild(delBtn);
    tr.appendChild(actCell);

    tbody.appendChild(tr);
  });
}

/* ------------------------------ admit modal ------------------------------ */
function admLoadClasses() {
  if (!admClassPromise) {
    admClassPromise = fetch("/classes").then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; });
  }
  return admClassPromise;
}

function admOpenModal(row) {
  admModalRow = row;
  var modal = document.getElementById("admModal");
  document.getElementById("admdName").value = row.child_name || "";
  document.getElementById("admdGender").value = "";
  document.getElementById("admdDob").value = "";
  document.getElementById("admdParent").value = row.parent_name || "";
  document.getElementById("admdPhone").value = row.phone || "";
  document.getElementById("admdSid").value = "";
  document.getElementById("admdSid").placeholder = "loading…";
  document.getElementById("admdMsg").textContent = "";
  document.getElementById("admdMsg").className = "admd-msg";
  var hint = document.getElementById("admdClassHint");
  var sel = document.getElementById("admdClass");
  sel.innerHTML = "<option value=''>Loading classes...</option>";
  modal.style.display = "flex";

  admLoadClasses().then(function (cls) {
    sel.innerHTML = "<option value=''>- pick class -</option>";
    var matched = false;
    (cls || []).forEach(function (c) {
      var name = c.class_name || c;
      var o = document.createElement("option");
      o.value = name; o.textContent = name;
      if (row.class_applied && String(name).trim() === String(row.class_applied).trim()) {
        o.selected = true; matched = true;
      }
      sel.appendChild(o);
    });
    hint.textContent = (!matched && row.class_applied)
      ? ('(website form said: "' + row.class_applied + '")')
      : "";
  });

  fetch("/admission-next-id")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var inp = document.getElementById("admdSid");
      if (d && d.student_id) { inp.value = d.student_id; inp.placeholder = ""; }
      else inp.placeholder = "auto on save";
    })
    .catch(function () { document.getElementById("admdSid").placeholder = "auto on save"; });
}

function admCloseModal() {
  document.getElementById("admModal").style.display = "none";
  admModalRow = null;
}

function admDoAdmit() {
  if (!admModalRow) return;
  var go = document.getElementById("admdGo");
  var msg = document.getElementById("admdMsg");
  var body = {
    full_name: document.getElementById("admdName").value.trim(),
    gender: document.getElementById("admdGender").value,
    class_name: document.getElementById("admdClass").value,
    date_of_birth: document.getElementById("admdDob").value,
    parent_name: document.getElementById("admdParent").value.trim(),
    parent_phone: document.getElementById("admdPhone").value.trim(),
    student_id: document.getElementById("admdSid").value.trim()
  };
  if (!body.full_name) { msg.textContent = "Full name is required."; msg.className = "admd-msg err"; return; }
  if (!body.gender) { msg.textContent = "Pick the gender."; msg.className = "admd-msg err"; return; }
  if (!body.class_name) { msg.textContent = "Pick the class."; msg.className = "admd-msg err"; return; }

  go.disabled = true;
  msg.textContent = "Admitting…";
  msg.className = "admd-msg";
  fetch("/admission-enquiry/" + admModalRow.id + "/admit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      go.disabled = false;
      if (res.ok) {
        var sid = res.d.student_id;
        admCloseModal();
        admNotify("✅ Admitted as " + sid + " - press 📄 Letter on the row to print the admission letter.", true);
        loadAdmissions();
      } else {
        msg.textContent = res.d.message || "Could not admit.";
        msg.className = "admd-msg err";
      }
    })
    .catch(function () {
      go.disabled = false;
      msg.textContent = "Network error - nothing was saved.";
      msg.className = "admd-msg err";
    });
}

/* --------------------------- admission letter ---------------------------- */
function admLoadSignatures() {
  if (!admSigPromise) {
    admSigPromise = fetch("/signatures").then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; });
  }
  return admSigPromise;
}

function admOpenLetter(row) {
  var year = new Date().getFullYear();
  var ref = "AMS/ADM/" + year + "/" + String(row.id).padStart(4, "0");
  var today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  var session = admSessionNow();
  var child = row.child_name || "-";

  document.getElementById("admLetterBody").innerHTML =
    '<div class="adml-sheet">' +
      '<div class="adml-head">' +
        '<img class="adml-logo" src="images/LOGO.JPG" alt="">' +
        '<div class="adml-head-txt">' +
          '<div class="adml-ar" lang="ar">مدرسة أمين اللّه للعلوم العربيّة الإسلاميّة</div>' +
          '<div class="adml-en">AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES</div>' +
          '<div class="adml-addr">3, Temidire street, Off Ondo Road, Ijebu-Ode, Ogun State. &nbsp;|&nbsp; Tel: 08062445559, 08058306889 &nbsp;|&nbsp; Email: madrasatuameenillah22@gmail.com</div>' +
          '<div class="adml-motto">MOTTO: KNOWLEDGE AND WORSHIP <span lang="ar">شعارنا: العلم والعبادة</span></div>' +
        '</div>' +
        '<div class="adml-bismi" lang="ar">بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ</div>' +
      '</div>' +
      '<div class="adml-refrow"><span>Ref: <b>' + admEsc(ref) + '</b></span><span>Date: <b>' + admEsc(today) + '</b></span></div>' +
      '<div class="adml-title">PROVISIONAL LETTER OF ADMISSION<span lang="ar">خِطَابُ قَبُولٍ مُؤَقَّت</span></div>' +
      '<p class="adml-dear">Dear Parent/Guardian of,</p>' +
      '<div class="adml-child">' + admEsc(child) + '</div>' +
      '<p class="adml-body"><i>Assalamu alaykum warahmatullah wabarakatuh.</i> We are pleased to inform you that ' +
        'your above-named child has been offered <b>provisional admission</b> into <b>' + admEsc(row.class_applied || "-") + '</b> ' +
        'for the <b>' + admEsc(session) + '</b> academic session at Ameenullah School of Arabic and Islamic Studies.</p>' +
      '<table class="adml-details">' +
        '<tr><td>Student\u2019s Name</td><td>' + admEsc(child) + '</td></tr>' +
        '<tr><td>Admission No.</td><td><b>' + admEsc(row.admitted_student_id || "-") + '</b></td></tr>' +
        '<tr><td>Class Admitted Into</td><td>' + admEsc(row.class_applied || "-") + '</td></tr>' +
        '<tr><td>Academic Session</td><td>' + admEsc(session) + '</td></tr>' +
        '<tr><td>Gender</td><td>' + admEsc(row.gender || "-") + '</td></tr>' +
        '<tr><td>Date of Birth</td><td>' + admEsc(fmtWhen(row.date_of_birth)) + '</td></tr>' +
      '</table>' +
      '<p class="adml-body">Kindly present this letter at the school office with the child\u2019s birth certificate ' +
        'and two recent passport photographs to complete the registration.</p>' +
      '<p class="adml-body">We look forward to nurturing your child in knowledge and worship. May Almighty Allah ' +
        'bless the child and the family, and grant them success. <i>(Aameen).</i></p>' +
      '<div class="adml-signrow">' +
        '<div class="adml-sign"><span id="admlSigSlot"></span><p>_______________________</p><b>The Principal &nbsp;\u00B7&nbsp; <span lang="ar">الْعَمِيد</span></b></div>' +
        '<div class="adml-date"><p>_______________________</p><b>Date &nbsp;\u00B7&nbsp; <span lang="ar">التَّارِيخ</span></b></div>' +
      '</div>' +
      '<div class="adml-foot">AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES &nbsp;\u2014&nbsp; KNOWLEDGE AND WORSHIP</div>' +
    '</div>';

  var wrap = document.getElementById("admLetterWrap");
  wrap.style.display = "block";
  wrap.classList.add("adm-letter-open"); /* FIX (pack 38): tells the print CSS the letter is on top */
  document.body.style.overflow = "hidden";

  /* Stamp the principal's saved signature, if one exists (same source the
     report cards use). Letter still prints fine without it. */
  admLoadSignatures().then(function (sigs) {
    var p = (sigs || []).find(function (s) { return s.role === "principal"; });
    if (p && p.signature_path) {
      var slot = document.getElementById("admlSigSlot");
      if (slot) slot.innerHTML = '<img class="adml-sigimg" src="' + admEsc(p.signature_path) + '" alt="">';
    }
  });
}

function admCloseLetter() {
  var wrap = document.getElementById("admLetterWrap");
  wrap.style.display = "none";
  wrap.classList.remove("adm-letter-open"); /* FIX (pack 38) */
  document.body.style.overflow = "";
}

/* FIX (pack 38, belt & braces): browsers without :has() support get the
   same one-page letter - hide the enquiry board inline (!important wins
   over every stylesheet) just for the print, then restore it after. */
window.addEventListener("beforeprint", function () {
  var wrap = document.getElementById("admLetterWrap");
  var page = document.querySelector(".mng-page");
  if (wrap && page && wrap.classList.contains("adm-letter-open")) {
    page.setAttribute("data-adm-print-hidden", "1");
    page.style.setProperty("display", "none", "important");
  }
});
window.addEventListener("afterprint", function () {
  var page = document.querySelector('.mng-page[data-adm-print-hidden="1"]');
  if (page) {
    page.style.removeProperty("display");
    page.removeAttribute("data-adm-print-hidden");
  }
});
