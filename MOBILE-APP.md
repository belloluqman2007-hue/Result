# Ameenullah School — Official Android Mobile App (`.apk` & Play Store `.aab`)

This repository includes a full **Capacitor Android** mobile app (`com.ameenullah.school`) connected directly to your live hosted school portal, plus an automated **GitHub Actions** builder that compiles a signed `.apk` (for direct phone installation & WhatsApp sharing) and `.aab` (for Google Play Store).

---

## 1. How to Get Your `.apk` File

Once this code is on your `main` branch on GitHub (or whenever you run the workflow manually):

1. Open your GitHub repository → click the **Actions** tab at the top.
2. Select **Build Android App (APK & Play Store AAB)**.
   - It runs automatically when mobile app files are pushed to `main`, **or** you can click **Run workflow** at any time.
3. When the green checkmark appears (takes ~3 minutes):
   - **Direct Link / GitHub Releases:** `Ameenullah-School.apk` is automatically published to your repository's **Releases** (`apk-latest`), and the **"Download Android App"** button on your school website (`/download/app.apk`) downloads it directly!
   - **Workflow Artifacts:** You can also download `Ameenullah-School-APK` (for direct Android install / WhatsApp sharing) and `Ameenullah-School-PlayStore-AAB` (for Google Play Console) from the bottom of the workflow run page.

---

## 2. How to Change Your Live Hosted Server URL

Everything is controlled from **one file**: `mobile-app/app-config.json`.

- **Default Primary Server:** `https://result-cfn8.onrender.com`
- **Automatic Backup Server:** `https://result-production-69ea.up.railway.app`

### Option A — Change without touching code (on GitHub Actions)
1. Go to GitHub → **Actions** → **Build Android App (APK & Play Store AAB)** → **Run workflow**.
2. Paste your new live domain (for example `https://ameenullahschool.com`) into the **server_url** box and click **Run workflow**.

### Option B — Change permanently in the repository
Run one command from the project root:
```bash
npm run app:set-url -- https://your-new-domain.com
npm run app:sync
```
Commit and push to `main` — GitHub Actions will rebuild and publish the updated `.apk` automatically.

### Option C — Automatic Domain Follow (`SITE_URL`)
If you set `SITE_URL=https://your-new-domain.com` in your Render/Railway environment variables, `/api/app-config` announces the new domain so existing installed apps follow it automatically.

---

## 3. What Works Inside the Android App

- **Instant Branded Launch & Wake-Up Screen:** Shows the official **Ameenullah School** crest & Basmalah immediately on tap and smoothly waits if your cloud server is waking up from sleep, with automatic failover to the backup deployment.
- **Home Screen App Shortcuts:** Long-press the **Ameenullah** app icon on any Android phone to jump straight to **Check Result**, **Parent Portal**, or **Staff Login**.
- **Native PDF, Excel & ZIP Downloads:** Report cards, exam papers, fee receipts, ID cards, certificates, timetables, calendars, and Excel gradebooks save straight to the phone's **Downloads** folder and open automatically.
- **Native Printing (`window.print`):** Every **Print** button opens Android's native **A4 Print / Save as PDF** dialog.
- **Camera & File Uploads:** Student photos, signatures, Excel result imports, and payment receipt uploads open the phone camera or file picker natively.
- **Hardware Back Button:** Pressing Back navigates cleanly through previous portal pages; double-press on the start page exits the app.
- **WhatsApp, Phone & Email Links:** Clicking school phone numbers, emails, or WhatsApp links opens the native Dialer, Mail, or WhatsApp app directly.

---

## 4. Publishing to Google Play Store (Optional)

To sign updates permanently with your own Google Play upload keystore:

1. Generate a keystore once on any computer with Java installed:
   ```bash
   keytool -genkeypair -v -keystore ameenullah-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias ameenullah
   base64 -w 0 ameenullah-release.jks > keystore.b64
   ```
2. In your GitHub repository → **Settings** → **Secrets and variables** → **Actions**, add these four secrets:
   - `ANDROID_KEYSTORE_BASE64` (contents of `keystore.b64`)
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS` (`ameenullah`)
   - `ANDROID_KEY_PASSWORD`
3. Re-run the **Build Android App** workflow and upload `Ameenullah-School.aab` to Google Play Console.
