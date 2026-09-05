/**
 * csrf.js — Global CSRF token auto-injector
 * FIX 1: Added credentials:"same-origin" to token fetch so session
 *         cookie is always sent, preventing session mismatch that
 *         caused "Invalid CSRF token" on change-password.
 * FIX 2: headersToPlain() properly handles Headers instances so
 *         Content-Type is never dropped (fixes create-user bug).
 * FIX 3: "Load Register" showed no students and the class dropdown stayed
 *         empty. The GET passthrough returned fetch without forwarding the
 *         session cookie, so authenticated reads (GET /api/distinct-classes,
 *         /classes, /attendance/class) hit the login guard and came back
 *         empty. Now EVERY request carries credentials:"same-origin".
 *         Also guards against double-wrapping fetch if this file is ever
 *         included more than once.
 * FIX 4: net::ERR_QUIC_PROTOCOL_ERROR 200 (OK) kept killing the Mark
 *         Register load (students not displaying after picking a class).
 *         That console line is NOT a bug in this file — it is simply where
 *         the browser attributes the real network call. The error means
 *         the HTTP/3 (QUIC) transport dropped mid-response (flaky mobile
 *         data / QUIC race in Chrome), so fetch() REJECTS even though the
 *         server answered 200 OK, and the register died with "Could not
 *         load". Idempotent GET/HEAD requests are now RETRIED
 *         automatically (2 extra tries with short backoff): after a QUIC
 *         stream failure Chrome marks QUIC broken for the site and the
 *         retry goes over plain TCP, which almost always succeeds.
 *         POST/PUT/DELETE/PATCH are NEVER auto-retried (not idempotent —
 *         must not risk a double-save), and any response that DOES arrive
 *         (whatever its status) is returned untouched.
 * FIX 5 (pack 108): the report came back as "the mistake is in csrf.js:52
 *         again — 500 internal server error". Line 52 is this wrapper's own
 *         nativeFetch() call, so the console blamed the messenger twice now.
 *         Two real improvements here so that never happens again, plus the
 *         one that fixes the symptom:
 *           a. EVERY server error is now logged with the URL and the method
 *              ("[fetch] GET /attendance/class?... -> HTTP 500"), so the
 *              console names the endpoint that actually failed instead of a
 *              line in this file.
 *           b. Idempotent GET/HEAD retries are no longer limited to
 *              transport failures: a 500/502/503/504 ANSWER is retried on
 *              the same budget too. That is exactly the Render/Aiven cold
 *              start and the "database was still waking up" 500 — a read is
 *              safe to repeat, and one retry is usually all it needs.
 *              POST/PUT/DELETE/PATCH still answer on the first try, always.
 *           c. Exempt-path matching now works for absolute URLs and Request
 *              objects (the old check compared "https://site/login" with
 *              "/login" and missed), and a caller's own credentials mode is
 *              never downgraded when it passes a Request.
 */
