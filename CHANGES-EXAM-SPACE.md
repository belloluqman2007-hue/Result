# Exam Space — per-teacher drafts, publishing, and the Enter fix

> Owner, verbatim:
> "What is the best way to organize created exam from each user. It should be well
> organized and user must be able to draft exam, not everything will be showing to
> other users. And in the exam if I try to create third exam and wrote first line and
> need to go to second line it will not respond. Fix and merge"

Two completely separate problems are fixed here: **who may see which exam**
(the exam space), and **the second line not responding** in the editor.

---

## 1. The exam space — one library per teacher, drafts are private

### The model

| | Who can see it | Who can open it | Who can change / delete / publish |
|---|---|---|---|
| **My drafts** | only the author (and the office) | author + admin | author + admin |
| **My published exams** | the whole staff | everyone | author + admin |
| **Staff exam bank** | the whole staff (other teachers' published papers) | everyone, read-only | author + admin |

* Every new exam is saved as a **draft owned by the teacher who saved it**.
* A draft is **invisible** to everybody else — it is not listed, and opening it
  directly answers `404` (the same as a paper that does not exist), so a
  half-written paper can never leak.
* **Publishing** is a deliberate act (`Publish` button) — only then does the paper
  join the staff bank. `Unpublish` takes it back to private drafts.
* Ownership can never be taken over: saving over, deleting, or publishing somebody
  else's paper is refused with `403` (admins may manage everything).
* A published paper from another teacher opens as a **read-only view** with
  `Duplicate to my drafts`, so nobody edits over another teacher's paper by
  accident.

### Screens

| File | What changed |
|---|---|
| `server.js` — `exams` table | Two new columns, added idempotently for existing databases: `status` (`draft` / `published`, default `draft`) and `updated_at`. New `runExamSpaceMigrations()` — guarded and retried exactly like the other packs. **On the one boot that creates the column, every existing exam is marked `published`**, so nothing the school already uses disappears from the library. |
| `server.js` — `GET /exams` | Now returns the caller's exam space: own papers + published papers of others (+ everything for an admin). Each row carries `status`, `created_by`, `mine`, `can_edit` and a `group` (`drafts` / `mine` / `shared`) and is sorted drafts-first, newest first. Falls back to the old plain list on a database where the migration has not run yet. |
| `server.js` — `GET /exam/:id` | Refuses to serve somebody else's draft (`404`). Returns `status`, `mine`, `can_edit` with the paper. |
| `server.js` — `POST /save-exam` | Creates **drafts** (owned by the signed-in teacher); an update keeps the original owner, needs ownership, and never changes the publish state. Messages say plainly "Draft saved — it is private to you until you publish it." |
| `server.js` — `DELETE /exam/:id` | Author or admin only. |
| `server.js` — `POST /exam/:id/status` (NEW) | Publish / unpublish one paper (author or admin). Publishing also copies the printable paper into the shared File Store; unpublishing removes that copy. |
| `server.js` — File Store | The vault (`/Saved Exams`) now mirrors **published** papers only — a draft is never written there, and the automatic vault sync selects `status = 'published'`. |
| `server.js` — `/portal/exams` | Pupils/parents only ever receive **published** papers. |
| `create-exam.html` | "Saved Exams" becomes **My Exam Space**: a searchable list in three groups (My drafts / My published exams / Staff exam bank) with Open · Duplicate · Publish/Unpublish · Delete, a `+ New Exam (draft)` button, and a `Duplicate to my drafts` option in the open-chooser. |
| `js/exam.js` | `openLoadPanel()` renders the grouped exam space (search, counts, per-paper actions only where they are allowed); new `publishExam()`, `duplicateExam()` (own editable copy, original untouched) and `newExamDraft()`; delete now reports honestly instead of silently failing. |
| `css/exam.css` | Styling for the panel and cards (draft papers are amber-marked, published green), a header reset so the shared site `<header>` banner cannot bleed in, and the panel lifted above the floating "Exam Tools" button so every action stays tappable on a phone. |
| `test/exam-space-test.js` (NEW) | Boots the real server against a fake MySQL layer with an admin and **two different teachers** and proves all of the above: draft created and private, invisible + unopenable + unsavable + undeletable for the other teacher, publish makes it readable-but-not-editable, unpublish hides it again, admin can see and manage it. Wired into `npm test`. |

---

## 2. "I write the first line, press Enter, and the second line does not respond"

### Root cause (reproduced in a real browser)

The editor is one big `contenteditable` document. When Enter was pressed inside a
page's text zone, Chrome implemented the paragraph break by **splitting the very
element the caret was in** — and when that element *was* the page's
`.page-content`, the browser cloned the class with it, leaving the page with
**two** text zones plus a stray `<br>`:

```
<div class="page-content">line 1</div>
<div class="page-content"><br></div>      ← where the caret now was
```

The layout engine's structure repair (`ensureExamStructure`) treats any second
`.page-content` on a page as a broken legacy save: it merged the zones and
**removed the empty one — with the caret still inside it**. The next keystroke
therefore went nowhere ("it will not respond"), sometimes the two lines ended up
glued together, and repeating the break left the blank lines behind. That is why
it showed up while writing a third exam with several sections on one paper.

### The fix (`js/exam.js`)

* **Enter is handled by the editor, not the browser.** `examInsertNewLine()` splits
  the current line at the caret and creates a brand-new `<div>` line immediately
  below it, inside the same text zone, with the caret already in it — one clear
  line per question, exactly like Word. It never carries the browser's empty
  `<br>` placeholder into the new line, so no blank lines accumulate.
* `Ctrl/⌘/Alt/Shift+Enter` are left to the browser (page break stays on its own
  button/key).
* **The structure repair keeps the caret.** Before it runs, `examCaretAnchor()`
  records the block the caret is in; `restoreExamCaret()` puts it back afterwards.
  If the block genuinely had to go, a fresh, focused line is created at the end of
  that page's text instead of dropping the caret.
* `rescueCaretBlock()` runs on every input/keyup: a caret that lands in a stray
  zone or loose in a page's markup is moved back into that page's own text zone,
  at the end, still focused.
* Re-layout no longer fires while the caret is on an empty new line
  (`caretIsOnEmptyLine()`), so nothing can throw the line away mid-typing.
* The "second .page-content" repair no longer deletes a new-line block: it moves
  its contents into the real zone (keeping line order) instead.

### Verified in a real (headless) browser

Typed 18 questions with an Enter after each on a paper with three exams, let the
automatic re-layout run, then typed again — every line stayed separate and the
next line still accepted text. Fast typing with no pauses, mid-line splits,
Arabic and mixed-direction text, page break insertion and `Save Exam` were all
re-checked on a phone viewport and a desktop viewport.

---

## Database

Nothing to run by hand: `runExamSpaceMigrations()` adds the two `exams` columns on
the next boot (idempotent, retried, and safe on a database that already has them).
Legacy papers are marked `published` on that first run so the existing exam bank
stays exactly as it was; everything written afterwards starts as a private draft.
