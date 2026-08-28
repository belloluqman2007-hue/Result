/* ==========================================================================
   js/calendar-editor.js  (BEAUTY UPGRADE)
   -------------------------------------------------------------------------- 
   Editor for the madrasah term calendar. Renders rows/lessons, live
   preview (official letterhead via js/calendar-render.js), save, publish
   ONE at a time, print on one page, download as PDF.

   Endpoints: GET /calendars, POST /calendar, POST /calendar-publish,
   DELETE /calendar/:id (saves are admin-only).

   This file is the BINDING layer between the new .mcb-* classes in
   manage-calendars.html / css/calendar-beauty.css and the underlying
   API. The render logic itself lives in js/calendar-render.js.
   ========================================================================== */
"use strict";

var calSigMap = {};
var calCache = []; // saved calendars

function calNotify(text, ok) {
  var msg = document.getElementById("calMsg");
  var txt = document.getElementById("calMsgText");
  if (!msg || !txt) return;
  txt.textContent = text;
  msg.className = "mcb-msg " + (ok ? "ok" : "err");
  // swap icon depending on state
  var svg = msg.querySelector("svg");
  if (svg && ok) {
    svg.innerHTML = '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>';
  } else if (svg) {
    svg.innerHTML = '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>';
  }
  clearTimeout(calNotify._t);
  calNotify._t = setTimeout(function () { msg.className = "mcb-msg"; }, 4500);
}

/* Keep the hero "Now editing" chip in sync with the editor title. */
function calSyncEditingChip() {
  var t = document.getElementById("calEditorTitle");
  var chip = document.getElementById("mcbEditingTitle");
  if (t && chip) chip.textContent = t.textContent || "New Calendar";
  var name = document.getElementById("calName");
  if (name && chip && name.value) chip.textContent = name.value;
}

function initCalendarPage() {
  calBindPrintFit();       // NEW (A4 fix pack): one-page print guard
  amsFetchSignatureMap(function (map) {
    calSigMap = map;
    calNew();          // fills the editor with the school's real template
    loadCalendars();
  });
}

/* ------------------------- editor state ----------------------------- */
function calAddRow(r) {
  var tbody = document.querySelector("#calRowsTable tbody");
  var tr = document.createElement("tr");
  r = r || { w: "", act: "", days: "", date: "" };
  tr.innerHTML =
    '<td><input class="mcb-week" type="text" value=""></td>' +
    '<td><input class="calA" type="text" value=""></td>' +
    '<td><input class="calD" type="text" value=""></td>' +
    '<td><input class="calT" type="text" value=""></td>' +
    '<td><button class="mcb-del" type="button" title="Remove row">&times;</button></td>';
  tr.querySelector(".calW, .mcb-week").value = r.w || "";
  tr.querySelector(".calA").value = r.act || "";
  tr.querySelector(".calD").value = r.days || "";
  tr.querySelector(".calT").value = r.date || "";
  tr.querySelector("button").addEventListener("click", function () { tr.remove(); calPreview(); });
  tr.querySelectorAll("input").forEach(function (i) { i.addEventListener("input", calPreview); });
  tbody.appendChild(tr);
}

function calAddLesson(l) {
  var tbody = document.querySelector("#calLessonsTable tbody");
  var tr = document.createElement("tr");
  l = l || { text: "", time: "" };
  tr.innerHTML =
    '<td><input class="lesT" type="text" value=""></td>' +
    '<td><input class="lesV" type="text" value=""></td>' +
    '<td><button class="mcb-del" type="button" title="Remove row">&times;</button></td>';
  tr.querySelector(".lesT").value = l.text || "";
  tr.querySelector(".lesV").value = l.time || "";
  tr.querySelector("button").addEventListener("click", function () { tr.remove(); calPreview(); });
  tr.querySelectorAll("input").forEach(function (i) { i.addEventListener("input", calPreview); });
  tbody.appendChild(tr);
}

