# Feature Pack — Madrasah Calendar Beauty Redesign

> Date: 2026-08-28  
> Scope: additive-only; no existing route, API or calculation modified.

---

## What changed

| File | Change |
|---|---|
| `css/calendar-beauty.css` | **NEW** — dedicated beauty layer for the calendar studio and the letterhead sheet. Emerald + gold palette, Islamic star-lattice hero, ornamental ribbons on every card, refined inputs with focus rings, glass chips, modern action buttons, an elegant A4 letterhead (parchment background, gold crest ring, ornamental dividers, gradient name band, striped weeks table, gold-dotted signature lines). Loaded **after** `school.css` so its rules win on the studio; portals/dashboards that load only `school.css` keep the original look. |
| `manage-calendars.html` | **Restructured** — new emerald-and-gold **hero** (crest, badge, "Now editing" stat) replaces the old plain `<h1>`; both cards now use a sectioned layout (icon + title + count chip, ornamental top ribbon); the editor toolbar is split into clearly labelled **Letterhead & Refs / Activities & Weeks / Lesson Times / Signatures** sections with diamond-bordered section dividers; the action bar is a clean row of five gradient buttons; the preview has its own themed "stage" with a checkered backdrop. |
| `js/calendar-editor.js` | **Wired to the new classes** — `calNotify` now writes into the new `.mcb-msg` element with the correct icon, the "Now editing" chip in the hero stays in sync, the saved-list table uses the new `.mcb-table` / `.mcb-chip` / `.mcb-icbtn` styles, the empty / error states use the new `.mcb-empty` panel, and the add-row buttons get the new dashed `mcb-addrow` style. Editor is otherwise unchanged (same API, same fields). |

---

## Design highlights

* **Hero** — star-lattice backdrop, gold glow bar, deep-emerald gradient, gold-rimmed school crest, the live "Now editing" stat on the right.
* **Saved Calendars** — dark-emerald gradient header with gold underline, polished status chips with a coloured dot, pill-shaped icon buttons (Edit / Publish / Delete).
* **Editor** — sectioned cards (Letterhead & Refs → Activities & Weeks → Lesson Times → Signatures), a 5-button action bar (Update Preview · Save · Print · Download PDF · New / Reset), and a friendly inline status pill.
* **Live preview stage** — checkered green backdrop with a centred parchment-coloured sheet; the sheet has a gold rim, a crest with double gold ring, gradient name band with gold flank lines, a striped weeks table with a dark-emerald header, a lesson-times block on a soft-gold wash, signature boxes with gold-dotted underlines, and an emerald-to-jade bottom band topped by a gold glow line.
* **Print** — still one A4 page, only the sheet prints (print media query hides the hero, cards and stage).

---

## Why this is safe

* No API, DB schema, route, calculation or print format has changed.
* The old `.cal-*` rules in `css/school.css` are overridden on the **studio** only, because `manage-calendars.html` now loads `css/calendar-beauty.css` **after** `css/school.css`. The portal cards, the staff dashboard, the backup panel, and every other page still see the original `school.css` rules.
* The new CSS uses its own `.mcb-*` and (in the new letterhead) updated `.cal-*` namespaced rules. Where the new file re-uses a `.cal-*` selector (e.g. `.cal-sheet`, `.cal-table`, `.cal-sigs`), it intentionally overrides the older rule on the studio only — same intent, much more refined look.
* `js/calendar-editor.js` only changes DOM hooks and a couple of class names; the data flow (`calReadDoc`, `calSave`, `loadCalendars`, `calPreview`, `calDownloadPDF`, `calAddRow`, `calAddLesson`, `calNew`, `calFillEditor`, `calSyncEditingChip`) is identical to before.

