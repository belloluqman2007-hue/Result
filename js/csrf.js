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

    /* FIX 4: backoff between transport-level retries (ms). */
    var RETRY_DELAYS = [500, 1500];

    /* Runs one attempt; if the transport itself fails (QUIC/HTTP3 stream
       reset, connection dropped, offline blip) and the request is an
       idempotent GET/HEAD, waits briefly and tries again. fetch() only
       rejects on transport failures — a real HTTP response (200/401/500,
       anything) resolves and is returned as-is, so a request is never
       executed twice against the server. */
    function fetchWithRetry(url, options, attempt) {
        return nativeFetch(url, options).catch(function (err) {
            var method = ((options && options.method) ||
                (url && url.method) || "GET").toUpperCase();
            var idempotent = method === "GET" || method === "HEAD";
            if (!idempotent || attempt >= RETRY_DELAYS.length) throw err;
            return new Promise(function (resolve) {
                setTimeout(function () {
                    resolve(fetchWithRetry(url, options, attempt + 1));
                }, RETRY_DELAYS[attempt]);
            });
        });
    }

    function getToken() {
        if (csrfToken) return Promise.resolve(csrfToken);
        if (fetchingToken) return fetchingToken;
        fetchingToken = fetchWithRetry("/api/csrf-token", {
            credentials: "same-origin"   /* FIX: must send session cookie */
        }, 0)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                csrfToken = d.csrfToken;
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
        options = options || {};
        var method = (options.method || (url && url.method) || "GET").toUpperCase();
        var needsCsrf = ["POST", "PUT", "DELETE", "PATCH"].indexOf(method) !== -1;
        var path = typeof url === "string" ? url : (url && url.url) || "";
        var exempt = ["/login", "/portal-login", "/logout", "/api/csrf-token"];

        /* FIX: always forward the session cookie (GETs included) so
           authenticated reads like the attendance register's class list
           no longer hit the login guard and return empty. */
        if (!options.credentials) options.credentials = "same-origin";

        if (!needsCsrf || exempt.some(function (e) {
            return path === e || path.startsWith(e + "?");
        })) {
            return fetchWithRetry(url, options, 0);
        }
        return getToken().then(function (token) {
            if (token) {
                options.headers = Object.assign(
                    {},
                    headersToPlain(options.headers),
                    { "x-csrf-token": token }
                );
            }
            return fetchWithRetry(url, options, 0);
        });
    };

    /* Invalidate cached token after 30 minutes so it stays fresh */
    setInterval(function () { csrfToken = null; }, 1800000);

    document.addEventListener("DOMContentLoaded", function () { getToken(); });
})();
