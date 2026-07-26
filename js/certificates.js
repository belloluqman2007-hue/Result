/* ==========================================================================
   NEW (pack 35): CERTIFICATE GENERATOR (js/certificates.js)
   100% client-side. Reads the same endpoints other pages already use:
   /classes, /sessions, /students, /signatures, /class-signatures,
   /school-settings, /student-position. Writes NOTHING to the server.
   Each certificate = one exact landscape A4 page (stage is 1122x793).
   ========================================================================== */
"use strict";

var certType = "excellence";
var certStudents = [];     // students of the chosen class
var certChecked = {};      // student_id -> true/false
var certIndex = 0;         // which selected student is in the preview
var certPosCache = {};     // student_id -> "3rd of 24" (excellence)
var certSigs = { classTeacher: null, principal: null };
var certSchool = {
  // fallback; live values from /school-settings win when available
  name: "AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES",
  nameAr: "مدرسة أمين اللّه للعلوم العربيّة الإسلاميّة",
  addr: "3, Temidire Street, Off Ondo Road, Ijebu-Ode, Ogun State.  •  Tel: 08062445559, 08058306889",
  motto: "MOTTO: KNOWLEDGE AND WORSHIP",
  mottoAr: "شعارنا: العلم والعبادة"
};
var certBusy = false;

var CERT_TYPES = {
  excellence: {
    code: "EXC", title: "OF ACADEMIC EXCELLENCE",
    body: function (o) {
      return "for outstanding academic performance in <b>" + certEsc(o.term) + ", " + certEsc(o.session) + "</b>" +
        (o.cls ? " in <b>" + certEsc(o.cls) + "</b>" : "") +
        (o.pos ? ", finishing <b>" + certEsc(o.pos) + "</b>" : "") + ".";
    }
  },
  completion: {
    code: "CMP", title: "OF COMPLETION",
    body: function (o) {
      return "for the successful completion of <b>" + certEsc(o.cls) + "</b> in the <b>" + certEsc(o.session) + "</b> academic session. Barakallahu feeha.";
    }
  },
  tahfeedh: {
    code: "THF", title: "OF TAHFEEDH ACHIEVEMENT",
    body: function (o) {
      var j = Math.max(1, Math.min(30, Number(o.juz) || 1));
      return "for the memorisation of <b>" + j + " Juz" + (j === 1 ? "" : "") + "</b> of the glorious Qur'an" +
        (j >= 30 ? " — completing the entire Book, ma sha Allah." : " — may Allah grant completion.") + ".";
    }
  },
  custom: {
    code: "MRT", title: "OF MERIT",
    body: function (o) {
      var c = (o.custom || "").trim();
      return c ? certEsc(c.replace(/\.+$/, "")) + "." : "for commendable conduct and dedication.";
    }
  }
};

function certEsc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function certNotify(text, ok) {
  var msg = document.getElementById("certMsg");
  if (!msg) return;
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4500);
}

function certOpts() {
  return {
    term: document.getElementById("certTerm").value,
    session: document.getElementById("certSession").value.trim(),
    juz: document.getElementById("certJuz").value,
    cls: document.getElementById("certClass").value,
    custom: document.getElementById("certCustom").value
  };
}

function certSelected() {
  return certStudents.filter(function (s) { return certChecked[s.student_id]; });
}

/* ---------------- boot ---------------- */
function certInit() {
  fetch("/classes").then(function (r) { return r.json(); }).then(function (rows) {
    var sel = document.getElementById("certClass");
    sel.innerHTML = '<option value="">Select class</option>';
    (rows || []).forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.class_name; o.textContent = c.class_name;
      sel.appendChild(o);
    });
  }).catch(function () {});

  fetch("/sessions").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    if (!Array.isArray(rows)) return;
    var list = document.getElementById("certSessionList");
    list.innerHTML = "";
    rows.forEach(function (row) {
      var o = document.createElement("option");
      o.value = row.session; o.textContent = row.session + (Number(row.is_current) === 1 ? " (current)" : "");
      list.appendChild(o);
    });
    var cur = rows.find(function (x) { return Number(x.is_current) === 1; });
    if (cur) document.getElementById("certSession").value = cur.session;
  }).catch(function () {});

  // signatures + live school profile (public endpoints, also used by receipts)
  fetch("/signatures").then(function (r) { return r.json(); }).then(function (rows) {
    if (Array.isArray(rows)) {
      var p = rows.find(function (x) { return x.role === "principal"; });
      var t = rows.find(function (x) { return x.role === "class_teacher"; });
      if (p) certSigs.principal = p.signature_path;
      if (t && !certSigs.classTeacher) certSigs.classTeacher = t.signature_path;
      certRefresh(true);
    }
  }).catch(function () {});
  fetch("/school-settings").then(function (r) { return r.ok ? r.json() : {}; }).then(function (s) {
    if (s && s.school_name) {
      certSchool.name = String(s.school_name).toUpperCase();
      if (s.school_name_ar) certSchool.nameAr = s.school_name_ar;
      var bits = [];
      if (s.address) bits.push(s.address);
      if (s.phone1) bits.push("Tel: " + s.phone1 + (s.phone2 ? ", " + s.phone2 : ""));
      if (s.email) bits.push(s.email);
      if (bits.length) certSchool.addr = bits.join("  •  ");
      if (s.motto) certSchool.motto = "MOTTO: " + String(s.motto).toUpperCase();
      if (s.motto_ar) certSchool.mottoAr = s.motto_ar;
      certRefresh(true);
    }
  }).catch(function () {});
}

