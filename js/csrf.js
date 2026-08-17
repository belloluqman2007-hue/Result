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

    function getToken() {
        if (csrfToken) return Promise.resolve(csrfToken);
        if (fetchingToken) return fetchingToken;
        fetchingToken = nativeFetch("/api/csrf-token", {
            credentials: "same-origin"   /* FIX: must send session cookie */
        })
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
            return nativeFetch(url, options);
        }
        return getToken().then(function (token) {
            if (token) {
                options.headers = Object.assign(
                    {},
                    headersToPlain(options.headers),
                    { "x-csrf-token": token }
                );
            }
            return nativeFetch(url, options);
        });
    };

    /* Invalidate cached token after 30 minutes so it stays fresh */
    setInterval(function () { csrfToken = null; }, 1800000);

    document.addEventListener("DOMContentLoaded", function () { getToken(); });
})();
