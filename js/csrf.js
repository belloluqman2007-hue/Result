/**
 * csrf.js — Global CSRF token auto-injector
 * FIX 1: Added credentials:"same-origin" to token fetch so session
 *         cookie is always sent, preventing session mismatch that
 *         caused "Invalid CSRF token" on change-password.
 * FIX 2: headersToPlain() properly handles Headers instances so
 *         Content-Type is never dropped (fixes create-user bug).
 */
(function () {
    var csrfToken = null;
    var fetchingToken = null;

    function getToken() {
        if (csrfToken) return Promise.resolve(csrfToken);
        if (fetchingToken) return fetchingToken;
        fetchingToken = window._originalFetch("/api/csrf-token", {
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

    window._originalFetch = window.fetch.bind(window);

    window.fetch = function (url, options) {
        options = options || {};
        var method = (options.method || "GET").toUpperCase();
        var needsCsrf = ["POST", "PUT", "DELETE", "PATCH"].indexOf(method) !== -1;
        var path = typeof url === "string" ? url : (url.url || "");
        var exempt = ["/login", "/portal-login", "/logout", "/api/csrf-token"];
        if (!needsCsrf || exempt.some(function (e) {
            return path === e || path.startsWith(e + "?");
        })) {
            return window._originalFetch(url, options);
        }
        /* Always ensure credentials so session cookie goes with CSRF token */
        if (!options.credentials) options.credentials = "same-origin";
        return getToken().then(function (token) {
            if (token) {
                options.headers = Object.assign(
                    {},
                    headersToPlain(options.headers),
                    { "x-csrf-token": token }
                );
            }
            return window._originalFetch(url, options);
        });
    };

    /* Invalidate cached token after 30 minutes so it stays fresh */
    setInterval(function () { csrfToken = null; }, 1800000);

    document.addEventListener("DOMContentLoaded", function () { getToken(); });
})();
