/* ==========================================================================
   js/login.js — Staff login
   --------------------------------------------------------------------------
   NEW (owner: "I can't be logging in every time I want to access the app"):
     1. If this device is already signed in, the page skips the form and goes
        straight to the dashboard. Combined with the server's long-lived
        device token (auth-remember.js) that means one sign-in per device,
        not one sign-in per visit.
     2. "Keep me signed in on this device" is ticked by default, so the next
        app launch opens the dashboard directly.
     3. The last username is remembered (never the password) so even a fresh
        sign-in is one field and one tap.
     4. A safe ?next=... destination is honoured after signing in.
   ========================================================================== */
(function () {
  "use strict";

  var LAST_USER_KEY = "ams_last_staff_username";
  var REMEMBER_KEY = "ams_stay_signed_in";

  var form = document.getElementById("loginForm");
  var usernameInput = document.getElementById("username");
  var passwordInput = document.getElementById("password");
  var rememberInput = document.getElementById("rememberDevice");
  var errorBox = document.getElementById("loginError");
  var submitBtn = form ? form.querySelector("button[type=submit]") : null;

  function safeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }
  function safeRead(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  /* Only ever follow a local path - never an absolute/off-site URL. */
  function nextDestination() {
    var raw = "";
    try { raw = new URLSearchParams(window.location.search).get("next") || ""; } catch (e) { raw = ""; }
    if (!raw) return "teacher-dashboard.html";
    if (raw.charAt(0) !== "/" || raw.charAt(1) === "/") return "teacher-dashboard.html";
    return raw.replace(/^\//, "");
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.style.display = "block";
  }

  /* ---------- remember-me preference + last username ---------- */
  if (rememberInput) {
    var savedPref = safeRead(REMEMBER_KEY);
    rememberInput.checked = savedPref !== "0"; // default: ON
  }
  var lastUser = safeRead(LAST_USER_KEY);
  if (lastUser && usernameInput && !usernameInput.value) {
    usernameInput.value = lastUser;
    if (passwordInput) passwordInput.focus();
  }

  /* ---------- already signed in? go straight in ---------- */
  fetch("/me", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) {
      if (me && me.loggedIn) window.location.replace(nextDestination());
    })
    .catch(function () { /* offline - keep the form usable */ });

  /* ---------- submit ---------- */
  if (!form) return;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (errorBox) errorBox.style.display = "none";

    var username = usernameInput ? usernameInput.value.trim() : "";
    var password = passwordInput ? passwordInput.value : "";
    var remember = rememberInput ? rememberInput.checked : true;

    if (username === "" || password === "") {
      showError("Please enter both username and password.");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Signing in…";
    }

    fetch("/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password, remember: remember })
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.message || "Login failed");
          return data;
        });
      })
      .then(function () {
        safeStore(LAST_USER_KEY, username);
        safeStore(REMEMBER_KEY, remember ? "1" : "0");
        window.location.href = nextDestination();
      })
      .catch(function (error) {
        showError(error.message || "Invalid username or password.");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Login";
        }
      });
  });
})();
