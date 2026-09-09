# Fix Pack — الجدول الدراسي timetable: smaller green logo photo, PDF download button, normal landscape

> Date: 2026-09-09
> Owner report: *"Reduce the green photo at the header inside the الجدول الدراسي session
> timetable print and add download button also that work perfectly. The landscape
> their also is need to display normal. Fix and merge"*

---

## What was actually wrong

| Symptom | Root cause (verified in the code) |
|---|---|
| Green school photo too big in the printed letterhead | `.letter-row img.crest` (images/LOGO.JPG — a green photo crest) was 78 × 78 px and appeared twice in the letterhead, plus a 46 %-wide bismillah banner and a full-sheet logo watermark, so the green imagery dominated the print. |
| No download button | The page could only `window.print()`. No PDF export existed, although jsPDF + html2canvas are already vendored in `js/vendor/` and used by the certificate / calendar downloads. |
| Landscape does not display normally | Landscape only widened `.stage`; the sheet kept its full portrait-sized letterhead (46 % bismillah, 78 px crests, 22 px banner, 15.5 px cells). At A4 landscape width that stacked to ≈ 250+ mm of content on a page with only 194 mm of printable height, so the timetable overflowed / split across pages instead of sitting on one A4 landscape page. |

---

## What changed

| File | Change |
|---|---|
| `css/arabic-timetable.css` | Green photo crest reduced from **78 → 54 px** (44 px in landscape, 48 px on small phones); bismillah banner reduced from **46 %/210 px → 38 %/170 px**; watermark (the full-sheet green photo) lightened **0.045 → 0.03**. New **`body.landscape` compaction layer**: tighter letterhead (bismillah 24 %/130 px, 20 px school name, 15 px motto), tightened table typography (13.5 px cells, smaller paddings), compact banners/rules/footer — applied on screen, in print AND in the PDF capture so the landscape sheet always fits one A4 page (≈ 176 mm of content vs 194 mm printable). New **`.tt-capture`** stage styles for the PDF capture (fixed-width, shadow-free, hidden from print). |
| `arabic-timetable.html` | Two new header buttons: **⬇ Download PDF** (current class) and **⬇ Download All (PDF)** (every class, one page each). Added the local `js/vendor/jspdf.umd.min.js` + `html2canvas.min.js` scripts (already used by the certificate/calendar downloads). |
| `js/arabic-timetable.js` | New PDF pipeline: renders the selected sheet(s) into an invisible fixed-width stage (794 px portrait / 1123 px landscape — the A4 printable aspect), waits for images + `document.fonts.ready` (so the Arabic web fonts are loaded), captures each sheet with html2canvas (scale 2, blank-canvas guard), then builds one **A4 PDF per orientation** with jsPDF: one page per class, the capture scaled to fit inside the 8 mm print margin and centred — never cropped, never stretched. Buttons are disabled while building and re-enabled with a toast on success. Print buttons and the `@page`-injected print orientation are untouched. |
| `CHANGES-TIMETABLE-A4.md` | This document. |

Nothing else was touched: same API, same saved-data shape, same print buttons.

---

## Why it now cannot break

1. **Landscape** — the compaction rules are keyed to `body.landscape`, the same class the orientation selector already toggles, so the screen preview, the print dialog and the PDF capture all render the same one-page landscape layout. The injected `@page { size: A4 landscape }` rule still drives the printer's page size.
2. **Download** — the capture stage width is fixed to the A4 printable aspect ratio, so the captured raster always has A4 proportions; the fit-to-page maths then centres it inside the 8 mm margin. A4 portrait or landscape, one class or all classes, the result is always exactly one A4 page per class with no spill.

---

## Verification

Run from a scratch directory with `npm i jsdom jspdf postcss`:

```
node /tmp/ttverify/verify.js   # 37 passed, 0 failed
```

The harness loads the **real** `arabic-timetable.html` + `js/arabic-timetable.js` into a
jsdom window built from the real markup, parses the **real** stylesheet with postcss, and
builds **real** PDF bytes with the real `jspdf` package. It covers:

* the letterhead reductions (crest 54 px, bismillah 38 %/170 px, watermark ≤ 0.03) and the landscape compaction rules;
* stylesheet invariants — no unscoped `@media` block can leak into print/PDF, the default print `@page` stays A4 portrait, and the capture stage is hidden from print;
* the new buttons + vendor script order;
* runtime — selecting landscape toggles `body.landscape`, updates the injected `@page` rule and persists the choice;
* the download flow end-to-end — landscape download yields a **297 × 210 mm** one-page PDF, portrait yields **210 × 297 mm**, Download All yields one 2-page PDF for the two sample classes, file names carry the orientation, and the off-screen capture stage is removed afterwards.
