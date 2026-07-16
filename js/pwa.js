/* ====================================================================
   NEW FILE (PWA conversion): app installer
   --------------------------------------------------------------------
   Does two things, both 100% additive:
     1. Registers the service worker (sw.js) so the site becomes an
        installable app and static files load faster.
     2. When the browser says the site CAN be installed, shows a small
        floating "Install App" button so non-technical users can find
        it easily. Clicking it opens the browser's own install dialog.

   It does NOT modify any existing feature, style, script or route.
   On browsers without PWA support it silently does nothing.
   ==================================================================== */
(function () {
  "use strict";

  // ---------- 1. Register the service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("sw.js", { scope: "./" })
        .catch(function (err) {
          console.warn("PWA: service worker registration failed:", err);
        });
    });
  }

  // ---------- 2. Floating "Install App" button ----------
  var deferredPrompt = null;
  var btn = null;

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); // stop the mini-infobar; we show our own button
    deferredPrompt = e;
    if (sessionStorage.getItem("amsInstallDismissed") !== "1") {
      showInstallButton();
    }
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    removeButton();
  });

  function showInstallButton() {
    if (btn) return;
    btn = document.createElement("button");
    btn.id = "amsInstallBtn";
    btn.innerHTML = "\u{1F4F2} Install App";
    btn.setAttribute("aria-label", "Install this website as an app");
    // Inline styles so it looks right on every page without touching CSS files.
    btn.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:99999;" +
      "background:linear-gradient(135deg,#2f5021,#4a752f);color:#fff;" +
      "border:none;border-radius:999px;padding:12px 20px;" +
      "font:600 14px 'Segoe UI',system-ui,Arial,sans-serif;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer;" +
      "display:flex;align-items:center;gap:6px;";

    var close = document.createElement("span");
    close.textContent = "\u00D7";
    close.title = "Hide";
    close.style.cssText = "margin-left:6px;font-size:16px;opacity:.7;line-height:1;";
    close.addEventListener("click", function (e) {
      e.stopPropagation();
      sessionStorage.setItem("amsInstallDismissed", "1");
      removeButton();
    });
    btn.appendChild(close);

    btn.addEventListener("click", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt(); // opens the browser's install dialog
      deferredPrompt.userChoice.finally(function () {
        deferredPrompt = null;
        removeButton();
      });
    });

    document.body.appendChild(btn);
  }

  function removeButton() {
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    btn = null;
  }
})();
