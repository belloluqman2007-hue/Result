# Report Attendance — attendance on the report sheet, strictly one page

> Owner request: *"I want attendance to appear on the report sheet and must
> not cause it to fall in second page. It must strictly one page."*

## What the report sheet shows now

One new compact row inside the existing **Student Information** table
(English + Arabic labels, like every other field):

| Attendance الحضور | 94% (58 of 62 days) | Absent / Late الغياب / التأخير | 3 / 1 |

- "58 of 62 days" = days the child attended (present + late) out of the days
  the register was taken for their class that term ("times school opened").
- If the register has no marks for that child that term, the cells show `-`
  (honest "no record") instead of a misleading 0%.
- Same figures, same wording, on all three report surfaces: the staff
  **Check Result** page, the **parent/student portal** sheet, and every PDF
  in the **whole-class ZIP**.

## Which days count for a term (please read this one)

The attendance register stores only dates — no term/session — and nothing
else in the system stores term date ranges. So the term window is derived
from the session years using the standard Nigerian academic calendar
(the school's own published calendar resumes 3rd Term on 02/05, i.e. the
May boundary): for session `2025/2026` —
1st Term = 1 Sep 2025–31 Dec 2025, 2nd Term = 1 Jan 2026–30 Apr 2026,
3rd Term = 1 May 2026–31 Aug 2026. The windows are contiguous, so every
marked day belongs to exactly one term. **If the madrasah's terms ever run
on different months, say so** — it is a one-place change
(`amsReportTermWindow` in `server.js`).

Attendance on a 3rd-Term report is the **3rd Term's** attendance (termly,
like the 1st/2nd-Term sheets), even though the scores above it are
cumulative for the session.

## How "strictly one page" is guaranteed (3 layers)

1. **The row pays for itself.** In the print skin (`css/style.css`) the
   signature strip previously inherited the screen rule's 30px bottom
   margin — print never overrode it, so the printed sheet was ~22px
   taller than the copy the fit-zoom measures. That, plus half-pixel
   padding trims (header, student-info cells), reclaims ~33px — more
   than the new row adds. A sheet that printed at 100% before still does.
2. **The fit-zoom got stricter.** `amsFitPrintZoom(Sync)` now targets
   1005px of the 1046px printable height (~41px / 11mm headroom, up from
   ~16px), absorbing any skin/font rounding difference. Sheets that fit
   are still untouched (zoom 1); only already-overflowing sheets shrink
   a shade more. The measurement skin (`.rcpzip`) keeps slightly larger
   paddings than print everywhere, so the measured sheet can only ever
   be taller than the printed one.
3. **A hard cap.** `@media print #reportContainer` now also has
   `max-height:276mm; overflow:hidden` — one A4 page is physically
   guaranteed even if JavaScript measuring were unavailable. The PDF
   downloads (portal + class ZIP) were already structurally one-page
   (`forceSinglePage` in `amsCanvasToA4Pdf`) and stay so.

## New endpoint

`GET /report-attendance/:studentId?term=&session=&className=` — behind
`publishResultGate`, the exact gate `/search-result` uses (staff pass;
portal parents: own child + published term only). Every failure answers
200 `{available:false}` so the sheet prints `-`: a missing or
pre-pack-13 attendance table can never break a report. Reads stay on the `attendance`
table alone (pack 109 collation doctrine), with the folded-class-name
fallback for double-spaced class spellings.

## Tests

- `test/report-attendance-test.js` (37 checks): real server + fake MySQL —
  term windows and boundaries (Dec 31 / Apr 30 / Aug 31 edges, previous and
  next sessions), present/late/absent counting, "school opened" per class,
  double-spaced class names, legacy table without `class_name`, missing
  table, anonymous refusal (403).
- `test/report-attendance-client-test.js` (18 checks): the built sheet
  prints the row on both renderers, a failed attendance fetch cannot sink
  a report, a 9000px-tall canvas still becomes a **one-page** PDF, and the
  print fit-zoom uses the new stricter target.
- Full suite (`npm test`, 8 files incl. packs 108/109 attendance) passes.
