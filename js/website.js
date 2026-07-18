/* ==========================================================================
   NEW FILE (pack 13) - js/website.js
   Public school website behaviour: admission enquiry form + footer year.
   Talks ONLY to the new /admission-enquiry endpoint. Additive.
   ========================================================================== */
(function () {
  "use strict";

  var yearEl = document.getElementById("scYear");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

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
