/* ==========================================================================
   NEW FILE — auth-remember.js
   "Sign in once per device" — persistent login for staff AND the
   Student/Parent portal.
   --------------------------------------------------------------------------
   WHY THIS FILE EXISTS (owner: "I can't be logging in every time I want to
   access the app — find a way to fix that"):
   The normal login only lives inside an express-session cookie. That cookie
   is lost whenever the session row cannot be read (a restart/deploy, a cold
   database, a phone that clears WebView cookies, a changed SESSION_SECRET,
   or the user simply closing the Android app). The user then has to type the
   password again. That is what kept happening.

   This module adds the standard "remember this device" layer:
     * on a successful login we mint a random, long-lived device token,
     * only a SHA-256 HASH of the secret half is stored in MySQL,
     * the browser/phone keeps `selector.validator` in an HttpOnly cookie,
     * every request that has NO session but HAS this cookie is signed back
       in automatically (sliding one-year expiry),
     * logging out (or "sign out this device / everywhere") deletes it.

   IMPORTANT: this token does NOT depend on SESSION_SECRET, so it survives
   secret rotation and server restarts. That is the whole point.

   Security notes:
     - The validator half is compared with a constant-time hash compare.
     - A cookie whose validator does not match the stored hash is treated as
       forged and the row is deleted (no guessing, no replay of a bad value).
     - The token is HttpOnly + SameSite=Lax, and Secure in production.
     - Tokens are deleted on logout and can be revoked per device.
   ========================================================================== */
"use strict";

const crypto = require("crypto");

const COOKIE_NAME = "ams_device";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 365; // 1 year, sliding
const STAFF_KIND = "staff";
const PORTAL_KIND = "portal";