/* ---------------- type switching ---------------- */
function certSetType(type) {
  certType = type;
  document.querySelectorAll(".cert-type").forEach(function (b) {
    b.classList.toggle("active", b.getAttribute("data-type") === type);
  });
  document.getElementById("certJuzField").style.display = type === "tahfeedh" ? "" : "none";
  document.getElementById("certCustomWrap").style.display = type === "custom" ? "" : "none";
  document.getElementById("certTermField").style.display = (type === "completion" || type === "tahfeedh") ? "none" : "";
  certRefresh(true);
}

/* ---------------- students ---------------- */
function certLoadStudents() {
  var cls = document.getElementById("certClass").value;
  var box = document.getElementById("certStudents");
  document.getElementById("certPreviewCard").style.display = "none";
  if (!cls) { box.innerHTML = '<div class="fin-ov-empty">Choose a class to see its students.</div>'; return; }
  box.innerHTML = '<div class="fin-ov-empty">Loading students...</div>';
  fetch("/students").then(function (r) { return r.json(); }).then(function (rows) {
    certStudents = (rows || []).filter(function (s) { return s.class_name === cls; });
    certChecked = {};
    certStudents.forEach(function (s) { certChecked[s.student_id] = true; });
    certPosCache = {};
    certRenderStudents();
    certRefresh(true);
  }).catch(function () {
    box.innerHTML = '<div class="fin-ov-empty">Could not load students - check connection.</div>';
  });
}

function certRenderStudents() {
  var q = document.getElementById("certSearch").value.trim().toLowerCase();
  var box = document.getElementById("certStudents");
  if (!certStudents.length) { box.innerHTML = '<div class="fin-ov-empty">No students in this class.</div>'; return; }
  var html = "";
  certStudents.forEach(function (s) {
    if (q && (s.full_name || "").toLowerCase().indexOf(q) === -1 && (s.student_id || "").toLowerCase().indexOf(q) === -1) return;
    var on = !!certChecked[s.student_id];
    html += '<label class="cert-stu ' + (on ? "" : "off") + '">' +
      '<input type="checkbox" data-sid="' + certEsc(s.student_id) + '" ' + (on ? "checked" : "") + ' onchange="certToggle(this)">' +
      '<span><b>' + certEsc(s.full_name) + "</b><small>" + certEsc(s.student_id) + "</small></span></label>";
  });
  box.innerHTML = html || '<div class="fin-ov-empty">No student matches that search.</div>';
  certUpdateCount();
}

function certUpdateCount() {
  var n = certSelected().length;
  document.getElementById("certCount").textContent = n + " of " + certStudents.length + " selected";
}

function certToggle(input) {
  certChecked[input.getAttribute("data-sid")] = input.checked;
  input.closest(".cert-stu").classList.toggle("off", !input.checked);
  certUpdateCount();
  certRefresh(false);
}

function certToggleAll() {
  var on = document.getElementById("certAll").checked;
  certStudents.forEach(function (s) { certChecked[s.student_id] = on; });
  certRenderStudents();
  certRefresh(false);
}

