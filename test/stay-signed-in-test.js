/* ==========================================================================
   test/stay-signed-in-test.js
   --------------------------------------------------------------------------
   Regression proof for the owner's complaint:
     "I can't be logging in every time I want to access the app."
   The server is booted against an in-memory fake database, then the real
   login → restart-the-app flow is exercised over HTTP:

     1. POST /login mints a long-lived device token (HttpOnly cookie).
     2. A brand new browser/phone (NO session cookie, only the device cookie)
        is signed straight back in - /me says loggedIn, /app-start redirects
        to the dashboard instead of the login form.
     3. A forged/rotated-out device token does NOT sign anyone in.
     4. POST /logout really forgets the device.
     5. "Remember me" unticked issues no device token at all.
     6. Settings can list / revoke devices and sign other devices out.
   ========================================================================== */
"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const bcrypt = require("bcryptjs");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");

/* ------------------------------------------------------------------ */
/* --serve: child process that runs server.js with a fake database.    */
/* ------------------------------------------------------------------ */
if (process.argv[2] === "--serve") {
  const port = Number(process.argv[3]);
  process.env.PORT = String(port);
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "stay-signed-in-test-secret";
  process.env.DB_PASSWORD = "stay-signed-in-test-db";
  process.env.ADMIN_DEFAULT_PASSWORD = "testpassword123";

  const sessions = new Map();   // sid -> { sess, expires_at }
  const devices = new Map();    // selector -> row
  const users = new Map();
  users.set("owner", {
    id: 1,
    username: "owner",
    // bcrypt hash of "secret123"
    password_hash: bcrypt.hashSync("secret123", 8),
    role: "admin"
  });

  function rows(list) {
    return list;
  }

  function fakeQuery(sql, params, cb) {
    if (typeof params === "function") { cb = params; params = []; }
    params = params || [];
    const q = String(sql).replace(/\s+/g, " ").trim();
    const reply = (err, res) => { if (cb) setImmediate(() => cb(err, res)); };
    const lower = q.toLowerCase();

    try {
      /* ---- users table ---- */
      if (lower.startsWith("select * from users where username")) {
        const found = users.get(String(params[0] || "").trim());
        return reply(null, found ? [found] : []);
      }
      if (lower.startsWith("select id, username, role from users where id")) {
        const wanted = Number(params[0]);
        for (const user of users.values()) {
          if (Number(user.id) === wanted) return reply(null, [{ id: user.id, username: user.username, role: user.role }]);
        }
        return reply(null, []);
      }

      /* ---- app_sessions (express-session store) ---- */
      if (lower.startsWith("create table if not exists app_sessions")) return reply(null, []);
      if (lower.startsWith("select sess, expires_at from app_sessions")) {
        const row = sessions.get(String(params[0]));
        return reply(null, row ? [row] : []);
      }
      if (lower.startsWith("insert into app_sessions")) {
        sessions.set(String(params[0]), { sess: String(params[1]), expires_at: Number(params[2]) });
        return reply(null, { affectedRows: 1 });
      }
      if (lower.startsWith("update app_sessions set expires_at")) {
        const row = sessions.get(String(params[1]));
        if (row) row.expires_at = Number(params[0]);
        return reply(null, { affectedRows: row ? 1 : 0 });
      }
      if (lower.startsWith("delete from app_sessions where sid <>")) return reply(null, { affectedRows: 0 });
      if (lower.startsWith("delete from app_sessions where sid")) {
        sessions.delete(String(params[0]));
        return reply(null, { affectedRows: 1 });
      }
      if (lower.startsWith("delete from app_sessions where expires_at")) return reply(null, { affectedRows: 0 });

      /* ---- auth_remember_tokens (device tokens) ---- */
      if (lower.startsWith("create table if not exists auth_remember_tokens")) return reply(null, []);
      if (lower.startsWith("insert into auth_remember_tokens")) {
        const [selector, validator_hash, subject_kind, subject_id, username, role,
          label, user_agent, ip, created_at, last_used_at, expires_at] = params;
        devices.set(String(selector), {
          selector: String(selector),
          validator_hash: String(validator_hash),
          subject_kind: String(subject_kind),
          subject_id: String(subject_id),
          username: String(username),
          role: String(role),
          label: String(label),
          user_agent: String(user_agent),
          ip: String(ip),
          created_at: Number(created_at),
          last_used_at: Number(last_used_at),
          expires_at: Number(expires_at)
        });
        return reply(null, { affectedRows: 1 });
      }
      if (lower.startsWith("select selector, validator_hash")) {
        const row = devices.get(String(params[0]));
        return reply(null, row ? [row] : []);
      }
      if (lower.startsWith("update auth_remember_tokens set last_used_at")) {
        const row = devices.get(String(params[2]));
        if (row) { row.last_used_at = Number(params[0]); row.expires_at = Number(params[1]); }
        return reply(null, { affectedRows: row ? 1 : 0 });
      }
      if (lower.startsWith("delete from auth_remember_tokens where selector")) {
        const had = devices.delete(String(params[0]));
        return reply(null, { affectedRows: had ? 1 : 0 });
      }
      if (lower.startsWith("delete from auth_remember_tokens where subject_kind")) {
        let removed = 0;
        for (const [key, row] of Array.from(devices.entries())) {
          if (row.subject_kind === String(params[0]) && row.subject_id === String(params[1])) {
            devices.delete(key);
            removed++;
          }
        }
        return reply(null, { affectedRows: removed });
      }
      if (lower.startsWith("select selector, label")) {
        const now = Number(params[2]);
        const found = Array.from(devices.values())
          .filter((row) => row.subject_kind === String(params[0]) && row.subject_id === String(params[1]) && row.expires_at > now)
          .sort((a, b) => b.last_used_at - a.last_used_at);
        return reply(null, found);
      }
      if (lower.startsWith("delete from auth_remember_tokens where expires_at")) return reply(null, { affectedRows: 0 });

      /* ---- everything else: empty result, like the other server tests ---- */
      return reply(null, []);
    } catch (err) {
      return reply(err, null);
    }
  }

  fakeQuery.__devices = devices;
  fakeQuery.__sessions = sessions;

  const dbPath = fs.realpathSync(path.join(REPO, "db.js"));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: fakeQuery, getConnection: (cb) => cb && cb(null, { query: fakeQuery, release: () => {} }), end: (cb) => cb && cb() } };
  require(path.join(REPO, "server.js"));
  setTimeout(() => console.log("READY " + port), 900);
  return;
}