function sha256(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function randomHex(bytes) {
    return crypto.randomBytes(bytes).toString("hex");
}

/* Constant-time compare of two hex strings (falls back safely). */
function safeEqual(a, b) {
    const left = Buffer.from(String(a || ""), "utf8");
    const right = Buffer.from(String(b || ""), "utf8");
    if (left.length !== right.length) return false;
    try {
        return crypto.timingSafeEqual(left, right);
    } catch (e) {
        return false;
    }
}

/* Tiny cookie reader — the app does not depend on cookie-parser, and adding a
   package for one cookie is not worth the RAM on the free tier. */
function readCookie(req, name) {
    const wanted = name || COOKIE_NAME;
    const header = (req && req.headers && req.headers.cookie) || "";
    if (!header) return "";
    const parts = header.split(";");
    for (let i = 0; i < parts.length; i++) {
        const piece = parts[i];
        const eq = piece.indexOf("=");
        if (eq === -1) continue;
        const key = piece.slice(0, eq).trim();
        if (key !== wanted) continue;
        let value = piece.slice(eq + 1).trim();
        try {
            value = decodeURIComponent(value);
        } catch (e) {
            /* keep the raw value */
        }
        return value;
    }
    return "";
}

/* Friendly "which device is this?" label for the Settings list.
   Deliberately simple and dependency-free. */
function describeUserAgent(ua) {
    const text = String(ua || "");
    if (!text) return "Unknown device";
    const device = /Android/i.test(text)
        ? (/Tablet|SM-T|Nexus 9|Nexus 10/i.test(text) ? "Android tablet" : "Android phone")
        : (/iPhone/i.test(text) ? "iPhone"
            : (/iPad/i.test(text) ? "iPad"
                : (/Windows/i.test(text) ? "Windows computer"
                    : (/Macintosh|Mac OS X/i.test(text) ? "Mac"
                        : (/Linux/i.test(text) ? "Linux computer" : "Phone or computer")))));
    const app = /AmeenullahAndroidApp/i.test(text) ? "Ameenullah app" : "";
    const browser = /EdgA?\//i.test(text) ? "Edge"
        : (/OPR\/|Opera/i.test(text) ? "Opera"
            : (/CriOS|Chrome\//i.test(text) ? "Chrome"
                : (/FxiOS|Firefox\//i.test(text) ? "Firefox"
                    : (/Safari\//i.test(text) ? "Safari" : ""))));
    return [app || browser || device, app ? device : (browser ? device : "")].filter(Boolean).join(" · ");
}

function createRememberService(db, options) {
    const opts = options || {};
    const cookieName = opts.cookieName || COOKIE_NAME;
    const ttlMs = Number(opts.ttlMs) || TOKEN_TTL_MS;
    /* `secure` is decided per-request by the caller so local HTTP testing
       still works; the store itself never inspects the request. */
    let tableState = "pending"; // pending | ready | failed
    const waiters = [];
    let warnOnce = false;

    function logWarn(message, err) {
        if (warnOnce) return;
        warnOnce = true;
        console.warn("[remember] " + message + (err ? " (" + (err.code || err.message || err) + ")" : ""));
    }

    let creating = false;
    let createAttempts = 0;

    function ensureTable(cb) {
        if (tableState === "ready") return cb && cb(null);
        if (tableState === "failed") return cb && cb(new Error("remember table unavailable"));
        if (cb) waiters.push(cb);
        if (creating) return; // a creation is already in flight
        creating = true;
        db.query(
            `CREATE TABLE IF NOT EXISTS auth_remember_tokens (
                selector VARCHAR(64) NOT NULL PRIMARY KEY,
                validator_hash CHAR(64) NOT NULL,
                subject_kind VARCHAR(16) NOT NULL,
                subject_id VARCHAR(64) NOT NULL,
                username VARCHAR(191) NOT NULL DEFAULT '',
                role VARCHAR(32) NOT NULL DEFAULT '',
                label VARCHAR(120) NOT NULL DEFAULT '',
                user_agent VARCHAR(255) NOT NULL DEFAULT '',
                ip VARCHAR(64) NOT NULL DEFAULT '',
                created_at BIGINT NOT NULL,
                last_used_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL,
                KEY idx_remember_subject (subject_kind, subject_id),
                KEY idx_remember_expiry (expires_at)
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
            (err) => {
                creating = false;
                if (err) {
                    /* The database is often still warming up when Render boots
                       us, so a failed CREATE is retried with backoff instead of
                       permanently disabling "stay signed in" for this run. */
                    createAttempts++;
                    tableState = createAttempts < 8 ? "pending" : "failed";
                    logWarn("could not create auth_remember_tokens yet — retrying; users just sign in normally until it succeeds", err);
                    if (tableState === "pending") {
                        const delay = 60000 * Math.min(createAttempts, 5);
                        const timer = setTimeout(() => ensureTable(), delay);
                        if (timer.unref) timer.unref();
                    }
                } else {
                    tableState = "ready";
                }
                const pending = waiters.splice(0, waiters.length);
                pending.forEach((fn) => {
                    try {
                        fn(err || null);
                    } catch (e) {
                        console.error("[remember] waiter failed:", e && e.message);
                    }
                });
            }
        );
    }

    function whenReady(cb) {
        if (tableState === "ready") return cb(null);
        if (tableState === "failed") return cb(new Error("remember table unavailable"));
        ensureTable(cb);
    }

    /* Create a fresh device token. Returns the value to put in the cookie
       ("selector.validator") and the row selector. */
    function issue(record, cb) {
        const done = typeof cb === "function" ? cb : function () {};
        const now = Date.now();
        const selector = randomHex(12);
        const validator = randomHex(32);
        const row = {
            selector,
            validator_hash: sha256(validator),
            subject_kind: String(record.kind || STAFF_KIND),
            subject_id: String(record.id == null ? "" : record.id),
            username: String(record.username || "").slice(0, 190),
            role: String(record.role || "").slice(0, 30),
            label: String(record.label || describeUserAgent(record.userAgent)).slice(0, 118),
            user_agent: String(record.userAgent || "").slice(0, 250),
            ip: String(record.ip || "").slice(0, 62),
            created_at: now,
            last_used_at: now,
            expires_at: now + ttlMs
        };
        whenReady((readyErr) => {
            if (readyErr) return done(readyErr, null);
            db.query(
                `INSERT INTO auth_remember_tokens
                     (selector, validator_hash, subject_kind, subject_id, username,
                      role, label, user_agent, ip, created_at, last_used_at, expires_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
                [row.selector, row.validator_hash, row.subject_kind, row.subject_id, row.username,
                    row.role, row.label, row.user_agent, row.ip, row.created_at, row.last_used_at, row.expires_at],
                (err) => {
                    if (err) {
                        logWarn("could not save a device token", err);
                        return done(err, null);
                    }
                    done(null, selector + "." + validator, selector);
                }
            );
        });
    }

    /* Look a device token up.
       cb(err, record, newExpiryMs) — record is null when the token is not
       valid (expired, forged, revoked or unknown). */
    function verify(token, cb) {
        const done = typeof cb === "function" ? cb : function () {};
        const raw = String(token || "").trim();
        const dot = raw.indexOf(".");
        if (dot <= 0) return done(null, null);
        const selector = raw.slice(0, dot);
        const validator = raw.slice(dot + 1);
        if (!/^[a-f0-9]{8,64}$/i.test(selector) || !validator) return done(null, null);

        whenReady((readyErr) => {
            if (readyErr) return done(null, null);
            db.query(
                `SELECT selector, validator_hash, subject_kind, subject_id, username, role,
                        label, user_agent, created_at, last_used_at, expires_at
                   FROM auth_remember_tokens WHERE selector = ? LIMIT 1`,
                [selector],
                (err, rows) => {
                    if (err) return done(null, null); // never crash a page over this
                    if (!rows || !rows.length) return done(null, null);
                    const row = rows[0];
                    const expiry = Number(row.expires_at) || 0;
                    if (!expiry || expiry < Date.now()) {
                        revokeBySelector(selector, () => done(null, null));
                        return;
                    }
                    if (!safeEqual(row.validator_hash, sha256(validator))) {
                        /* A wrong secret for a known selector is never a
                           typo on our side — drop the row. */
                        revokeBySelector(selector, () => done(null, null));
                        return;
                    }
                    const nextExpiry = Date.now() + ttlMs;
                    db.query(
                        "UPDATE auth_remember_tokens SET last_used_at = ?, expires_at = ? WHERE selector = ?",
                        [Date.now(), nextExpiry, selector],
                        () => done(null, row, nextExpiry)
                    );
                }
            );
        });
    }

    function revokeBySelector(selector, cb) {
        const done = typeof cb === "function" ? cb : function () {};
        if (!selector) return done(null);
        whenReady((readyErr) => {
            if (readyErr) return done(null);
            db.query("DELETE FROM auth_remember_tokens WHERE selector = ?", [String(selector)], () => done(null));
        });
    }

    function revokeToken(token, cb) {
        const raw = String(token || "");
        const dot = raw.indexOf(".");
        return revokeBySelector(dot > 0 ? raw.slice(0, dot) : "", cb);
    }

    function revokeAll(kind, id, cb) {
        const done = typeof cb === "function" ? cb : function () {};
        whenReady((readyErr) => {
            if (readyErr) return done(null, 0);
            db.query(
                "DELETE FROM auth_remember_tokens WHERE subject_kind = ? AND subject_id = ?",
                [String(kind), String(id)],
                (err, result) => {
                    if (err) return done(null, 0);
                    done(null, (result && result.affectedRows) || 0);
                }
            );
        });
    }

    function list(kind, id, cb) {
        const done = typeof cb === "function" ? cb : function () {};
        whenReady((readyErr) => {
            if (readyErr) return done(null, []);
            db.query(
                `SELECT selector, label, user_agent, ip, created_at, last_used_at, expires_at
                   FROM auth_remember_tokens
                  WHERE subject_kind = ? AND subject_id = ? AND expires_at > ?
                  ORDER BY last_used_at DESC`,
                [String(kind), String(id), Date.now()],
                (err, rows) => {
                    if (err) return done(null, []);
                    done(null, rows || []);
                }
            );
        });
    }

    /* Hourly sweep of dead rows (keeps the table tiny for 1000 users). */
    function startCleanup() {
        const timer = setInterval(() => {
            if (tableState !== "ready") return;
            db.query("DELETE FROM auth_remember_tokens WHERE expires_at < ?", [Date.now()], () => {});
        }, 1000 * 60 * 60);
        if (timer.unref) timer.unref();
    }

    return {
        cookieName,
        ttlMs,
        ensureTable,
        issue,
        verify,
        revokeToken,
        revokeBySelector,
        revokeAll,
        list,
        startCleanup
    };
}

module.exports = {
    COOKIE_NAME,
    TOKEN_TTL_MS,
    STAFF_KIND,
    PORTAL_KIND,
    createRememberService,
    readCookie,
    describeUserAgent,
    sha256
};
