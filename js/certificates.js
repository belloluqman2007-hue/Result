/* ==========================================================================
   NEW (pack 35): CERTIFICATE GENERATOR (js/certificates.js)
   100% client-side. Reads the same endpoints other pages already use:
   /classes, /sessions, /students, /signatures, /class-signatures,
   /school-settings, /student-position. Writes NOTHING to the server.
   Each certificate = one exact landscape A4 page (stage is 1122x793).
   ========================================================================== */
"use strict";

var certType = "level"; // CHANGED (pack 36)
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

// CHANGED (pack 36): types now mirror the school's real paper
// certificates. "level" is the flagship - the exact paper wording with
// auto-filled name / DoB / admission number, level & theme detected
// automatically from the student's class.
function certLevelOf(cls) {
  var n = String(cls || "").replace(/[\u064B-\u0652\u0670\u0640]/g, "").replace(/[إأآٱ]/g, "ا").replace(/\s+/g, "");
  if (n.indexOf("\u062A\u062D\u0636\u064A\u0631\u064A") !== -1) return { key: "tahdiri", theme: "cert-theme-tahdiri", en: "Preliminary", ar: "التَّحْضِيرِيَّة", study: "preliminary" };
  if (n.indexOf("\u0627\u0628\u062A\u062F\u0627\u0626\u064A") !== -1) return { key: "ibtidai", theme: "", en: "Primary", ar: "الابْتِدَائِيَّة", study: "primary" };
  if (n.indexOf("\u0627\u0639\u062F\u0627\u062F\u064A") !== -1) return { key: "idadi", theme: "cert-theme-idadi", en: "Junior Secondary", ar: "الإِعْدَادِيَّة", study: "junior secondary" };
  if (n.indexOf("\u062B\u0627\u0646\u0648\u064A") !== -1) return { key: "thanawi", theme: "cert-theme-thanawi", en: "Qur'anic", ar: "الثَّانَوِيَّة", study: "Qur'anic" };
  return { key: "gen", theme: "", en: "School", ar: "الشَّهَادَة", study: "school" };
}

