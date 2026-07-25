/* ==========================================================================
   NEW FILE (pack 32 - owner picked "push notifications"): js/ams-push.js
   Tiny shared helper for turning PHONE ALERTS on/off. Used by the Parent
   Portal (kind 'portal') and the staff dashboard (kind 'staff').

     amsPush.status()           -> 'on' | 'off' | 'denied' | 'unsupported'
     amsPush.subscribe(kind)    -> turns alerts ON  (throws with .amsWhy)
     amsPush.unsubscribe(kind)  -> turns alerts OFF

   It uses the service worker the app already registers (js/pwa.js) and the
   server's /api/push/* endpoints. No keys, no setup for the user.
   ========================================================================== */
window.amsPush = (function () {
  "use strict";

  function supported() {
    return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);
  }
  function reg() {
    if (!supported()) return Promise.resolve(null);
    try {
      return navigator.serviceWorker.ready.catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function b64toU8(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var b = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function urlFor(kind, what) {
    return "/" + (kind === "portal" ? "portal/" : "api/") + what;
  }

  function fail(why) {
    var e = new Error(why);
    e.amsWhy = why;
    throw e;
  }

  function status() {
    if (!supported()) return Promise.resolve("unsupported");
    return reg().then(function (r) {
      if (!r) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      return r.pushManager.getSubscription().then(function (sub) {
        return sub ? "on" : "off";
      });
    });
  }

  function subscribe(kind) {
    if (!supported()) fail("unsupported");
    return reg().then(function (r) {
      if (!r) fail("unsupported");
      return Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") fail("denied");
        return fetch("/api/push/public-key").then(function (kr) {
          if (!kr.ok) fail("server");
          return kr.json().then(function (kd) {
            return r.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: b64toU8(kd.key)
            }).then(function (sub) {
              return fetch(urlFor(kind, "push-subscribe"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subscription: sub.toJSON() })
              }).then(function (sr) {
                if (!sr.ok) fail("server");
                return "on";
              });
            });
          });
        });
      });
    });
  }

  function unsubscribe(kind) {
    if (!supported()) return Promise.resolve("off");
    return reg().then(function (r) {
      if (!r) return "off";
      return r.pushManager.getSubscription().then(function (sub) {
        if (!sub) return "off";
        return fetch(urlFor(kind, "push-unsubscribe"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint })
        }).catch(function () {}).then(function () {
          return sub.unsubscribe().catch(function () {}).then(function () { return "off"; });
        });
      });
    });
  }

  return { status: status, subscribe: subscribe, unsubscribe: unsubscribe };
})();
