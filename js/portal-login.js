/* ==========================================================================
   NEW FILE (pack 13) - js/portal-login.js
   Student/Parent login: Student ID + surname -> /portal-login.
   Mirrors the structure of js/login.js (staff login). Additive.
   ========================================================================== */
(function () {
  "use strict";

  // Already logged in? Go straight to the portal.
  fetch("/portal/me")
    .then(function (r) { return r.json(); })
    .then(function (p) {
      if (p && p.loggedIn) window.location.replace("portal.html");
    })
    .catch(function () { /* offline - stay on the page */ });

  document.getElementById("portalLoginForm").addEventListener("submit", function (e) {
    e.preventDefault();

    var studentId = document.getElementById("portalStudentId").value.trim();
    var password = document.getElementById("portalSurname").value;
    var errorBox = document.getElementById("portalLoginError");
    var btn = document.getElementById("portalLoginBtn");

    errorBox.style.display = "none";

    if (!studentId || !password) {
      errorBox.textContent = "Please enter the Student ID and surname.";
      errorBox.style.display = "block";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Logging in...";

    fetch("/portal-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: studentId, password: password })
    })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.message || "Login failed");
          return data;
        });
      })
      .then(function () {
        window.location.href = "portal.html";
      })
      .catch(function (error) {
        errorBox.textContent = error.message || "Invalid Student ID or surname.";
        errorBox.style.display = "block";
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Login";
      });
  });
})();
