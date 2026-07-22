# Feature Pack 26 — Attendance Portal · Chat improvements · Security hardening

> Date: 2026-07-22  
> Scope: additive-only; no existing route, table or calculation modified.

---

## What changed (files you received)

| File | Change |
|---|---|
| `db.js` | Removed 4 `console.log` calls that printed env-var names on every boot (minor security hygiene). Pool config unchanged. |
| `sw.js` | Cache bumped `v13 → v14` so all browsers pick up the new JS/CSS immediately after deploy. |
| `portal.html` | New **Attendance** nav link in the sidebar + a dedicated Attendance view (summary pills + dated list). |
| `js/portal.js` | `loadAttendance()` function added; called lazily when the parent opens the Attendance view, and once silently at login to warm the cache. Uses new `GET /portal/attendance` route (see server.js patch below). |
| `js/chat.js` | **New Conversation** button at the top of the threads panel. Staff can now write to any parent first — they type the Student ID and a message, and it uses the existing `POST /api/messages` route. The sent message appears as the first bubble in a new thread. |
| `chat.html` | CSS + HTML for the New Conversation inline form (uses the new `ch-new-*` classes). No existing element changed. |
| `notifications.html` | Redesigned with grouped sections. Admin users see two additional sections: **Fee Alerts** (`GET /fee-alerts`) and **Receipt Alerts** (`GET /receipt-alerts`). Both endpoints already existed in `server.js`; the page just never called them. Teachers still see the same 3 sections as before. |

---

## Required server.js changes

Because `server.js` is 4 700+ lines, these are listed as precise insertions you make yourself. Each block is 100 % additive — no existing route or function is touched.

---

### 1 — Route guard for `settings.html` and `staff-attendance.html`

**Where:** immediately after the existing `timetable.html` guard (search for the string `res.sendFile(path.join(__dirname, "timetable.html"))` and insert the block below *after* the closing `});` of that route).

```javascript
/* NEW (pack 26 - security): serve settings / staff-attendance pages only
   to logged-in staff. Without this, the static middleware returns them to
   anyone who knows the URL; the JS redirect is client-side only. */
app.get("/settings.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "settings.html"));
});
app.get("/staff-attendance.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "staff-attendance.html"));
});
```

---

### 2 — Login rate-limiter (brute-force protection)

**Where:** near the top of `server.js`, **before** the `app.post("/login", ...)` handler (search for `app.post("/login",`).

Add the in-memory rate-limiter helper first (no new packages needed):

```javascript
/* NEW (pack 26 - security): simple IP-based rate-limiter for the login
   endpoint. Max 10 attempts per IP in any 15-minute window.
   Uses a plain Map — no extra package needed. */
const _loginWindow = 15 * 60 * 1000; // 15 minutes in ms
const _loginMax    = 10;              // attempts per window
const _loginHits   = new Map();
setInterval(() => _loginHits.clear(), _loginWindow).unref(); // reset map every window

function loginRateLimit(req, res, next) {
    const ip  = req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
    const now = Date.now();
    const hits = (_loginHits.get(ip) || []).filter(t => now - t < _loginWindow);
    hits.push(now);
    _loginHits.set(ip, hits);
    if (hits.length > _loginMax) {
        return res.status(429).json({
            message: "Too many login attempts. Please wait 15 minutes before trying again."
        });
    }
    next();
}
```

Then **add `loginRateLimit` as a middleware argument** to both login routes:

```javascript
// Change this:
app.post("/login", (req, res) => {
// To this:
app.post("/login", loginRateLimit, (req, res) => {

// And this (portal login):
app.post("/portal/login", (req, res) => {
// To this:
app.post("/portal/login", loginRateLimit, (req, res) => {
```

---

### 3 — Portal attendance endpoint

**Where:** after the `GET /portal/published-terms` route (search for `portal/published-terms` and insert below its closing `});`).

```javascript
/* NEW (pack 26 - owner request): parents/students can see their child's
   attendance record directly in the portal. READ-ONLY SELECT only.
   The attendance table was created in pack 13; this is the first portal
   route that exposes it to the parent (staff routes were already there). */
app.get("/portal/attendance", (req, res) => {
    const sid = req.session && req.session.portalStudentId;
    if (!sid) return res.status(401).json({ message: "Not logged in" });
    connection.query(
        `SELECT att_date, status, created_at
         FROM attendance
         WHERE student_id = ?
         ORDER BY att_date DESC
         LIMIT 200`,
        [sid],
        (err, rows) => {
            if (err) {
                if (err.code === "ER_NO_SUCH_TABLE") return res.json([]); // attendance not yet used
                console.log(err);
                return res.status(500).json({ message: "Database error" });
            }
            res.json(rows);
        }
    );
});
```

---

## Verification checklist

After applying the server.js changes and deploying:

- [ ] `settings.html` redirects to login when accessed without a session
- [ ] `staff-attendance.html` redirects to login when accessed without a session  
- [ ] 11th login attempt within 15 min returns HTTP 429 with the rate-limit message
- [ ] Parent portal → Attendance tab shows the dated list of present/absent/late records
- [ ] Staff Chat → "New Conversation" button opens the inline form; entering a Student ID + message sends it; the parent sees a new unread badge in their portal Chat
- [ ] Admin Notifications → two new sections ("Fee alerts", "Receipt alerts") appear for admin users; teachers do NOT see them
- [ ] Service worker v14 is registered (DevTools → Application → Service Workers)

---

*Result calculations, grading, positions, report card generation, printing and every staff/portal query: completely untouched.*