(function () {
    // Guard: never wrap fetch twice (double-include safety).
    if (window.__csrfWrapped) return;
    window.__csrfWrapped = true;

    var csrfToken = null;
    var fetchingToken = null;

    // Capture the REAL native fetch exactly once.
    var nativeFetch = window.__csrfNativeFetch || window.fetch.bind(window);
    window.__csrfNativeFetch = nativeFetch;

    /* FIX 4/5: backoff between retries (ms). */
    var RETRY_DELAYS = [500, 1500];

    /* FIX 5b: statuses that are worth asking a second time — but only for a
       read. 502/503/504 is Render's free tier waking up; 500 is what a
       half-ready database answers while its boot repairs are still running. */
    function retryableStatus(st) {
        return st === 500 || st === 502 || st === 503 || st === 504;
    }

    function methodOf(url, options) {
        return String((options && options.method) || (url && url.method) || "GET").toUpperCase();
    }
    function isIdempotent(url, options) {
        var m = methodOf(url, options);
        return m === "GET" || m === "HEAD";
    }
    function urlText(url) {
        if (typeof url === "string") return url;
        if (url && url.url) return String(url.url);
        return String(url == null ? "" : url);
    }
    function pathOf(url) {
        var u = urlText(url);
        if (/^https?:\/\//i.test(u)) {
            try { return new URL(u, window.location.href).pathname; } catch (e) { u = u.replace(/^https?:\/\/[^/]+/i, ""); }
        }
        return String(u).split("?")[0].split("#")[0] || "/";
    }

    function wait(ms, fn) {
        return new Promise(function (resolve) {
            setTimeout(function () { resolve(fn()); }, ms);
        });
    }

    /* One attempt. fetch() rejects only when the TRANSPORT fails (QUIC stream
       reset, connection drop, offline blip); a real HTTP answer resolves.
       Either way an idempotent read gets the retry budget, a write never
       does, and a response that is returned was never consumed. */
    function fetchWithRetry(url, options, attempt) {
        var idempotent = isIdempotent(url, options);
        var canRetry = idempotent && attempt < RETRY_DELAYS.length;
        return nativeFetch(url, options).then(function (resp) {
            if (!canRetry || !resp || !retryableStatus(resp.status)) {
                if (resp && resp.status >= 400) {
                    /* FIX 5a: name the endpoint, not this file. */
                    console.warn("[fetch] " + methodOf(url, options) + " " + urlText(url) +
                        " -> HTTP " + resp.status + (idempotent && attempt ? " (after " + attempt + " retr" + (attempt > 1 ? "ies" : "y") + ")" : ""));
                }
                return resp;
            }
            console.warn("[fetch] " + methodOf(url, options) + " " + urlText(url) + " -> HTTP " + resp.status +
                "; retrying (" + (attempt + 1) + "/" + RETRY_DELAYS.length + ")");
            try { if (resp.body && resp.body.cancel) resp.body.cancel(); } catch (e) {}
            return wait(RETRY_DELAYS[attempt], function () {
                return fetchWithRetry(url, options, attempt + 1);
            });
        }, function (err) {
            if (!canRetry) throw err;
            return wait(RETRY_DELAYS[attempt], function () {
                return fetchWithRetry(url, options, attempt + 1);
            }).catch(function (err2) {
                console.warn("[fetch] " + methodOf(url, options) + " " + urlText(url) +
                    " failed after " + (attempt + 1) + " tries: " + (err2 && (err2.name + ": " + err2.message) || err2) +
                    " — the console line inside csrf.js is where the browser attributes the network call, not the cause.");
                throw err2;
            });
        });
    }

    function getToken() {
        if (csrfToken) return Promise.resolve(csrfToken);
        if (fetchingToken) return fetchingToken;
        fetchingToken = fetchWithRetry("/api/csrf-token", {
            credentials: "same-origin"   /* FIX: must send session cookie */
        }, 0)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                csrfToken = (d && d.csrfToken) || null;
                fetchingToken = null;
                return csrfToken;
            })
            .catch(function () { fetchingToken = null; return null; });
        return fetchingToken;
    }

    function headersToPlain(h) {
        if (!h) return {};
        if (typeof Headers !== "undefined" && h instanceof Headers) {
            var out = {};
            h.forEach(function (v, k) { out[k] = v; });
            return out;
        }
        return h;
    }

    window.fetch = function (url, options) {
        var isRequest = (typeof Request !== "undefined" && url instanceof Request);
        options = options || {};
        var method = methodOf(url, options);
        var needsCsrf = ["POST", "PUT", "DELETE", "PATCH"].indexOf(method) !== -1;
        var path = pathOf(url);                                  /* FIX 5c */
        var exempt = ["/login", "/portal-login", "/logout", "/api/csrf-token"];

        /* FIX: always forward the session cookie (GETs included) so
           authenticated reads like the attendance register's class list
           no longer hit the login guard and return empty. A caller that
           brought its own credentials — or a Request that already carries
           one — is left alone (FIX 5c). */
        if (!options.credentials &&
            !(isRequest && url.credentials && url.credentials !== "omit" && url.credentials !== "same-origin")) {
            options.credentials = "same-origin";
        }

        if (!needsCsrf || exempt.indexOf(path) !== -1) {
            return fetchWithRetry(url, options, 0);
        }
        return getToken().then(function (token) {
            if (token) {
                var merged = Object.assign(
                    {},
                    headersToPlain(options.headers || (isRequest ? url.headers : null)),
                    { "x-csrf-token": token }
                );
                /* Only a plain-object init may be mutated; a caller's Headers
                   instance is converted so nothing is dropped either way. */
                options.headers = merged;
            }
            return fetchWithRetry(url, options, 0).then(function (resp) {
                /* FIX 5: if the server rejected the token (a session that
                   rolled over mid-page), drop the cached copy so the NEXT
                   save re-reads a fresh one instead of failing forever. */
                if (resp && resp.status === 403) csrfToken = null;
                return resp;
            });
        });
    };

    /* Invalidate cached token after 30 minutes so it stays fresh.
       FIX 5: also refresh it quietly when the server ever rejects the token,
       so one expired session cookie cannot strand a half-filled register. */
    setInterval(function () { csrfToken = null; }, 1800000);

    document.addEventListener("DOMContentLoaded", function () { getToken(); });
})();