/* ---------------- the certificate markup ---------------- */
function certBuildHtml(stu, posText) {
  var o = certOpts();
  var t = CERT_TYPES[certType];
  var dt = new Date();
  var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var dateStr = dt.getDate() + " " + months[dt.getMonth()] + " " + dt.getFullYear();
  var yearBit = (o.session || String(dt.getFullYear())).split("/")[0].replace(/[^0-9]/g, "") || String(dt.getFullYear());
  var serial = "AMS/" + yearBit + "/" + t.code + "/" + (stu.student_id || "XXX");
  var sigT = certSigs.classTeacher ? '<img class="cert-sig-img" src="' + certEsc(certSigs.classTeacher) + '" alt="">' : "";
  var sigP = certSigs.principal ? '<img class="cert-sig-img" src="' + certEsc(certSigs.principal) + '" alt="">' : "";

  return '' +
  '<div class="cert-frame">' +
    '<div class="cert-corner tl"><i></i></div><div class="cert-corner tr"><i></i></div>' +
    '<div class="cert-corner bl"><i></i></div><div class="cert-corner br"><i></i></div>' +
    '<div class="cert-watermark"><img src="images/LOGO.JPG" alt=""></div>' +
    '<div class="cert-inner">' +
      '<img class="cert-logo" src="images/LOGO.JPG" alt="School crest">' +
      '<div class="cert-school-ar" lang="ar">' + certEsc(certSchool.nameAr) + "</div>" +
      '<div class="cert-school">' + certEsc(certSchool.name) + "</div>" +
      '<div class="cert-addr">' + certEsc(certSchool.addr) + "</div>" +
      '<div class="cert-rule"></div>' +
      '<div class="cert-kicker">CERTIFICATE</div>' +
      '<div class="cert-title">' + certEsc(t.title) + "</div>" +
      '<div class="cert-givento">This is proudly presented to</div>' +
      '<div class="cert-name">' + certEsc(stu.full_name || "-") + "</div>" +
      '<div class="cert-name-line"></div>' +
      '<div class="cert-body">' + t.body({ term: o.term, session: o.session, cls: o.cls, juz: o.juz, custom: o.custom, pos: posText }) + "</div>" +
      '<div class="cert-foot">' +
        '<div class="cert-date"><b>' + certEsc(dateStr) + '</b><div class="ln"></div><span>IJEBU-ODE · DATE</span></div>' +
        '<div class="cert-sig">' + sigT + '<div class="ln"></div><small>CLASS TEACHER</small></div>' +
        '<div class="cert-seal"><span class="st">★</span><span>AMSAIS</span><span>OFFICIAL SEAL</span></div>' +
        '<div class="cert-sig">' + sigP + '<div class="ln"></div><small>PRINCIPAL</small></div>' +
      "</div>" +
      '<div class="cert-serial">Certificate No: ' + certEsc(serial) + "</div>" +
      '<div class="cert-ar-seal" lang="ar">' + certEsc(certSchool.mottoAr) + "</div>" +
    "</div>" +
  "</div>";
}

/* ---------------- preview ---------------- */
function certRefresh(forceIndex) {
  var sel = certSelected();
  var card = document.getElementById("certPreviewCard");
  if (!sel.length) { card.style.display = "none"; return; }
  if (forceIndex) certIndex = 0;
  if (certIndex >= sel.length) certIndex = sel.length - 1;
  if (certIndex < 0) certIndex = 0;
  var stu = sel[certIndex];
  document.getElementById("certPrevName").textContent = (certIndex + 1) + "/" + sel.length + "  -  " + stu.full_name;
  certPaintPreview(stu);
}

function certPaintPreview(stu) {
  var wrap = document.getElementById("certPreviewWrap");
  var mount = function (posText) {
    wrap.innerHTML = certBuildHtml(stu, posText);
    var frame = wrap.firstChild;
    var scale = Math.min(1, wrap.clientWidth / 1140);
    frame.style.transform = "scale(" + scale + ")";
    wrap.style.height = Math.round(793 * scale + 24) + "px";
    document.getElementById("certPreviewCard").style.display = "";
    document.getElementById("certAllBtn").innerHTML = "&#128230; Download " + certSelected().length + " selected (PDF)";
  };
  mount("");
  if (certType === "excellence") certPosition(stu).then(function (pos) { if (pos) mount(pos); });
}

function certNav(d) {
  var sel = certSelected();
  if (!sel.length) return;
  certIndex = (certIndex + d + sel.length) % sel.length;
  certRefresh(false);
}

