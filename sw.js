/* ====================================================================
   NEW FILE (PWA conversion): Service Worker
   --------------------------------------------------------------------
   What this does:
     1. Makes the website installable as a phone / desktop app.
     2. Speeds up loading by caching ONLY static files (css, js,
        images, icons) using "stale-while-revalidate".
     3. Shows a friendly offline page when there is no internet
        (instead of the browser's dinosaur error page).

   SAFETY (result-system protection):
     - HTML pages and ALL server data (results, scores, students,
       dashboards, login, etc.) ALWAYS come from the live network.
       They are NEVER served from cache, so results can never be stale.
     - This worker touches nothing in the database and changes no
       route, query, or calculation. It is 100% additive.
   ==================================================================== */

// FIX (pack 106): refresh the shared full sidebars and quick navigation on every role section.
const CACHE_NAME = "ameenullah-shell-v67" // CHANGED (pack 108): the Mark Register never 500s any more - every attendance query now reads the real schema first (missing attendance table / missing class_name, att_date, status or marked_by column / mixed collations all handled), the register route no longer needs attendance.class_name at all, saved marks merge in JS, and if the marks half still fails the class list is drawn with everyone Present; the page now shows the database's own sentence instead of "status 500" and recovers from the class list on any failure; csrf.js names the failing URL in the console and retries idempotent GETs on 500/502/503/504 too. Bump so phones drop the old register code // const PRECACHE = ["offline.html", "images/LOGO.JPG", "icons/icon-192.png"];

// Only these file types are ever cached (static assets only).
const STATIC_EXT = /\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|webmanifest)$/i;
// FIX (pack 24 - owner: "the exam only shows the cover"): JS and CSS are
// CODE - serving a stale cached copy first (old behaviour) meant phones
// could run weeks-old exam/result logic after an update. Code now goes
// NETWORK-FIRST (fresh the very next load; cache is only the offline
// fallback). Images/fonts keep the fast stale-while-revalidate path.
const CODE_EXT = /\.(css|js)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Remove old cache versions from previous deployments.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only GET requests within our own site are handled.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Static files: CODE network-first (pack 24), images/fonts cache-first.
  if (CODE_EXT.test(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Page navigations: always try the live server first. Show the
  // offline page ONLY if the network itself is unreachable.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("offline.html")));
    return;
  }

  // Everything else (API calls, login, results...): straight to network.
});

/* ------------------------- helpers ------------------------- */

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  // Cache each file independently so one missing file can't
  // prevent the whole service worker from installing.
  await Promise.all(
    PRECACHE.map((file) =>
      cache.add(file).catch((err) => console.warn("PWA: could not precache", file, err))
    )
  );
}

// pack 24: fresh copy wins immediately; the cache silently backs up offline.
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const freshFetch = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached); // offline? fall back to the cached copy
  return cached || freshFetch;
}

/* ==========================================================================
   NEW (pack 32): WEB PUSH handlers. The server sends one JSON payload per
   alert; we ring with the school logo and open the right page on tap.
   Cached app-shell behaviour above is completely untouched by these.
   ========================================================================== */
self.addEventListener("push", function (event) {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { /* empty payload */ }
    const opts = {
        body: d.body || "",
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        tag: d.tag || ("ams-" + Date.now()),
        renotify: true,
        vibrate: [90, 40, 90],
        data: { url: d.url || "/" }
    };
    event.waitUntil(self.registration.showNotification(d.title || "Ameenullah School", opts));
});

self.addEventListener("notificationclick", function (event) {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || "/";
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (wins) {
            for (const w of wins) {
                if (w.url.indexOf(target.replace(/^\//, "")) !== -1 && "focus" in w) {
                    if (w.navigate) w.navigate(target);
                    return w.focus();
                }
            }
            return clients.openWindow(target);
        })
    );
});
