/* ==========================================================================
   NEW FILE (pack 13) - js/portal-login.js
   Student/Parent login: Student ID + surname -> /portal-login.
   Mirrors the structure of js/login.js (staff login). Additive.
   ========================================================================== */
(function () {
  "use strict";

  var LAST_ID_KEY = "ams_last_portal_id";
  var REMEMBER_KEY = "ams_stay_signed_in";

  function safeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }
  function safeRead(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  // Already logged in? Go straight to the portal.
  // NEW (stay-signed-in): the server also restores a remembered phone before
  // this runs, so a parent never retypes the ID and surname on a device they
  // already trust.
  fetch("/portal/me", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (p) {
      if (p && p.loggedIn) window.location.replace("portal.html");
    })
    .catch(function () { /* offline - stay on the page */ });

  // Remember the last Student ID (never the surname) + the checkbox choice.
  var rememberBox = document.getElementById("portalRememberDevice");
  if (rememberBox) rememberBox.checked = safeRead(REMEMBER_KEY) !== "0";
  var idField = document.getElementById("portalStudentId");
  var lastId = safeRead(LAST_ID_KEY);
  if (idField && lastId && !idField.value) {
    idField.value = lastId;
    var surnameField = document.getElementById("portalSurname");
    if (surnameField) surnameField.focus();
  }

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

    var remember = rememberBox ? rememberBox.checked : true;

    fetch("/portal-login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: studentId, password: password, remember: remember })
    })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.message || "Login failed");
          return data;
        });
      })
      .then(function () {
        safeStore(LAST_ID_KEY, studentId);
        safeStore(REMEMBER_KEY, remember ? "1" : "0");
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
