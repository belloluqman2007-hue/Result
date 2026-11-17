# Stay signed in — one sign-in per device

**Owner request:** _"I already merge one before but the problem is not yet fixed. I can't be
logging in every time I want to access the app. Find a way to fix that. And maybe you can't put
password and fingerprint for logging in directly, or direct log in in settings. Just do
something suitable."_

## What was actually wrong

The old "30 days" fix only made the **session cookie** last longer. That cookie is still lost
whenever the session row cannot be read back — a restart/deploy, a cold database, a phone that
clears WebView cookies, a changed `SESSION_SECRET`, or simply the app being closed. On top of
that, the pages themselves kept asking for a password:

1. `login.html` showed the form even when the device was **already signed in**.
2. The Android app always opened on the public school home (`sessionStorage` forgot the last
   page as soon as the app closed), so every launch looked like a fresh visit.
3. Nothing remembered the device, so a lost session meant typing the password again.

## What is new

### 1. Long-lived device tokens (the real fix)

`auth-remember.js` (new file) + `auth_remember_tokens` table:

* A successful **staff or parent** login mints a random `selector.validator` token.
* Only the **SHA-256 hash** of the validator is stored in MySQL; the browser keeps the token in
  an `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookie (`ams_device`, **1 year**, sliding).
* Any request that arrives with **no session but a valid device token** is signed straight back
  in — staff, admin or parent.
* The token does **not** depend on `SESSION_SECRET`, so it survives redeploys, secret rotation
  and restarts. That is exactly what kept failing before.
* A tampered/unknown validator is rejected **and the row is deleted** (no guessing).
* `/logout` and `/portal/logout` delete the token, so signing out really signs out.
* `GET /api/signin/devices` · `POST /api/signin/stay-signed-in` ·
  `POST /api/signin/devices/revoke` · `POST /api/signin/sign-out-everywhere` manage it.
* Hourly sweep removes expired rows.

### 2. Session store can no longer silently sign people out

`MySqlSessionStore` used to answer "no session" on any database hiccup. It now keeps a bounded
in-process copy and falls back to it, and a failed store write never fails a login.
`app.set("trust proxy", 1)` is now set **always** (not only when `NODE_ENV=production`), so the
secure cookie and per-IP rate limits work on every host.

### 3. The app opens where the user belongs

* New `GET /app-start`: signed-in staff → `teacher-dashboard.html`, signed-in parent →
  `portal.html`, everyone else → the public website (never a login wall).
* The Android splash now opens `/app-start` by default and stores the chosen destination in
  `localStorage` (survives the app being closed).
* New quick button: **"Continue to my dashboard"**.

### 4. Login pages stop asking when they don't need to

* `login.html` → checks `/me` first and jumps straight to the dashboard (honours a safe
  `?next=`), remembers the last username (never the password), and shows a
  "Student or parent?" link.
* `portal-login.html` → same behaviour for Student ID + surname.
* Both have a **"Keep me signed in on this device"** switch, ticked by default.

### 5. Settings → "Sign-in & devices"

New card on `settings.html`:

* **Keep me signed in on this device** toggle.
* List of saved devices with *last used*, and **Remove** per device ("THIS DEVICE" marker).
* **Sign out of every other device** (also purges those sessions).
* A short, honest note about fingerprint/face unlock: the app rides on the phone's own screen
  lock — unlock the phone with a fingerprint and Ameenullah opens straight on the dashboard.

### 6. Service worker

`sw.js` cache bumped to `ameenullah-shell-v75` so phones drop the old login pages immediately.

## Notes / limits

* Fingerprint is the **phone's** biometric lock. Asking the app itself for a fingerprint needs a
  native `BiometricPrompt` bridge, i.e. a new APK build — deliberately not touched here so the
  release build keeps compiling. The effect the owner asked for (open app → fingerprint →
  dashboard) is already achieved through the device lock.
* One device keeps one remembered identity (the last account that signed in there). Signing in
  as a parent replaces a remembered staff token on that same phone, and vice versa.
* Password hashes, the password itself and the surname are never stored on the device.

## Tests

`test/stay-signed-in-test.js` boots the real server against an in-memory database and proves:
login issues the device token → a device with **only** that token is signed back in → `/app-start`
goes to the dashboard → tampered tokens are rejected and burned → logout really forgets the
device → "remember" unticked issues no token → Settings can list/revoke/toggle and sign other
devices out. It is part of `npm test`.
