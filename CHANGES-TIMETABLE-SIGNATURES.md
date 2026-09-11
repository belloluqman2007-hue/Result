# Fix Pack — الجدول الدراسي timetable: the Principal & Head Teacher signatures now appear

> Date: 2026-09-11
> Owner report: *"In the الجدول الدراسي section the principal and headteacher
> signature is not appearing. Fix it without losing any data. Fix and merge"*

---

## What was actually wrong

The signatures were never missing from the *database* — they were never **asked for**.

`js/arabic-timetable.js` built the bottom of the printed sheet from two hard-coded
strings:

```js
'<div class="sig"><div class="line"></div><b>مدير المدرسة</b>التوقيع</div>' +
'<div class="sig"><div class="line"></div><b>ختم المدرسة</b>الرسمي</div>' +
```

So:

| Symptom | Root cause (verified in the code) |
|---|---|
| The Principal's signature never appears | The sheet drew an **empty line** for مدير المدرسة. The page contained **zero** references to signatures — `grep -c "signatures" js/arabic-timetable.js` returned **0**. It never called `/signatures`, so no saved image could ever reach the page. |
| The Head Teacher's signature never appears | There was **no Head Teacher slot at all** on the sheet — only "Principal" and "school seal". |

Every other document in the system (report cards, the term calendar) already stamps
these images from the shared `/signatures` endpoint; the timetable was simply never
wired up to it.

This was confirmed by running the **current `git HEAD` code** in a harness with both
signatures present on the server: `0` images rendered, and no Head Teacher slot.

---

## What changed

| File | Change |
|---|---|
| `js/arabic-timetable.js` | New `fetchSignatures()` reads the existing **`/signatures`** endpoint (role → image path) — the very same one report cards and the term calendar use — and re-renders the sheets. New `sigHtml()` builds each signing slot, stamping the saved image above the signing line when one exists. The footer now has **three** slots: **مدير المدرسة (Principal)**, **رئيس المعلمين (Head Teacher)** and the existing **ختم المدرسة (school seal)**. New `sigSrc()` adds a per-page-load cache-buster so a freshly re-uploaded signature shows up immediately instead of being served stale from the browser / service-worker cache. |
| `css/arabic-timetable.css` | New `.sig-area` (reserved space above the line) and `.sig-img` (the stamped image, height-capped and nudged onto the line). The blank space that the line's own `margin-top` used to provide was **moved into `.sig-area` at exactly the same size** — `28px` portrait, `14px` landscape — so an unsigned sheet keeps precisely the footer height it always had. Landscape caps the image smaller (30px) to protect the one-page A4 landscape fit. |
| `sw.js` | Cache version `v67 → v68`, so phones drop the old timetable code and any stale cached signature image. |
| `CHANGES-TIMETABLE-SIGNATURES.md` | This document. |

Nothing else was touched: same API, same routes, same buttons, same print/PDF pipeline.

---

## Why no data can be lost

This was the explicit requirement, so it is enforced structurally rather than by care:

1. **The saved document's shape is unchanged.** `sharedData()` still returns exactly
   `{ classes, config, orientation }`. The signatures live in `state.signatures`, which
   is **runtime-only** and is never referenced by `save()`, `sharedData()` or the
   `PUT /api/arabic-timetable` body. Tests assert the saved payload's keys are still
   exactly `classes, config, orientation` and that the string `"signature"` never appears
   anywhere in the stored document or in the browser's local copy.
2. **Nothing is rewritten on load.** `load()`, `loadShared()` and `migrateConfig()` are
   untouched. Tests compare the saved classes and config **byte-for-byte** against what
   was loaded.
3. **Read-only server call.** `fetchSignatures()` is a `GET`. It cannot modify anything.
4. **Fails safe.** `/signatures` answers `401` when logged out; that, a network failure,
   and "no signature uploaded yet" all land in the same place — the slot keeps its blank
   signing line, i.e. **exactly the pre-fix rendering**. No broken-image icon is ever drawn.
5. **Output is escaped.** The image path goes through the existing `esc()` helper, so a
   malformed path cannot break out of the attribute.

---

## Verification

Two harnesses were run against the **real** `arabic-timetable.html`, `js/arabic-timetable.js`
and `css/arabic-timetable.css` loaded into jsdom, plus a live HTTP check.

```
node verify.js        # 60 passed, 0 failed
node before-after.js  # 10 passed, 0 failed  (HEAD vs. fix)
node live-check.js    #  9 passed, 0 failed  (served over real HTTP)
```

Covered:

* **The bug, measured** — the same probe run against `git HEAD` reproduces it (0 images,
  no Head Teacher slot) and passes on the fix (2 images, 3 slots).
* **The fix** — both saved images are stamped, each inside its own correctly-labelled slot
  (not swapped); unrelated roles (Class Teacher, Vice Principal) are *not* stamped; URLs are
  cache-busted; the stamped URLs resolve to real PNG bytes over HTTP.
* **No data lost** — all 18 saved subjects, all 6 morning times, both evening times, the
  الاستراحة row and its time, the class banner, the letterhead and the full class list all
  still render; the saved payload keys and contents are byte-identical; live editing still
  saves; signatures survive the re-render that editing triggers.
* **Fails safe** — `401`, offline, empty list, and "only one of the two saved" all keep the
  blank signing lines; a hostile signature path cannot inject an attribute.
* **Print / landscape / PDF** — Print All still renders one sheet per class and **every**
  sheet carries both signatures; landscape still toggles and persists; the html2canvas
  capture that becomes the downloaded PDF contains both `sig-img` images, so the
  **downloaded PDF is signed too**, and still produces exactly one A4 page.
* **Geometry** — the stylesheet is parsed with postcss to prove the reserved space is the
  same 28px (portrait) / 14px (landscape) as before, that the line's top margin is now `0`
  so the space is not doubled, that the image is height- and width-capped, and that no new
  `@media` block can leak into print.

The repo's own suite (`node test/attendance-page-client-test.js`) still passes **24/24**.
`test/attendance-500-test.js` fails identically before and after this change (it needs
`node_modules`, which is not installed here) — it is unrelated to this fix.
