# Fix Pack — الجدول الدراسي timetable: stamp Principal + Head Teacher signatures

> Date: 2026-09-11
> Owner report: *"In the الجدول الدراسي session don't touch it too much so data
> will not be lost. Let the principal signature and headteacher signature appear
> in the timetable without breaking anything or losing any inputted data.
> Fix and merge"*

---

## What changed

| File | Change |
|---|---|
| `js/arabic-timetable.js` | The printed sheet footer now has **three** slots: **Principal** (`مدير المدرسة`), **Head Teacher** (`رئيس المعلمين`) and the existing **school seal** (`ختم المدرسة`). The Principal + Head Teacher slots stamp the school's **saved signature images** (the same ones uploaded in *Settings → School Signatures*), exactly like report cards and the term calendar do. New `sigHtml()` helper renders each slot (signature image above the signing line); new `fetchSignatures()` reads the existing public `/signatures` endpoint (role → image path) and re-renders the sheets. If a signature isn't saved yet, the slot keeps its blank signing line — nothing changes visually for a timetable that has no signatures. |
| `css/arabic-timetable.css` | New `.sig-area` / `.sig-img` rules reserve a fixed space above the signing line and size the stamped image (46 px portrait, 32 px landscape). The line's top margin is folded into that reserved area so the footer keeps the same total height. |

## Why data cannot be lost

- **No data shape changed.** `sharedData()` / `save()` / `loadShared()` and the saved
  timetable (`ams-arabic-timetables-v2`) are untouched — classes, periods, subjects,
  break time and orientation are saved and loaded exactly as before. Signatures are
  a **runtime-only** `state.signatures` map fetched from `/signatures`; they are never
  written into the saved timetable data.
- **Fails safe.** `/signatures` returns `401` when logged out, and the fetch is caught —
  the sheet then prints with blank signing lines, which is the pre-change behaviour.
- **Print / PDF unaffected.** Because the image is part of the same `sheetHtml()`
  output, it appears on screen, in the print dialog and in the PDF download, and the
  existing one-page-A4 fit routine still measures and fits the sheet as before.

## Verification

```
node /tmp/ttverify/verify.js   # 15 passed, 0 failed
```

The harness loads the **real** `arabic-timetable.html` + `js/arabic-timetable.js` + CSS
into jsdom and confirms: the footer has Principal + Head Teacher + seal slots; a saved
timetable's subjects still render (data preserved); saved Principal/Head Teacher
signature images are stamped (and the Class Teacher image is *not*); and with no
signatures saved the blank signing lines remain.
