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

const CACHE_NAME = "ameenullah-shell-v7"; // FIX (pack 19): multi-body merge for saved multi-exam booklets // FIX (pack 18): refresh for dashboard calendar removal + exam print/font/step-chooser fixes // FIX (pack 17): refresh for exam engine/calendar/receipts // FIX (pack 16): refresh for the staff calendar viewer // FIX (pack 15): refresh for portal/calendar/finance v2 // FIX (pack 13): force refresh of old cached assets

// Files made available immediately (used by the offline page).
const PRECACHE = ["offline.html", "images/LOGO.JPG", "icons/icon-192.png"];

// Only these file types are ever cached (static assets only).
const STATIC_EXT = /\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|webmanifest)$/i;

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

  // Static files (css, js, images...): serve cache fast, then refresh it.
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
