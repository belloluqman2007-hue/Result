/* ==========================================================================
   NEW FILE (pack 16) - js/teacher-calendar.js
   STAFF calendar viewer for the dashboard (admin AND teachers).
   Owner request: "the calendar ... will also appear for teachers also".

   It shows the PUBLISHED madrasah calendar only - the same one shown on
   the parent portal. If the admin unpublishes or deletes it, this card
   simply disappears (nothing to clean up), so staff never see duplicates
   from different terms. Only ONE calendar can be published at a time by
   design (publishing auto-unpublishes the rest).

   READ-ONLY here: staff can view it and download the PDF. Creating,
   editing, publishing and deleting stay admin-only in the calendar
   studio (manage-calendars.html) and the server enforces that.
   Additive - touches no other module.
   ========================================================================== */
(function () {
  "use strict";

  var tcSigMap = null; // NEW (pack 17): signature map for the full-page PDF

  var card = document.getElementById("amsPubCalCard");
  if (!card) return; // not on the dashboard - nothing to do

  // Load ONLY the live (published) calendar. Not logged-in staff or an
  // empty result both keep the card hidden.
  fetch("/calendars?published=1")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) return; // nothing published -> stay hidden
      var cal = rows[0]; // only ONE can be published at a time by design
      var data = {};
      try { data = JSON.parse(cal.doc || "{}"); } catch (e) { data = {}; }
      var titleEl = document.getElementById("amsPubCalTitle");
      if (titleEl) titleEl.textContent = cal.title || "";
      // Same renderer + saved signature images as the portal/studio.
      amsFetchSignatureMap(function (map) {
        tcSigMap = map; // kept for the PDF
        var holder = document.getElementById("amsPubCalHolder");
        if (!holder) return;
        holder.innerHTML = "";
        // CHANGED (pack 17 - owner request): compact view on screen (no
        // long letterhead for teachers); the PDF keeps the FULL design.
        holder.appendChild(amsBuildCalendarSheet(data, map, { compact: true }));
        card.dataset.calDoc = cal.doc || "{}"; // kept for the PDF
        card.style.display = "block";
      });
    })
    .catch(function () { /* stay hidden */ });

  // Download the calendar as a ONE-page A4 PDF that FILLS the page.
  var pdfBtn = document.getElementById("amsPubCalPdfBtn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", function () {
      var data = {};
      try { data = JSON.parse(card.dataset.calDoc || "{}"); } catch (e) { data = {}; }
      pdfBtn.disabled = true;
      pdfBtn.textContent = "Building...";
      // CHANGED (pack 17): shared builder - FULL letterhead, fills A4.
      amsCalendarPDF(data, tcSigMap || {}, function () {
        pdfBtn.disabled = false;
        pdfBtn.textContent = "\u2B07 Download PDF";
      });
    });
  }
})();