function certPosition(stu) {
  if (certPosCache[stu.student_id] !== undefined) return Promise.resolve(certPosCache[stu.student_id]);
  var o = certOpts();
  return fetch("/student-position/" + encodeURIComponent(stu.student_id) + "?term=" + encodeURIComponent(o.term) + "&session=" + encodeURIComponent(o.session))
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (j) {
      var txt = "";
      if (j && j.position && j.students) {
        var sfx = "th";
        if (j.position % 10 === 1 && j.position !== 11) sfx = "st";
        else if (j.position % 10 === 2 && j.position !== 12) sfx = "nd";
        else if (j.position % 10 === 3 && j.position !== 13) sfx = "rd";
        txt = j.position + sfx + " of " + j.students + " students";
      }
      certPosCache[stu.student_id] = txt;
      return txt;
    })
    .catch(function () { certPosCache[stu.student_id] = ""; return ""; });
}

/* ---------------- PDF capture ---------------- */
function certWaitAll(node) {
  var imgs = Array.prototype.slice.call(node.querySelectorAll("img"));
  return Promise.all(imgs.map(function (img) {
    if (img.complete) return Promise.resolve();
    return new Promise(function (res) { img.onload = res; img.onerror = res; setTimeout(res, 4000); });
  })).then(function () { return document.fonts ? document.fonts.ready : null; });
}

function certStageFor(stu, posText) {
  var stage = document.createElement("div");
  stage.style.cssText = "position:fixed; left:-13000px; top:0; width:1122px; height:793px; background:#fff; z-index:-1;";
  stage.innerHTML = certBuildHtml(stu, posText);
  document.body.appendChild(stage);
  return stage;
}

function certCapture(stage) {
  return certWaitAll(stage).then(function () {
    return html2canvas(stage.firstChild, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  }).then(function (canvas) {
    document.body.removeChild(stage);
    // blank-canvas guard (same symptom the exam/zip tools guard against)
    try {
      var probe = document.createElement("canvas"); probe.width = 40; probe.height = 40;
      var cx = probe.getContext("2d"); cx.drawImage(canvas, 0, 0, 40, 40);
      var d = cx.getImageData(0, 0, 40, 40).data, ink = 0;
      for (var i = 0; i < d.length; i += 4) { if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) ink++; }
      if (ink < 6) return null;
    } catch (e) {}
    return canvas.toDataURL("image/jpeg", 0.96);
  });
}

function certNewPdf() {
  return new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
}

function certDownloadOne() {
  var sel = certSelected();
  if (!sel.length || certBusy) return;
  var stu = sel[certIndex] || sel[0];
  certNotify("Building " + stu.full_name + "'s certificate...", true);
  certPosition(stu).then(function (pos) {
    return certCapture(certStageFor(stu, pos));
  }).then(function (url) {
    if (!url) { certNotify("Capture came back blank - try again."); return; }
    var pdf = certNewPdf();
    pdf.addImage(url, "JPEG", 0, 0, 297, 210);
    var safe = (stu.student_id + "-" + stu.full_name).replace(/[\\/:*?"<>|]+/g, "_");
    pdf.save("certificate-" + certType + "-" + safe + ".pdf");
    certNotify("Certificate downloaded ✓", true);
  }).catch(function () { certNotify("Could not build the PDF - try again."); });
}

function certDownloadAll() {
  var sel = certSelected();
  if (!sel.length || certBusy) return;
  certBusy = true;
  var btn = document.getElementById("certAllBtn");
  btn.disabled = true;
  var pdf = null, done = 0, built = 0;
  var o = certOpts();
  (function next(i) {
    if (i >= sel.length) {
      btn.disabled = false; certBusy = false;
      btn.innerHTML = "&#128230; Download " + sel.length + " selected (PDF)";
      if (!built) { certNotify("No certificate could be built."); return; }
      var safe = (o.cls || "class").replace(/[\\/:*?"<>|]+/g, "_");
      pdf.save("certificates-" + certType + "-" + safe + "-" + (o.session || "").replace(/[\\/:*?"<>|]+/g, "_") + ".pdf");
      certNotify("Downloaded ✓ " + built + " certificate(s) in one PDF (" + sel.length + " page" + (sel.length > 1 ? "s" : "") + ").", true);
      return;
    }
    var stu = sel[i];
    btn.innerHTML = "Building " + (i + 1) + "/" + sel.length + " - " + certEsc(stu.full_name.split(" ")[0]) + "...";
    certPosition(stu)
      .then(function (pos) { return certCapture(certStageFor(stu, pos)); })
      .then(function (url) {
        done++;
        if (url) {
          if (!pdf) pdf = certNewPdf(); else pdf.addPage("a4", "landscape");
          pdf.addImage(url, "JPEG", 0, 0, 297, 210);
          built++;
        }
      })
      .catch(function () {})
      .then(function () { setTimeout(function () { next(i + 1); }, 60); });
  })(0);
}
