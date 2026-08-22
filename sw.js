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

const CACHE_NAME = "ameenullah-shell-v57" // NEW (pack 96): 3rd-term result sheet - student name band at the top (English left / Arabic اسم الطلاب right) + PDF sheet inset with an even white margin on all four sides; // NEW (pack 95): 3rd-term result sheets add a crest watermark, gold star border and PROMOTED/REPEAT admission decision; // NEW (pack 94): 3rd-term Grand Total = T1+T2+T3 (13 subjects → 3900), average = Grand Total ÷ (subjects×3), position ranked by that average; // NEW (pack 93): third-term results report only the /100 columns (T1/T2/T3/AVERAGE) - CA 40 and EXAM 60 removed from the table, PDF and Excel; students-in-class + "3rd of 24" positions; typed Term Ends On / New Session Starts printed on every sheet; few-subject sheets fill the A4 page; // NEW (pack 92): third-term PDF — aligned bigger header, normal signature lines, full A4 page; // NEW (pack 91): Third Term Results feature - new third-term-results.html page + js/third-term-results.js + third-term-parser.js; // NEW (pack 90): report print has no artificial space-between gaps; slightly larger header + score table fills the remaining A4 height; class ZIP and portal PDF now use the real full-page result with 10mm print margins instead of a short compact form; // NEW (pack 89): student-result print now distributes the ACTUAL sections across the full A4 page (print-only flex column) instead of just stretching the outer border; Class Results print no longer blanked by the shared report print guard (dedicated #crPrintShell print ID, higher-specificity restore rule); NEW (arena): ONE-page print/PDF for staff Check Result + student portal report download (no more "longer than one page / very big"), class ZIP + "Print All Classes" added to admin, student portal sidebar now scrolls; // NEW (pack 88): third-term cumulative report - 1st+2nd+3rd term scores combined into one average, total score = all three terms, pass 50%+, ONE-page print/PDF layout; position fixed on the report sheet and the portal Class Position sidebar (promotion/tashkeel-safe, cumulative 3rd-term ranking) // FIX (pack 85): health/library/remarks collation fix (students visible again in Student Health & Teacher Comments), student portal Library + Teacher Comments sidebar pages, extended medical record fields (genotype, height/weight/BMI, doctor, NHIS, medications, check-up, special needs) // FIX (pack 83): Sakkal fallback + exam big-font spill + receipt class fallback + ID card front+back bulk + portrait back visibility; // NEW (pack 82): Railway domain migration; File Store saves ONE printable styled exam .html; finance tabs split (official record vs snapped evidence); official receipt redesign + /fee-payments student/class join // FIX (pack 44): bulk ID-card class list no longer freezes on "Loading classes..." (guarded fetch + tap-to-retry) // CHANGED (pack 43): One-tap Backup panel fully redesigned (gold vault medallion, fact chips, weekly tip) // FIX (pack 41): dashboard logo/crest restored to its styled size + made smaller (pack-40 zip had dropped the beauty CSS; crest now 52px/42px) // NEW (pack 40): tappable dashboard stats (all students, subjects per class, results breakdown, classes, staff, exams) + Tahfeedh tracker page + bulk class ID-card PDFs + absence WhatsApp alerts to parents + public Honour Roll on the website // NEW (pack 39): certificates now match the uploaded paper ones - per-level colour AND design (green Primary, blue Junior Secondary + rings, maroon Quranic + woven edges, black/gold chevron Preliminary), space-filling body, PORTRAIT + LANDSCAPE versions; ID card gets portrait/landscape versions too; NEW One-tap Backup (admin downloads the whole DB as JSON from the dashboard); dashboard beautified like the public website hero; FIX: adding students with a blank Date of Birth no longer says "Error saving student" (strict-mode date fix) // FIX (pack 38): admission letter prints ONE clean page (enquiry board no longer leaks on top - school.css calendar-print rule outranked by a page-local fix), letter now shows Admission No/gender/DoB (list endpoint returns pipeline columns), smaller student photo in result zips, stray dash before names removed // FIX (pack 37): zip PDFs on PHONES now match Check Result exactly (header + signatures forced to the desktop row layout - the mobile viewport media query was stacking them past one page) // NEW (pack 37): Admission Pipeline - one-tap Admit creates the student instantly, printable Provisional Admission Letter, status chips + declined, delete spam // FIX (pack 36): owner-driven rebuild - zip PDFs now print-safe (202mm frame + centered, like Check Result print); certificates rebuilt to mirror the school's real paper design (level themes, passport photo box, ruled bilingual body); AI assistant now knows the Tahdiri stage // NEW (pack 35) // NEW (pack 35): Certificate Generator (4 elegant types, batch class PDFs) + Tahdiri stage on the public website + school name in capital letters // FIX (pack 34b) // FIX (pack 34b): rcpzip one-page compact skin for class-zip captures (real cards with photo + Arabic rows now truly fit one A4 page; fit threshold 1.55) // FIX (pack 34): class-zip results fit ONE A4 page each (gentle scale-to-fit for tall cards; huge 17+ subject cards still split cleanly at row edges) // NEW (pack 33): Debtors board in Finance (everyone owing across all fee types, biggest first, one-tap reminders via chat + phone push) // NEW (pack 32): web push - phones ring for results/fees/announcements/chat even when app is closed // CHANGED (pack 31c): fresh Google verification token (file googlea6892f129dcb5282.html + updated meta) // NEW (pack 31b): Google Search Console ownership verification (meta tag + verification file) // NEW (pack 31): Google SEO (meta/canonical/OG/JSON-LD + robots.txt + sitemap.xml) + AI no longer cuts answers short (bigger budgets + auto-continue on finish_reason=length) + quota-aware model fallback for heavy use // FIX (pack 30): AI model retirement fallback chain (gemini 2.0-flash shutdown), tiny svg copy icon, class-zip PDF row-snapped pages + blank retry, fee totals no longer overlap on phones, chat blank gap gone, finance title bidi fix // NEW (pack 29): AI Remarks -> fluent staff AI Chat + in-app AI key switch-on (powers every AI feature); AI remark route removed // NEW (pack 28): chat new-chat picker + voice notes + admin/teacher threads + student info panel + smaller ticks + guided finance fee setup + organized portal fees + exam page-4 image/blank guards + PDF progress counter // NEW (pack 27): WhatsApp-style chat (staff + portal) + Quran SVG icon + exam page-4 download memory fix + AI features (exam question generator, remarks writer, website assistant) // NEW (pack 26): portal result PDF/print fix + exam typing-stress fix + dashboard sections moved to sidebar pages (scores/notices) + wipe moved to School Settings + full website redesign // NEW (pack 25): exam PDF/page-writing fix + confidentiality + staff Notifications/Settings/Timetables pages + DB pool & MySQL sessions + portal timetables // FIX (pack 24): JS/CSS network-first (kills stale "exam shows only cover" code) + portal sidebar redesign + staff Chat page // NEW (pack 23): result font/one-page fix + messaging + notifications + settings + exam-PDF hardening + receipt viewer // NEW (pack 22): clearer Arabic result font + portal notices/exam timetable + website board + announcement audiences/edit // FIX (pack 21): search-as-you-type card + statement fix + clean numbers/font // FIX (pack 20): DB-backed uploads + optional class in bulk // FIX (pack 19): multi-body merge for saved multi-exam booklets // FIX (pack 18): refresh for dashboard calendar removal + exam print/font/step-chooser fixes // FIX (pack 17): refresh for exam engine/calendar/receipts // FIX (pack 16): refresh for the staff calendar viewer // FIX (pack 15): refresh for portal/calendar/finance v2 // FIX (pack 13): force refresh of old cached assets // NEW (pack 25): exam PDF/page-writing fix + confidentiality + staff Notifications/Settings/Timetables pages + DB pool & MySQL sessions + portal timetables // FIX (pack 24): JS/CSS network-first (kills stale "exam shows only cover" code) + portal sidebar redesign + staff Chat page // NEW (pack 23): result font/one-page fix + messaging + notifications + settings + exam-PDF hardening + receipt viewer // NEW (pack 22): clearer Arabic result font + portal notices/exam timetable + website board + announcement audiences/edit // FIX (pack 21): search-as-you-type card + statement fix + clean numbers/font // FIX (pack 20): DB-backed uploads + optional class in bulk // FIX (pack 19): multi-body merge for saved multi-exam booklets // FIX (pack 18): refresh for dashboard calendar removal + exam print/font/step-chooser fixes // FIX (pack 17): refresh for exam engine/calendar/receipts // FIX (pack 16): refresh for the staff calendar viewer // FIX (pack 15): refresh for portal/calendar/finance v2 // FIX (pack 13): force refresh of old cached assets

// Files made available immediately (used by the offline page).
const PRECACHE = ["offline.html", "images/LOGO.JPG", "icons/icon-192.png"];

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