function calReadDoc() {
  var rows = [];
  document.querySelectorAll("#calRowsTable tbody tr").forEach(function (tr) {
    rows.push({
      w:    (tr.querySelector(".mcb-week") || tr.querySelector(".calW")).value.trim(),
      act:  tr.querySelector(".calA").value.trim(),
      days: tr.querySelector(".calD").value.trim(),
      date: tr.querySelector(".calT").value.trim()
    });
  });
  var lessons = [];
  document.querySelectorAll("#calLessonsTable tbody tr").forEach(function (tr) {
    lessons.push({
      text: tr.querySelector(".lesT").value.trim(),
      time: tr.querySelector(".lesV").value.trim()
    });
  });
  return {
    our_ref: document.getElementById("calOurRef").value.trim(),
    your_ref: document.getElementById("calYourRef").value.trim(),
    doc_date: document.getElementById("calDocDate").value.trim(),
    title_line: document.getElementById("calTitleLine").value.trim(),
    weeks_col: document.getElementById("calWeeksCol").value.trim(),
    rows: rows,
    note_label: document.getElementById("calNoteLabel").value.trim(),
    note_days: document.getElementById("calNoteDays").value.trim(),
    note_date: document.getElementById("calNoteDate").value.trim(),
    lessons_title: document.getElementById("calLessonsTitle").value.trim(),
    lessons: lessons,
    sig1_role: document.getElementById("calSig1Role").value,
    sig1_title: document.getElementById("calSig1Title").value.trim(),
    sig2_role: document.getElementById("calSig2Role").value,
    sig2_title: document.getElementById("calSig2Title").value.trim()
  };
}

function calFillEditor(data) {
  document.getElementById("calOurRef").value = data.our_ref || "";
  document.getElementById("calYourRef").value = data.your_ref || "";
  document.getElementById("calDocDate").value = data.doc_date || "";
  document.getElementById("calTitleLine").value = data.title_line || "";
  document.getElementById("calWeeksCol").value = data.weeks_col || "(14 WEEKS) ACTIVITIES";
  document.getElementById("calNoteLabel").value = data.note_label || "";
  document.getElementById("calNoteDays").value = data.note_days || "";
  document.getElementById("calNoteDate").value = data.note_date || "";
  document.getElementById("calLessonsTitle").value = data.lessons_title || "LESSON TIMES AND HOURS:";
  document.getElementById("calSig1Role").value = data.sig1_role || "";
  document.getElementById("calSig1Title").value = data.sig1_title || "THE HEAD TEACHER";
  document.getElementById("calSig2Role").value = data.sig2_role || "";
  document.getElementById("calSig2Title").value = data.sig2_title || "THE PROPRIETOR";

  document.querySelector("#calRowsTable tbody").innerHTML = "";
  (data.rows || []).forEach(calAddRow);
  document.querySelector("#calLessonsTable tbody").innerHTML = "";
  (data.lessons || []).forEach(calAddLesson);

  calSyncEditingChip();
}

function calNew() {
  document.getElementById("calId").value = "";
  document.getElementById("calName").value = "";
  document.getElementById("calEditorTitle").textContent = "New Calendar";
  calFillEditor(amsDefaultCalendarDoc());
  calPreview();
}

function calPreview() {
  var wrap = document.getElementById("calPreviewWrap");
  wrap.innerHTML = "";
  wrap.appendChild(amsBuildCalendarSheet(calReadDoc(), calSigMap));
  calFitPreview();          // NEW (A4 fix pack): keep it on ONE page
  calSyncEditingChip();
}

/* ==========================================================================
   NEW (A4 fix pack - owner report: "the print calendar goes beyond A4")
   --------------------------------------------------------------------------
   Measures the rendered letterhead at the EXACT geometry the printer uses
   (.cal-printfit = 190mm wide, 8mm/10mm padding, desktop layout with the two
   signatures side by side) and lets amsFitCalendarSheet() shrink it - first by
   tightening the typography, then by scaling - until it is guaranteed to fit
   one A4 page. The density classes stay on the sheet (so the preview is what
   prints); the measuring class comes straight back off.
   ========================================================================== */