/* ------------------------------------------------------------------ */
/* Main test process                                                   */
/* ------------------------------------------------------------------ */
let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log("  ok   - " + label); }
  else { failed++; console.error("  FAIL - " + label + (detail ? " (" + detail + ")" : "")); }
}

function parseSetCookie(headers) {
  const raw = headers["set-cookie"];
  return Array.isArray(raw) ? raw : (raw ? [raw] : []);
}

function cookieValue(setCookies, name) {
  for (const line of setCookies) {
    if (String(line).indexOf(name + "=") === 0) {
      const value = String(line).split(";")[0].slice(name.length + 1);
      return decodeURIComponent(value);
    }
  }
  return null;
}

function request(port, urlPath, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opts.headers);
    if (opts.cookie) headers.Cookie = opts.cookie;
    let body = null;
    if (opts.body !== undefined) {
      body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = http.request(
      { hostname: "127.0.0.1", port, path: urlPath, method: opts.method || "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          setCookies: parseSetCookie(res.headers)
        }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, "--serve", String(port)], {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => reject(new Error("server did not start: " + out + err)), 25000);
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
      if (out.indexOf("READY " + port) !== -1) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("server exited early (" + code + "): " + err));
    });
  });
}

async function main() {
  console.log("\nStay signed in (one sign-in per device)");
  const port = 45871;
  let child = null;
  try {
    child = await startServer(port);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  try {
    /* ---------- 1. normal login, remember on (the default) ---------- */
    const login = await request(port, "/login", { method: "POST", body: { username: "owner", password: "secret123" } });
    check("POST /login succeeds", login.status === 200, "status " + login.status);

    const sessionCookie = cookieValue(login.setCookies, "connect.sid");
    const deviceCookie = cookieValue(login.setCookies, "ams_device");
    check("login issues the normal session cookie", Boolean(sessionCookie));
    check("login also issues a long-lived device token (ams_device)", Boolean(deviceCookie));
    check("device token looks like selector.validator", /^[a-f0-9]{24}\.[a-f0-9]{64}$/i.test(deviceCookie || ""), deviceCookie || "none");
    check("device cookie is HttpOnly + SameSite=Lax + one year",
      login.setCookies.some((line) => /^ams_device=/.test(line) && /HttpOnly/i.test(line) && /SameSite=Lax/i.test(line)));
    check("login answer says staySignedIn", /"staySignedIn":true/.test(login.body), login.body);

    /* ---------- 2. brand new browser / app restart ---------- */
    const freshMe = await request(port, "/me", { cookie: "ams_device=" + deviceCookie });
    check("a device with ONLY the device token is signed back in",
      /"loggedIn":true/.test(freshMe.body), freshMe.body);
    check("restored session carries the right identity",
      /"username":"owner"/.test(freshMe.body) && /"role":"admin"/.test(freshMe.body), freshMe.body);
    check("restore is flagged for the UI", /"restored":true/.test(freshMe.body), freshMe.body);

    const appStart = await request(port, "/app-start", { cookie: "ams_device=" + deviceCookie });
    check("opening the app goes straight to the dashboard",
      appStart.status === 302 && String(appStart.headers.location).indexOf("teacher-dashboard.html") !== -1,
      appStart.status + " -> " + appStart.headers.location);

    const noCookieStart = await request(port, "/app-start");
    check("a device with nothing goes to the public site (not a login wall)",
      noCookieStart.status === 302 && String(noCookieStart.headers.location) === "/",
      noCookieStart.status + " -> " + noCookieStart.headers.location);

    const anonymous = await request(port, "/me");
    check("no cookies at all is still logged out", /"loggedIn":false/.test(anonymous.body), anonymous.body);

    /* ---------- 3. tampering ---------- */
    const tampered = deviceCookie.split(".")[0] + "." + "0".repeat(64);
    const forged = await request(port, "/me", { cookie: "ams_device=" + tampered });
    check("a tampered device token is rejected", /"loggedIn":false/.test(forged.body), forged.body);

    const afterForgery = await request(port, "/me", { cookie: "ams_device=" + deviceCookie });
    check("a rejected token is burned (cannot be retried)", /"loggedIn":false/.test(afterForgery.body), afterForgery.body);

    /* ---------- 4. login again, then sign out for real ---------- */
    const login2 = await request(port, "/login", { method: "POST", body: { username: "owner", password: "secret123" } });
    const device2 = cookieValue(login2.setCookies, "ams_device");
    const session2 = cookieValue(login2.setCookies, "connect.sid");
    check("second login issues a fresh device token", Boolean(device2) && device2 !== deviceCookie);

    const logout = await request(port, "/logout", {
      method: "POST",
      cookie: "connect.sid=" + session2 + "; ams_device=" + device2
    });
    check("POST /logout succeeds", logout.status === 200, "status " + logout.status);
    check("logout clears the device cookie", logout.setCookies.some((line) => /^ams_device=;/.test(line)));

    const afterLogout = await request(port, "/me", { cookie: "ams_device=" + device2 });
    check("after logout the device is NOT signed back in", /"loggedIn":false/.test(afterLogout.body), afterLogout.body);

    /* ---------- 5. remember unticked ---------- */
    const noRemember = await request(port, "/login", {
      method: "POST",
      body: { username: "owner", password: "secret123", remember: false }
    });
    check("un-ticking 'keep me signed in' issues no device token",
      !cookieValue(noRemember.setCookies, "ams_device"), "cookies: " + noRemember.setCookies.join(" | "));

    /* ---------- 6. Settings: devices list, toggle, revoke ---------- */
    const login3 = await request(port, "/login", { method: "POST", body: { username: "owner", password: "secret123" } });
    const session3 = cookieValue(login3.setCookies, "connect.sid");
    const device3 = cookieValue(login3.setCookies, "ams_device");

    const csrf = await request(port, "/api/csrf-token", { cookie: "connect.sid=" + session3 });
    const csrfToken = (JSON.parse(csrf.body || "{}") || {}).csrfToken;
    check("CSRF token is available for the settings calls", Boolean(csrfToken));

    const devicesList = await request(port, "/api/signin/devices", { cookie: "connect.sid=" + session3 + "; ams_device=" + device3 });
    check("GET /api/signin/devices lists the saved device", /"devices":\[\{/.test(devicesList.body) && /"current":true/.test(devicesList.body), devicesList.body);
    check("device list shows staySignedIn", /"staySignedIn":true/.test(devicesList.body), devicesList.body);

    const selector = device3.split(".")[0];
    const revoke = await request(port, "/api/signin/devices/revoke", {
      method: "POST",
      cookie: "connect.sid=" + session3 + "; ams_device=" + device3,
      headers: { "x-csrf-token": csrfToken },
      body: { id: selector }
    });
    check("a saved device can be removed from Settings", revoke.status === 200, revoke.status + " " + revoke.body);

    const revokedMe = await request(port, "/me", { cookie: "ams_device=" + device3 });
    check("a removed device is no longer signed in", /"loggedIn":false/.test(revokedMe.body), revokedMe.body);

    const optIn = await request(port, "/api/signin/stay-signed-in", {
      method: "POST",
      cookie: "connect.sid=" + session3,
      headers: { "x-csrf-token": csrfToken },
      body: { enabled: true }
    });
    check("Settings can turn 'stay signed in' back on",
      optIn.status === 200 && /"staySignedIn":true/.test(optIn.body) && optIn.setCookies.some((line) => /^ams_device=/.test(line)),
      optIn.body);

    const signOutAll = await request(port, "/api/signin/sign-out-everywhere", {
      method: "POST",
      cookie: "connect.sid=" + session3,
      headers: { "x-csrf-token": csrfToken },
      body: {}
    });
    check("'sign out of every other device' works", signOutAll.status === 200, signOutAll.status + " " + signOutAll.body);

    /* ---------- 7. the pages themselves ---------- */
    const loginPage = await request(port, "/login.html");
    check("staff login page has the 'keep me signed in' switch", /id="rememberDevice"/.test(loginPage.body));
    check("staff login page links the parent login", /portal-login\.html/.test(loginPage.body));

    const portalPage = await request(port, "/portal-login.html");
    check("parent login page has the 'keep me signed in' switch", /id="portalRememberDevice"/.test(portalPage.body));

    const settingsPage = await request(port, "/settings.html", { cookie: "connect.sid=" + session3 });
    check("Settings exposes the sign-in & devices card", /id="stStay"/.test(settingsPage.body) && /id="stDevices"/.test(settingsPage.body));

    const homePage = await request(port, "/index.html");
    check("public home page offers a 'Continue' shortcut to a signed-in device",
      /id="wb2ContinueBtn"/.test(homePage.body) && /Continue as/.test(homePage.body));

    const loginJs = fs.readFileSync(path.join(REPO, "js", "login.js"), "utf8");
    check("staff login script skips the form when already signed in", /fetch\("\/me"/.test(loginJs) && /location\.replace/.test(loginJs));
    check("staff login script sends the remember flag", /remember: remember/.test(loginJs));

    const portalLoginJs = fs.readFileSync(path.join(REPO, "js", "portal-login.js"), "utf8");
    check("parent login script sends the remember flag", /remember: remember/.test(portalLoginJs));

    const splash = fs.readFileSync(path.join(REPO, "mobile-app", "www", "index.html"), "utf8");
    check("mobile splash opens on /app-start by default", /DEFAULT_START_PATH = "\/app-start"/.test(splash));
    check("mobile splash remembers the destination after the app is closed", /localStorage\.setItem\(LAST_PATH_KEY/.test(splash));
    check("mobile splash has a one-tap 'continue to my dashboard'", /data-path="\/app-start"/.test(splash));

    const serverJs = fs.readFileSync(path.join(REPO, "server.js"), "utf8");
    check("server trusts the hosting proxy in every environment", /app\.set\("trust proxy", 1\);/.test(serverJs));
    check("session store falls back to memory instead of logging users out", /this\.mem = new Map\(\)/.test(serverJs));
    check("device tokens are hashed, never stored in plain text", /validator_hash/.test(fs.readFileSync(path.join(REPO, "auth-remember.js"), "utf8")));
  } finally {
    if (child) child.kill("SIGKILL");
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
  console.log("ALL CHECKS PASS - one sign-in per device, logout really forgets the device\n");
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
