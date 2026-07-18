/* ==========================================================================
   NEW FILE (pack 15) - js/calendar-editor.js
   Editor for the madrasah term calendar: build rows/lessons, live preview
   (official letterhead via js/calendar-render.js), save, publish ONE at a
   time, print on one page, download as PDF.
   Endpoints: GET /calendars, POST /calendar, POST /calendar-publish,
   DELETE /calendar/:id (saves are admin-only).
   ========================================================================== */
"use strict";

var calSigMap = {};
var calCache = []; // saved calendars

function calNotify(text, ok) {
  var msg = document.getElementById("calMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4500);
}

function initCalendarPage() {
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
    '<td><input class="calW" type="text" value=""></td>' +
    '<td><input class="calA" type="text" value=""></td>' +
    '<td><input class="calD" type="text" value=""></td>' +
    '<td><input class="calT" type="text" value=""></td>' +
    '<td><button class="mg-btn-light mg-btn-danger" type="button" title="Remove row">\u00D7</button></td>';
  tr.querySelector(".calW").value = r.w || "";
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
    '<td><button class="mg-btn-light mg-btn-danger" type="button" title="Remove row">\u00D7</button></td>';
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
      w: tr.querySelector(".calW").value.trim(),
      act: tr.querySelector(".calA").value.trim(),
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
        calNotify("\u2705 Calendar saved: " + title, true);
        if (res.d.id) document.getElementById("calId").value = res.d.id;
        document.getElementById("calEditorTitle").textContent = title;
        loadCalendars();
      } else {
        calNotify(res.d.message || "Could not save (admin account required).", false);
      }
    })
    .catch(function () { calNotify("Network error - NOT saved.", false); });
}

function loadCalendars() {
  var tbody = document.querySelector("#calListTable tbody");
  fetch("/calendars")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      calCache = Array.isArray(rows) ? rows : [];
      if (!calCache.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#5B6B62;">No calendars saved yet. Edit the template below and press "Save Calendar".</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      calCache.forEach(function (row) {
        var tr = document.createElement("tr");

        var td1 = document.createElement("td");
        var b = document.createElement("b"); b.textContent = row.title;
        td1.appendChild(b);
        tr.appendChild(td1);

        var td2 = document.createElement("td");
        td2.textContent = row.updated_at ? String(row.updated_at).slice(0, 16).replace("T", " ") : "-";
        tr.appendChild(td2);

        var td3 = document.createElement("td");
        td3.innerHTML = Number(row.published) === 1
          ? '<span class="sc-chip sc-chip-live">Live on portal</span>'
          : '<span class="sc-chip sc-chip-soon">Not published</span>';
        tr.appendChild(td3);

        var td4 = document.createElement("td");
        td4.style.whiteSpace = "nowrap";

        function mkBtn(txt, cls, fn, ml) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = cls;
          btn.style.padding = "7px 11px";
          if (ml) btn.style.marginLeft = "6px";
          btn.textContent = txt;
          btn.addEventListener("click", fn);
          return btn;
        }

        td4.appendChild(mkBtn("\u270F Edit", "mg-btn-light", function () {
          document.getElementById("calId").value = row.id;
          document.getElementById("calName").value = row.title;
          document.getElementById("calEditorTitle").textContent = row.title;
          var data = {};
          try { data = JSON.parse(row.doc || "{}"); } catch (e) { data = {}; }
          calFillEditor(Object.keys(data).length ? data : amsDefaultCalendarDoc());
          document.getElementById("calName").value = row.title;
          calPreview();
          window.scrollTo({ top: document.querySelector(".mg-card:nth-of-type(2)").offsetTop - 10, behavior: "smooth" });
        }));

        td4.appendChild(mkBtn(Number(row.published) === 1 ? "\u{1F512} Unpublish" : "\u{1F4E2} Publish", "mg-btn", function () {
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
        }, true));

        td4.appendChild(mkBtn("\u{1F5D1}", "mg-btn-light mg-btn-danger", function () {
          if (!confirm("Delete calendar '" + row.title + "'? It disappears from the parent portal too.")) return;
          fetch("/calendar/" + row.id, { method: "DELETE" })
            .then(function (r) {
              if (r.ok) { calNotify("Calendar deleted.", true); loadCalendars(); }
              else calNotify("Could not delete (admin account required).", false);
            })
            .catch(function () { calNotify("Network error.", false); });
        }, true));

        tr.appendChild(td4);
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#B3261E;">Could not load calendars.</td></tr>';
    });
}

/* --------------------------- download PDF --------------------------- */
function calDownloadPDF() {
  // CHANGED (pack 17 - owner: "the calendar PDF is shrinking, let it fill
  // the page from up to down"): the studio now uses the SAME shared
  // builder as the portal/dashboard - FULL letterhead, FILLS the whole
  // A4 page. File name stays the calendar's own name.
  var name = (document.getElementById("calName").value || "calendar").replace(/[^a-zA-Z0-9\-_ ]/g, "").trim() || "calendar";
  calNotify("Building PDF...", true);
  amsCalendarPDF(calReadDoc(), calSigMap || {}, function () {
    calNotify("\u2705 PDF downloaded (fills the whole page).", true);
  }, name.replace(/\s+/g, "-") + ".pdf");
}
