# Fix Pack — Calendar must fit ONE A4 page (print + download)

> Date: 2026-08-28
> Owner report: *"The print calendar is going beyond A4 page. The download also is
> too long than a4 page and the signature is not at side by side. In both the logo
> need to be a little wide than that. And the letterhead need some design."*

---

## What was actually wrong

| Symptom | Root cause (verified in the code) |
|---|---|
| Print spills past one A4 page | Nothing ever measured the sheet against the page. `@page{size:A4 portrait; margin:8mm}` leaves 194 × 281 mm, but `.cal-sheet` grew to whatever the rows needed and the printer just started page 2. |
| Signatures not side by side in the download (and in print) | `css/calendar-beauty.css` had a **bare** `@media (max-width:640px)` block. A media query without a media type matches *every* medium, so on a phone it also applied **while printing** and to the **off-screen copy that the PDF is captured from**: `.cal-sigs{flex-direction:column}` stacked the two signatures and `.cal-lesson-row{flex-direction:column}` wrapped every lesson line, stretching the sheet. |
| Download "too long" | Same cause: the stretched sheet is captured far taller than A4, so the fit-to-page maths shrank it into a narrow strip instead of filling the page. |
| Small logo | `.cal-logo` was 66 × 66 px in the studio and 56 × 56 px on the portal. |
| Plain letterhead | The masthead was bare text on white with no frame, rule or panel. |

---

## What changed

| File | Change |
|---|---|
| `css/calendar-beauty.css` | Phone block re-scoped to `@media screen and (max-width:640px)` so it can never touch print or the PDF capture. New letterhead design: gold corner accents, an inner hairline gold frame, a designed masthead panel (gold wash + border + rounded corners), an emerald/gold double rule with a gold diamond under the masthead. Crest widened to **92 × 78 px** with a double gold ring. Print padding matched to the measuring geometry (`8mm 10mm 0`) and `html,body{min-height:0}` added so no phantom second page. |
| `css/school.css` | Base (portal) crest widened to **80 × 68 px**; base letterhead corners + masthead rule; `.cal-sheet` is now the containing block for them (`position:relative; overflow:hidden`). New shared **A4 fit layer**: `.cal-printfit` (the exact box the printer uses, used for measuring on screen), `.cal-dense` / `.cal-xdense` (progressive typography tightening), and the `.cal-pdf` / `.cal-printfit` **layout lock** that pins the desktop letterhead — signatures side by side, lesson times on one line — with `!important`, so no device width can restyle the printed/downloaded copy. |
| `js/calendar-render.js` | Renderer emits the corner accents and the masthead rule. **New `amsFitCalendarSheet(sheet, opts)`**: measures the sheet, steps it through `.cal-dense` → `.cal-xdense`, and if it is *still* too tall scales it with CSS `zoom` (the same mechanism the report-card one-page fix uses) or, on engines without `zoom`, a transform plus an exactly-reserved wrapper height. **`amsCalendarPDF` rewritten**: the capture copy gets the `.cal-pdf` lock and a fixed **190 × 272.6 mm** box — exactly the aspect ratio of the A4 printable area at a 14 pt margin — the content is fitted inside it, and the image is then placed on **one** page, centred, never cropped, never spilling. |
| `js/calendar-editor.js` | `calPreview()` now calls the new `calFitPreview()`; the fit is re-run on `beforeprint`, `afterprint` and (debounced) `resize`, and bound once in `initCalendarPage()`. |

Nothing else was touched: same API, same routes, same saved-document shape, same
compact on-screen card for parents and teachers.

---

## Why it now cannot produce a second page

1. **Print** — before the dialog opens, the sheet is measured at the printer's own
   geometry (`.cal-printfit`, 190 mm wide, `8mm 10mm` padding, desktop layout) and
   shrunk until it is ≤ 279 mm tall (A4 297 mm − 2 × 8 mm `@page` margin, minus
   2 mm of slack). Typography is tightened first, so the calendar only gets
   physically smaller when the content genuinely demands it.
2. **Download** — the sheet is captured inside a fixed A4-proportioned box with
   `overflow:hidden`, so the raster can never be taller than A4, and jsPDF then
   scales it into the 14 pt printable margin and centres it. One page, always,
   and it fills the page instead of leaving a strip at the bottom.

---

## Verification

Run from a scratch directory with `npm i jsdom jspdf postcss`:

```
node /home/user/verify/verify.js      # 74 passed, 0 failed
```

The harness loads the **real** `js/calendar-render.js` and `js/calendar-editor.js`
into a jsdom window built from the **real** `manage-calendars.html`, parses the
**real** stylesheets with postcss, and builds **real** PDF bytes with the real
`jspdf` package. It covers:

* the renderer output (4 corner accents, masthead rule + diamond, 12 week rows +
  the note row, 4 lesson rows, exactly 2 signature boxes);
* `amsFitCalendarSheet` — a short sheet is left alone, a tall one steps down to
  `.cal-dense`, a huge one falls through to `.cal-xdense` **and** is scaled to
  `279 mm ÷ natural height` with the wrapper reserving the scaled height (both the
  `zoom` and the `transform` branch are exercised);
* `amsCalendarPDF` end to end — the emitted PDF contains **exactly one** `/Type /Page`
  object, the drawn image rect fills the 567.28 pt printable width, is centred both
  ways and stays on the paper, even for a deliberately pathological 1436 × 2600 px
  capture; the capture copy carries `.cal-pdf`, is pinned to the 272.6 mm box and
  keeps its two side-by-side signature boxes;
* stylesheet invariants — no unscoped `max-width` block may restyle `.cal-*` any
  more, the phone block is still there for the on-screen preview only, the print
  padding equals the measuring padding, `@page` is A4 portrait, both crests are
  wider than before and the PDF/print copy is pinned to the wide size;
* the editor path — `calNew()` → `calPreview()` → `calFitPreview()` on the real
  studio DOM shrinks a deliberately over-tall preview back inside one A4 page.

**Not verified here:** a real browser print. This sandbox has no browser binary and
the Chrome download host is unreachable, so `html2canvas` is stubbed in the harness
(it supplies the canvas size) and the visual result of an actual `window.print()`
has not been eyeballed.
