# Check Result repair — "Error fetching result" while the old sheet stays up

> Owner report (after the report-attendance pack): *"If I try to check
> student results now it is saying error fetching result. But old result
> are displaying."*

`Error fetching result.` is the alert in `searchResult()`'s `.catch`
(`js/result.js`). It fires for **any** throw inside the result handler — the
fetch itself can have succeeded perfectly — and because the handler dies
mid-draw, the previously displayed sheet stays on screen ("old result are
displaying"). Two distinct throws produced exactly this report; both are
now fixed, plus a service-worker bug that let stale pages survive.

## Root cause 1 — NULL `class_name` rows crash the report (the "new results" half)

Rows written by paths that do not know the class — e.g. the spreadsheet
import falling back to `stu.class_name` for a pupil whose students record
has none — are stored with `class_name = NULL`. Both report renderers then
call `class_name.includes(...)` to pick the report-level label:

- `js/result.js` threw before drawing a single score row → the generic
  alert over the previous sheet. Old results (saved with a class) display;
  newer imported ones "error".
- `js/report-card.js` (`amsBuildReportCard`) threw the same way → the
  portal said "Network error", the class ZIP silently skipped the pupil.

Fixes (defence in depth):
- Both clients coerce once: `String(row.class_name || "")`.
- `GET /search-result` heals `NULL → ""` at read (display only, stored
  rows untouched), so even a phone running a cached older script reads a
  string and displays the result.
- `amsUpsertScoreResult` (single-entry + import choke point) refuses to
  **write** NULL from now on, coercing to the column's own default `""`.
  Batch and gradebook already required a non-empty class.

## Root cause 2 — attendance cells vs a stale cached page (the regression half)

The attendance pack added `#studentAttendance` / `#studentAbsentLate` to
`student-result.html` and wrote them with bare
`getElementById(...).textContent`. Code (js/css) is network-first in the
service worker, but HTML pages are not version-pinned — a phone holding
the pre-pack page in its HTTP cache gets fresh `result.js` with an old
sheet: the write throws inside the handler ("no result" search) or as an
unhandled rejection (found search). Attendance cells are now written via
`amsSetCellText()`, which no-ops when the cell is absent — attendance can
never break a search again, whichever copy of the page is on screen.

## Root cause 0 — service-worker updates have been silently failing

`sw.js`'s `PRECACHE` definition had been swallowed into the one-line
`CACHE_NAME` comment (everything after `//` on that line), so `precache()`
referenced an undefined name, the install event rejected, and **no
service-worker update has installed since pack 112** — phones kept an
older worker and its cache alive, which is exactly how stale pages pair
with fresh scripts. `PRECACHE` is restored as its own line and the cache
bumps `v70 → v71`, so updates install and old caches drop on activate.

## Tests

- `test/check-result-search-test.js` (12 checks) — runs the **real**
  `searchResult()` against element sets parsed from the real page
  (current markup + the stale pre-pack variant): found / not-found /
  NULL-class / empty-class searches, asserting no "Error fetching result."
  alert, scores drawn, attendance filled. Before the fix: NULL-class and
  both stale-page cases failed exactly as the owner described.
- `test/search-result-null-class-test.js` (10 checks) — boots the real
  server: `/search-result` heals NULL → `""` (gate, scores and names
  untouched) and `/save-result` with `class_name:null` writes `""`.
- `test/report-attendance-client-test.js` gains the NULL-class builder
  case (portal/ZIP keep building instead of throwing).
- Full suite (`npm test`, 10 files) green.