var CERT_TYPES = {
  level: {
    code: "CERT",
    levelTitle: true,
    pills: function (lv) { return lv.en + " <small>" + lv.ar + "</small>"; },
    bodyEn: function (o, f) {
      return "The Administration of the above mentioned institution hereby certifies that the student " +
        f.name + " born in " + f.blank60 + " in " + f.blank90 + " state, on the " + f.dobDay + " of " + f.dobMonth + ", " + f.dobYear +
        ", and whose admission number is " + f.adm + " has completed his/her studies at the <b>" + certEsc(o.lv.study) + " level</b>, " +
        "passed all the prescribed subjects at the end of the academic year " + f.ah + " A.H. " + f.ad + " A.D and got the final grade " + f.blank90 + ". " +
        "May Almighty Allah grant him/her more blessings and success. (Aameen).";
    },
    bodyAr: function (o, f) {
      return "تشهد إدارة المدرسة المذكورة أعلاه أنّ الطالب/ة " + f.nameAr + " المولود/ة في ولاية ــــــــ دولة ــــــــ يوم ــــــ شهر ــــــ سنة " + f.ahAr + " هـ / " + f.adAr + " م، " +
        "والمسجَّل برقم " + f.admAr + "، أنهى/ت دراسته/ا بالمرحلة " + o.lv.ar + " في نهاية العام الدراسي " + f.sessionAr + "م " +
        "ونجح/ت في الموادّ الدراسيّة المقرّرة. ونسأل الله العظيم له/ها مزيد البركة والتوفيق. (آمين)";
    }
  },
  excellence: {
    code: "EXC",
    pills: function () { return "Academic Excellence <small>التَّفَوُّق الدِّرَاسِيّ</small>"; },
    bodyEn: function (o, f) {
      return "This is to certify that " + f.name + " of " + f.cls + " distinguished himself/herself with <b>outstanding academic performance</b> in " +
        certEsc(o.term) + ", " + certEsc(o.session) + (o.pos ? ", finishing <b>" + certEsc(o.pos) + "</b>" : "") + ". " +
        "We pray for continued excellence, ameen.";
    },
    bodyAr: function () { return "نشهد أنّ الطالب/ة المذكور/ة أعلاه قد تفوّق/ت دراسيًّا هذا العام، فنسأل الله له/ها دوام التوفيق والنجاح. (آمين)"; }
  },
  tahfeedh: {
    code: "THF",
    pills: function () { return "Tahfeedh Achievement <small>مَرْتَقَى الْحِفْظ</small>"; },
    bodyEn: function (o, f) {
      var j = Math.max(1, Math.min(30, Number(o.juz) || 1));
      return "This is to certify that " + f.name + " has by Allah's grace memorised <b>" + j + " Juz</b> of the glorious Qur'an" +
        (j >= 30 ? ", completing the entire Book — ma sha Allah!" : " — may Allah bless him/her to completion, ameen") + ".";
    },
    bodyAr: function () { return "نسأل الله أن يجعل القرآن ربيع قلبه/قلبها ونور دربه/دربها. (آمين)"; }
  },
  custom: {
    code: "MRT",
    pills: function () { return "Merit <small>تَّمَيُّز</small>"; },
    bodyEn: function (o, f) {
      var c = (o.custom || "").trim();
      return "This is to certify that " + f.name + " is hereby honoured for " + certEsc(c ? c.replace(/\.+$/, "") : "commendable conduct and dedication") + ".";
    },
    bodyAr: function () { return "جزاه الله خيرًا وزاده من فضله. (آمين)"; }
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
  // CHANGED (pack 36): term only matters for academic excellence
  document.getElementById("certTermField").style.display = type === "excellence" ? "" : "none";
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
  var lv = certLevelOf(o.cls);
  var dt = new Date();
  var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var yearBit = (o.session || String(dt.getFullYear())).split("/")[0].replace(/[^0-9]/g, "") || String(dt.getFullYear());
  var y = Number(yearBit) || dt.getFullYear();
  // pack 36b: standard civil approx - AH(2026)=1447, AH(2030)=1451
  var ah = y - 622 + Math.floor((y - 622) / 32);
  var serial = "AMS/" + yearBit + "/" + t.code + "/" + (stu.student_id || "XXX");
  // date of birth -> day / month / year chips
  var dob = { d: "", m: "", y: "" };
  if (stu.date_of_birth) {
    var m2 = String(stu.date_of_birth).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m2) { dob.y = m2[1]; dob.m = months[Number(m2[2]) - 1] || m2[2]; dob.d = m2[3]; }
  }
  var blanks = function (cls) { return '<span class="cert-fill ' + cls + '">&nbsp;</span>'; };
  var f = {
    name: '<span class="cert-fill name">' + certEsc(stu.full_name || "-") + "</span>",
    nameAr: '<span style="border-bottom:1.2px dotted #555; padding:0 8px; font-weight:700; unicode-bidi:isolate;">' + certEsc(stu.full_name || "-") + "</span>",
    blank60: blanks("w60"), blank90: blanks("w90"),
    dobDay: dob.d ? '<span class="cert-fill w60">' + dob.d + "</span>" : blanks("w60"),
    dobMonth: dob.m ? '<span class="cert-fill w90">' + dob.m + "</span>" : blanks("w90"),
    dobYear: dob.y ? '<span class="cert-fill w90">' + dob.y + "</span>" : blanks("w90"),
    adm: '<span class="cert-fill w90">' + certEsc(stu.student_id || "-") + "</span>",
    admAr: '<span style="border-bottom:1.2px dotted #555; padding:0 6px; font-weight:700;">' + certEsc(stu.student_id || "-") + "</span>",
    ah: '<span class="cert-fill w60">' + ah + "</span>",
    ad: '<span class="cert-fill w90">' + certEsc(o.session || "-") + "</span>",
    ahAr: String(ah), adAr: certEsc(o.session || ""), sessionAr: certEsc(o.session || ""),
    cls: '<span class="cert-fill w180">' + certEsc(o.cls || "-") + "</span>"
  };
  var sigT = certSigs.classTeacher ? '<img class="cert-sign-img" src="' + certEsc(certSigs.classTeacher) + '" alt="">' : "";
  var sigP = certSigs.principal ? '<img class="cert-sign-img" src="' + certEsc(certSigs.principal) + '" alt="">' : "";
  var photo = stu.photo_path
    ? '<img src="' + certEsc(stu.photo_path) + '" alt="Passport">'
    : '<span>PASSPORT</span>';
  var dateStr = dt.getDate() + " " + months[dt.getMonth()] + " " + dt.getFullYear();

  return '' +
  '<div class="cert-frame ' + lv.theme + '">' +
    '<div class="cert-tri tl"></div><div class="cert-tri tl2"></div>' +
    '<div class="cert-tri br"></div><div class="cert-tri br2"></div>' +
    '<div class="cert-watermark"><img src="images/LOGO.JPG" alt=""></div>' +
    '<div class="cert-h">' +
      '<div class="cert-h-crest"><img src="images/LOGO.JPG" alt="School crest"></div>' +
      '<div class="cert-h-mid">' +
        '<div class="cert-bismillah" lang="ar">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>' +
        '<div class="cert-h-ar" lang="ar">مَدْرَسَةُ أَمِيْنِ اللّهِ لِلْعُلُومِ الْعَرَبِيَّةِ الْإِسْلَامِيَّةِ</div>' +
        '<div class="cert-h-en">AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES</div>' +
        '<div class="cert-h-addr">' + certEsc(certSchool.addr) + '<br>Email: madrasatuameenillah22@gmail.com</div>' +
        '<div class="cert-motto-pill">MOTTO: KNOWLEDGE AND WORSHIP &nbsp;·&nbsp; <span lang="ar">الشِّعَار: الْعِلْمُ وَالْعِبَادَة</span></div>' +
      "</div>" +
      '<div class="cert-h-right">' +
        '<div class="cert-no"><span>Cert. No.:</span><b>' + certEsc(serial) + '</b></div>' +
        '<div class="cert-no"><span>Batch:</span><b>' + certEsc(o.session || "-") + '</b></div>' +
        '<div class="cert-passport">' + photo + "</div>" +
      "</div>" +
    "</div>" +
    '<div class="cert-trow">' +
      '<div class="cert-level">' + t.pills(lv) + "</div>" +
      '<div class="cert-word">CERTIFICATE</div>' +
    "</div>" +
    '<div class="cert-b">' +
      '<div class="cert-b-ar" lang="ar">' + t.bodyAr(Object.assign({}, o, { lv: lv }), f) + "</div>" +
      '<div class="cert-b-en">' + t.bodyEn(Object.assign({}, o, { lv: lv, pos: posText }), f) + "</div>" +
    "</div>" +
    '<div class="cert-f">' +
      '<div class="cert-sign"><div style="font-size:11px; font-weight:700; margin-bottom:14px;">' + ah + ' هـ &nbsp;/&nbsp; ' + certEsc(dateStr) + ' م</div><div class="ln"></div><small>DATE · التَّارِيخ</small></div>' +
      '<div class="cert-sign">' + sigT + '<div class="ln"></div><small>THE CLASS TEACHER · الْمُعَلِّم</small></div>' +
      '<div class="cert-rosette"></div>' +
      '<div class="cert-sign">' + sigP + '<div class="ln"></div><small>THE PRINCIPAL · الْعَمِيد</small></div>' +
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
  // FIX (pack 36): reveal the card BEFORE measuring, or the first-ever
  // preview measures 0 width and paints the frame at scale 0 (invisible).
  document.getElementById("certPreviewCard").style.display = "";
  var mount = function (posText) {
    wrap.innerHTML = certBuildHtml(stu, posText);
    var frame = wrap.firstChild;
    var scale = Math.max(0.25, Math.min(1, wrap.clientWidth / 1140));
    frame.style.transform = "scale(" + scale + ")";
    wrap.style.height = Math.round(793 * scale + 24) + "px";
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