function calFitPreview() {
  var wrap = document.getElementById("calPreviewWrap");
  if (!wrap || !window.amsFitCalendarSheet) return null;
  var sheet = wrap.querySelector(".cal-sheet");
  if (!sheet) return null;

  sheet.classList.add("cal-printfit");
  var fit = window.amsFitCalendarSheet(sheet, {
    widthMm: 190,   /* sheet width the printer gets */
    heightMm: 279,  /* A4 297mm - 2 x 8mm @page margin, minus 2mm of slack */
    sizer: wrap
  });
  sheet.classList.remove("cal-printfit");
  return fit;
}

/* Re-fit when the paper is about to be used: the print dialog, and any
   rotation/resize that changes the layout. */
function calBindPrintFit() {
  window.addEventListener("beforeprint", calFitPreview);
  window.addEventListener("afterprint", calFitPreview);
  var t = null;
  window.addEventListener("resize", function () {
    clearTimeout(t);
    t = setTimeout(calFitPreview, 200);
  });
}

/* ---------------------------- save / list --------------------------- */
function calSave() {
  var title = document.getElementById("calId").value
    ? (calCache.find(function (c) { return String(c.id) === String(document.getElementById("calId").value); }) || {}).title
    : "";
  title = (document.getElementById("calName").value || title || "").trim();
  if (!title) {
    var first = (calReadDoc().rows[0] || {}).act || "Calendar";
    title = document.getElementById("calTitleLine").value.trim().split("(")[0].trim() || first;
    document.getElementById("calName").value = title;
  }

  calNotify("Saving…", true);

  fetch("/calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: Number(document.getElementById("calId").value) || 0,
      title: title,
      doc: JSON.stringify(calReadDoc())
    })
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) {
        calNotify("Calendar saved: " + title, true);
        if (res.d.id) document.getElementById("calId").value = res.d.id;
        document.getElementById("calEditorTitle").textContent = title;
        calSyncEditingChip();
        loadCalendars();
      } else {
        calNotify(res.d.message || "Could not save (admin account required).", false);
      }
    })
    .catch(function () { calNotify("Network error - NOT saved.", false); });
}

/* Tiny helper to build a pill-style icon button. */
function calMakeBtn(opts) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mcb-icbtn " + (opts.cls || "");
  btn.title = opts.title || opts.label || "";
  if (opts.svg) btn.innerHTML = opts.svg;
  if (opts.label) btn.appendChild(document.createTextNode(" " + opts.label));
  btn.addEventListener("click", opts.onClick);
  return btn;
}

var ICONS = {
  edit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
  lock:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  trash:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
};

