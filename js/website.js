/* ==========================================================================
   NEW FILE (pack 13) - js/website.js
   Public school website behaviour: admission enquiry form + footer year.
   Talks ONLY to the new /admission-enquiry endpoint. Additive.
   ========================================================================== */
(function () {
  "use strict";

  var yearEl = document.getElementById("scYear");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // NEW (pack 14): if the admin has updated the school profile on the
  // School Settings page, the footer follows it. Falls back to the
  // hard-coded defaults when nothing is saved yet. Graceful, read-only.
  fetch("/school-settings")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      var addr = document.getElementById("scFooterAddr");
      var contact = document.getElementById("scFooterContact");
      if (addr && d.address) addr.textContent = d.address;
      if (contact) {
        var parts = [];
        if (d.phone1) parts.push(d.phone1);
        if (d.phone2) parts.push(d.phone2);
        var line = "";
        if (parts.length) line += "Tel: " + parts.join(", ");
        if (d.email) line += (line ? " · Email: " : "Email: ") + d.email;
        if (line) contact.textContent = line;
      }
    })
    .catch(function () { /* defaults stay */ });

  var form = document.getElementById("admissionForm");
  if (!form) return;

  var msg = document.getElementById("admMsg");
  var btn = document.getElementById("admSubmit");

  function show(text, ok) {
    msg.textContent = text;
    msg.className = "sc-form-msg " + (ok ? "ok" : "err");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.className = "sc-form-msg";
    btn.disabled = true;
    btn.textContent = "Sending...";

    fetch("/admission-enquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        child_name: document.getElementById("admChild").value.trim(),
        parent_name: document.getElementById("admParent").value.trim(),
        phone: document.getElementById("admPhone").value.trim(),
        class_applied: document.getElementById("admClass").value.trim(),
        message: document.getElementById("admMessage").value.trim()
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { show(res.d.message || "Could not send. Please try again.", false); }
        else {
          show(res.d.message || "Thank you! The school will contact you soon.", true);
          form.reset();
        }
      })
      .catch(function () { show("Network error - please check your internet and try again.", false); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "\u{1F4E8} Send Enquiry";
      });
  });
})();

/* ==========================================================================
   NEW (pack 22 - owner: "I can't see messages/notifications... in the
   website"): public notice board - general announcements + upcoming events
   served by /api/announcements-public (nothing internal ever leaves that
   route; if it's unreachable the section quietly shows a friendly line).
========================================================================== */
(function () {
  const box = document.getElementById("wbNotices");
  if (!box) return;
  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  fetch("/api/announcements-public")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const anns = (d && d.announcements) || [];
      const evs = (d && d.events) || [];
      if (!anns.length && !evs.length) {
        box.innerHTML = '<div class="wb-empty">No announcements right now - please check back soon.</div>';
        return;
      }
      let html = "";
      evs.forEach((e) => {
        const dstr = String(e.event_date || "").slice(0, 10);
        html += '<div class="wb-note wb-event">' +
          '<div class="wb-note-top"><b>' + esc(e.title) + '</b><span class="wb-chip wb-chip-ev">🗓 ' + esc(dstr) + "</span></div>" +
          (e.description ? '<p>' + esc(e.description) + "</p>" : "") +
          "</div>";
      });
      anns.forEach((n) => {
        html += '<div class="wb-note">' +
          '<div class="wb-note-top"><b>' + esc(n.title) + '</b><span class="wb-chip">📢 ' + esc(String(n.created_at || "").slice(0, 10)) + "</span></div>" +
          (n.body ? '<p>' + esc(n.body) + "</p>" : "") +
          "</div>";
      });
      box.innerHTML = html;
    })
    .catch(() => {
      box.innerHTML = '<div class="wb-empty">Announcements will appear here when the school posts them.</div>';
    });
})();
