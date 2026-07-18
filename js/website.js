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