function loadCalendars() {
  var tbody = document.querySelector("#calListTable tbody");
  var countChip = document.getElementById("mcbCountChip");
  fetch("/calendars")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      calCache = Array.isArray(rows) ? rows : [];
      if (countChip) {
        countChip.textContent = calCache.length + (calCache.length === 1 ? " saved" : " saved");
      }
      if (!calCache.length) {
        tbody.innerHTML =
          '<tr><td colspan="4"><div class="mcb-empty">' +
            '<span class="ico">&#128193;</span>' +
            'No calendars saved yet. Edit the template above and press <b>Save Calendar</b>.' +
          '</div></td></tr>';
        return;
      }
      tbody.innerHTML = "";
      calCache.forEach(function (row) {
        var tr = document.createElement("tr");

        var td1 = document.createElement("td");
        td1.className = "mcb-name";
        var b = document.createElement("b"); b.textContent = row.title;
        td1.appendChild(b);
        var small = document.createElement("small");
        var d = (row.doc && (function(){ try { return JSON.parse(row.doc).doc_date || ""; } catch(e){ return ""; } })()) || "";
        small.textContent = d ? "Document date: " + d : "—";
        td1.appendChild(small);
        tr.appendChild(td1);

        var td2 = document.createElement("td");
        td2.textContent = row.updated_at ? String(row.updated_at).slice(0, 16).replace("T", " ") : "-";
        tr.appendChild(td2);

        var td3 = document.createElement("td");
        if (Number(row.published) === 1) {
          td3.innerHTML = '<span class="mcb-chip mcb-chip-live"><span class="mcb-chip-dot"></span>Live on portal</span>';
        } else {
          td3.innerHTML = '<span class="mcb-chip mcb-chip-soon"><span class="mcb-chip-dot" style="background:#C9A227;box-shadow:0 0 0 3px rgba(201,162,39,.18);"></span>Not published</span>';
        }
        tr.appendChild(td3);

        var td4 = document.createElement("td");
        td4.style.textAlign = "right";
        var cell = document.createElement("div");
        cell.className = "mcb-actions-cell";
        cell.style.justifyContent = "flex-end";

        cell.appendChild(calMakeBtn({
          cls: "mcb-icbtn-edit",
          label: "Edit",
          svg: ICONS.edit,
          onClick: function () {
            document.getElementById("calId").value = row.id;
            document.getElementById("calName").value = row.title;
            document.getElementById("calEditorTitle").textContent = row.title;
            var data = {};
            try { data = JSON.parse(row.doc || "{}"); } catch (e) { data = {}; }
            calFillEditor(Object.keys(data).length ? data : amsDefaultCalendarDoc());
            document.getElementById("calName").value = row.title;
            calPreview();
            calSyncEditingChip();
            var firstCard = document.querySelectorAll(".mcb-card")[1];
            if (firstCard) window.scrollTo({ top: firstCard.offsetTop - 10, behavior: "smooth" });
          }
        }));

        cell.appendChild(calMakeBtn({
          cls: Number(row.published) === 1 ? "mcb-icbtn-unpub" : "mcb-icbtn-pub",
          label: Number(row.published) === 1 ? "Unpublish" : "Publish",
          svg: Number(row.published) === 1 ? ICONS.lock : ICONS.unlock,
          onClick: function () {
            calNotify(Number(row.published) === 1 ? "Unpublishing…" : "Publishing…", true);
            fetch("/calendar-publish", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: row.id, published: Number(row.published) === 1 ? 0 : 1 })
            })
              .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
              .then(function (res) {
                calNotify(res.d.message || (res.ok ? "Done." : "Failed."), res.ok);
                loadCalendars();
              })
              .catch(function () { calNotify("Network error.", false); });
          }
        }));

        cell.appendChild(calMakeBtn({
          cls: "mcb-icbtn-del",
          title: "Delete",
          svg: ICONS.trash,
          onClick: function () {
            if (!confirm("Delete calendar '" + row.title + "'? It disappears from the parent portal too.")) return;
            calNotify("Deleting…", true);
            fetch("/calendar/" + row.id, { method: "DELETE" })
              .then(function (r) {
                if (r.ok) { calNotify("Calendar deleted.", true); loadCalendars(); }
                else calNotify("Could not delete (admin account required).", false);
              })
              .catch(function () { calNotify("Network error.", false); });
          }
        }));

        td4.appendChild(cell);
        tr.appendChild(td4);
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML =
        '<tr><td colspan="4"><div class="mcb-empty" style="border-color:#F0C4C0;color:#B3261E;">' +
          '<span class="ico">&#9888;</span>Could not load calendars. Pull to retry.' +
        '</div></td></tr>';
    });
}

/* --------------------------- download PDF --------------------------- */
function calDownloadPDF() {
  var name = (document.getElementById("calName").value || "calendar").replace(/[^a-zA-Z0-9\-_ ]/g, "").trim() || "calendar";
  calNotify("Building PDF…", true);
  amsCalendarPDF(calReadDoc(), calSigMap || {}, function () {
    calNotify("PDF downloaded (fills the whole page).", true);
  }, name.replace(/\s+/g, "-") + ".pdf");
}
