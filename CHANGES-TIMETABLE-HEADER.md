# Fix Pack — الجدول الدراسي timetable: one A4 landscape page, new letterhead, الاستراحة with time

> Date: 2026-09-09
> Owner report: *"Fix all these inside الجدول الدراسي session — the landscape print is
> going beyond 1 a4 page. Inside the timetable let the logo just be only one on the left
> side and make the header like this:*
> *مدرسة أمين الله للعلوم العربية الإسلامية*
> *AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES*
> *الشعار: العلم والعبادة MOTTO: KNOWLEDGE AND WORSHIP*
> *and remove the green photo header at the very top. And change the فسحة to الاستراحة
> and put time there also. Fix and merge"*

---

## What was actually wrong

| Symptom | Root cause (verified in the code) |
|---|---|
| Landscape print spills onto a second A4 page | The landscape sheet was only *compacted by hand* (fixed px sizes). Nothing ever measured the real height, so as soon as the letterhead or a subject name grew, the sheet passed the 194 mm of printable height on an A4 landscape page and the browser split it over two pages. |
| Two school crests in the letterhead | `letterheadHtml()` emitted `images/LOGO.JPG` twice — once before and once after the school names — with `justify-content: space-between`. |
| Wrong header text | The letterhead only had the Arabic name + the old motto `شعبة العلم والعبادة`. There was no English school name and no `الشعار / MOTTO` line. |
| Green photo banner across the top | The very first element of every sheet was `<img class="bismillah-img" src="images/bismillah.png">` — a teal/green calligraphy photo (255 × 94 px) up to 210 px wide — plus a full-sheet green logo watermark behind it. |
| `فسحة` row with no time | `DEFAULT_CONFIG.breakLabel = "فسحة"` and the break row rendered the label only, inside a `colspan` cell with no time at all. |

---

## What changed

| File | Change |
|---|---|
| `js/arabic-timetable.js` | **Letterhead rewritten**: one crest only, emitted as the *first* child of `.letter-row`, followed by the names block — Arabic school name, **English school name** (`schoolEn`), the **الشعار / MOTTO** line (`motto` + `mottoEn`, bidi-isolated), then the term pill. The green basmala photo banner is gone. **`breakLabel` is now `الاستراحة`** and a new **`breakTime` (`10:00 – 10:30`)** is rendered next to it. New **fit-to-one-A4-page** routine (`ttPageBox` / `ttPxPerMm` / `ttFitSheets` / `ttClearFit`): before printing, every sheet is laid out at the true printable width (A4 − 8 mm margins) and measured; if it is taller than the printable height it is zoomed down just enough to fit (never enlarged, never below 60 %), so landscape always lands on **one** page. Printing now also waits for the Arabic web fonts (with a 1.2 s failsafe) before measuring, and the zoom is cleared on `afterprint`. New **`migrateConfig()`** upgrades timetables saved by older builds in place: old `شعبة العلم والعبادة` → `الشعار: العلم والعبادة`, old `فسحة` → `الاستراحة`, and the new English name / motto / break-time fields are back-filled — class data is never touched. |
| `css/arabic-timetable.css` | `.letter-row` is now **LTR** (`direction: ltr; justify-content: flex-start`) so the single crest sits on the **left**, with `.letter-names` kept RTL and centred next to it. New `.school-en`, `.motto-ar`, `.motto-en`, `.break-label`, `.break-time` styles (all bidi-isolated so the Arabic/English mix never reorders). All `.bismillah-*` rules removed. Landscape compaction tightened again (sheet padding, letterhead, cell padding/fonts, block heads, footer) and now also covers the English line and the capture stage (`body.landscape .tt-capture .tt td`), so screen, print and PDF all use the same metrics. |
| `arabic-timetable.html` | New admin field **Break time (الاستراحة row)** so the school can change `10:00 – 10:30` without touching code. |
| `CHANGES-TIMETABLE-HEADER.md` | This document. |

Nothing else was touched: same API, same saved-data shape, same download buttons.

---

## Why it now cannot break

1. **One A4 page, measured not guessed.** The old code trusted hand-tuned pixel sizes. Now the sheet is measured at the real printable page box (281 × 194 mm landscape, 194 × 281 mm portrait) right before `window.print()`; anything taller is scaled to fit with `zoom`, which is a *layout-level* zoom, so the printer sees the smaller box too. Browsers without `zoom` fall back to the compacted layout, which on its own is ~630 px of content against ~733 px of printable height (~14 % headroom). Because the landscape rules are keyed to `body.landscape` and are more specific than the generic `@media print` overrides, the screen preview, the print dialog and the PDF capture all measure the same thing.
2. **Header** — the crest is rendered once and is the first element of an LTR flex row, so it is pinned to the left in both orientations; the three header lines are separate, bidi-isolated elements, so "الشعار: العلم والعبادة" always stays on the Arabic (right) side and "MOTTO: KNOWLEDGE AND WORSHIP" on the English side.
3. **Saved timetables** — the migration runs on load, so a timetable saved with the old motto and `فسحة` prints with the new header and the new `الاستراحة 10:00 – 10:30` row instead of keeping stale values.

---

## Verification

Run from a scratch directory with `npm i jsdom`:

```
node /tmp/ttverify/verify.js   # 41 passed, 0 failed
```

The harness loads the **real** `arabic-timetable.html` + `js/arabic-timetable.js` into jsdom
and parses the **real** stylesheet. It covers:

* exactly **one** crest per sheet, first in the letter row, and no basmala photo/text left in the markup, JS or CSS;
* the new header — Arabic name, English name, `الشعار: العلم والعبادة`, `MOTTO: KNOWLEDGE AND WORSHIP`, in that order;
* the break row — one row, label `الاستراحة`, time `10:00 – 10:30`, spanning every column;
* migration — a saved v2 config with `شعبة العلم والعبادة` + `فسحة` renders the new motto, new label, back-filled English lines and break time, while the saved class/subject data survives;
* the admin break-time field is pre-filled and edits update the sheet live;
* orientation — selecting landscape toggles `body.landscape`, updates the injected `@page` rule and persists the choice; the fit helpers and the font-ready wait are wired in, and the fit is cleared after printing;
* stylesheet invariants — letter row is LTR, names block RTL + centred, Arabic/English spans bidi-isolated, landscape metrics outrank the generic print overrides, default print `@page` stays A4 portrait, capture stage hidden from print.
