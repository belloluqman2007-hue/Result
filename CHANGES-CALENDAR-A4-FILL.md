# Fill-A4 Pack — the calendar fills the WHOLE A4 page

> Owner report: *"And the calendar print need to fill the whole a4 page.
> No empty spaces and not shrinking and logo must well display and also
> the header and contents inside it."*
> Date: 2026-09-09

---

## What was actually wrong

| Symptom | Root cause (verified in the code) |
|---|---|
| Empty space at the bottom of the printed page / PDF | The sheet was sized by its content (~a strip of paper), never by the page. The fit helper could only shrink, never grow - so a normal calendar printed as a short sheet with a large blank band underneath. |
| The download left a margin strip | `amsCalendarPDF` captured a 190 × 272.6 mm box and then placed it inside a 14 pt margin - a framed picture floating on the page, not a full page. |
| The logo was cropped, not displayed | The crest image is **776 × 802**, but both stylesheets forced it into a wide box (92 × 78 studio, 80 × 68 portal) with `object-fit:cover; border-radius:50%` - chopping the Arabic ring text and the motto banner off the seal. |
| (Existing bug found on the way) | `js/teacher-calendar.js` still references a card that no longer exists in `teacher-dashboard.html`, so it correctly no-ops. Nothing to fix - the live paths are the studio (manage-calendars.html) and the parent portal (portal.html). |

## The fix: the sheet IS the page

The sheet is now a **flex column pinned to the exact paper it lands on**,
and the weeks table absorbs the leftover height so the calendar grid fills
the page top to bottom. Nothing is ever scaled down for a normal calendar -
stretching replaces shrinking.

| Surface | Box the sheet occupies |
|---|---|
| **Print** (studio) | `@page A4, 8mm margin` → the sheet is **194 × 280 mm** (1 mm slack against printer rounding), fixed at print time by `css/calendar-beauty.css`. |
| **Download PDF** | The capture box is the **FULL A4 page, 210 × 297 mm**; jsPDF places the raster over the whole page (fit + centre maths kept generic so it can never crop or spill). |
| **Preview** | The studio preview uses the same `min-height:280 mm` flex sheet - what you see is exactly what prints and downloads. |

Typography tightening (`.cal-dense` / `.cal-xdense`) and scaling remain ONLY
as a safety valve for calendars whose content is genuinely taller than one
page; measuring targets got +0.6–1 mm of slack so pixel rounding can never
trigger a needless shrink.

| File | Change |
|---|---|
| `js/calendar-render.js` | The weeks table now sits in a `.cal-tablewrap` flex box (this is what stretches). `amsCalendarPDF` captures the full 210 × 297 mm page and drops it on the page with no margin strip; the fit call is typography-only with rounding slack. |
| `js/calendar-editor.js` | `calFitPreview()` measures at the printer's real box (194 × 280 mm, target 281 mm). |
| `css/calendar-beauty.css` | Studio sheet = flex column, 194 mm wide, `min-height:280 mm`; crest **96 × 99 with `object-fit:contain`** (whole seal, gold double ring); masthead text moved clear of the wider crest (`padding-left:122px`); print block pins the sheet to **194 × 280 mm**; the gold hairline of the bottom band moved inside the sheet edge so it prints; `.mcb-hero-crest` also `contain`. |
| `css/school.css` | Portal/PDF-copy mirror of the same geometry: base sheet is a flex column; `.cal-tablewrap` rules; base crest **78 × 81 contain**; the `.cal-pdf` lock is now the full **210 × 297 mm** page and `.cal-printfit` the **194 × 280 mm** printer box - both with flex + stretching table, wide crest and cleared masthead. |
| `index.html`, `css/website.css` | (Separate Arabic pack - see `CHANGES-WEBSITE-ARABIC.md`; the header/hero/footer crests also gained `object-fit:contain`.) |

## Why the logo is now correct

The seal is 776 × 802 (ratio ≈ 0.968). Every box now matches that shape and
uses `object-fit:contain`, so the FULL crest - Arabic ring text, shield and
motto banner - is visible, framed in the gold ring. The masthead text block
was moved right (122 px) so nothing overlaps the wider crest.

## Verification

From a scratch directory (`npm i puppeteer` was installed but its Chrome
download host is blocked in this sandbox - no browser available, same as the
previous pack), two harnesses were run against the **real** files:

1. **`node harness.js` - 33 passed, 0 failed.** Loads the real
   `js/calendar-render.js` into a DOM stub: renderer structure (4 corner
   accents, header + Arabic name, `.cal-tablewrap` + 12 week rows + note row,
   exactly 2 signature boxes, bottom band); `amsFitCalendarSheet` (short
   sheet untouched - never shrunk; tall sheet steps to `.cal-dense` only;
   huge sheet falls through to `.cal-xdense` and scales as a last resort;
   PDF mode is typography-only; a sheet at the box's rounded pixel height is
   left alone); stylesheet invariants (flex sheet, 194 × 280 print pin,
   210 × 297 PDF pin, `cal-tablewrap` stretch rules, crest `contain` boxes).
2. **Real-PDF end-to-end** - the real `js/vendor/jspdf.umd.min.js` +
   the real `amsCalendarPDF` (only `html2canvas` stubbed with a 1587 × 2246
   canvas, exactly what a 210 × 297 mm capture at scale 2 produces): the
   emitted PDF has **exactly one `/Type /Page`**, `MediaBox [0 0 595.28 841.89]`,
   and the image is placed at `594.87 × 841.89 pt` centred - i.e. the whole
   page (the 0.4 pt width difference is canvas pixel rounding, < 0.15 mm).

**Not verified here:** an actual `window.print()` in a real browser - this
sandbox has no browser binary and both the Chrome and Playwright download
hosts are unreachable.
