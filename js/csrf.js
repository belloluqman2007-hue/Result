/**
 * csrf.js — Global CSRF token auto-injector
 * Include this as the FIRST script on every HTML page.
 * Patches window.fetch so every POST/PUT/DELETE/PATCH automatically
 * includes x-csrf-token.
 *
 * BUG FIX: Object.assign({}, Headers_instance) does NOT copy Headers
 * entries — they are not enumerable own properties. This silently
 * dropped Content-Type on any call that passed a Headers object,
 * causing the server to receive an empty body and reject create-user
 * requests with "Username and password required."
 * Fixed with headersToPlain() which uses Headers.prototype.forEach().
 */
(function () {
    var csrfToken = null;
    var fetchingToken = null;

    function getToken() {
        if (csrfToken) return Promise.resolve(csrfToken);
        if (fetchingToken) return fetchingToken;
        fetchingToken = window._originalFetch("/api/csrf-token")
            .then(function (r) { return r.json(); })
            .then(function (d) { csrfToken = d.csrfToken; fetchingToken = null; return csrfToken; })
            .catch(function () { fetchingToken = null; return null; });
        return fetchingToken;
    }

    /* Convert any header representation to a plain object safely */
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
        if (!needsCsrf || exempt.some(function (e) { return path === e || path.startsWith(e + "?"); })) {
            return window._originalFetch(url, options);
        }
        return getToken().then(function (token) {
            if (token) {
                options.headers = Object.assign({}, headersToPlain(options.headers), { "x-csrf-token": token });
            }
            return window._originalFetch(url, options);
        });
    };

    document.addEventListener("DOMContentLoaded", function () { getToken(); });
})();
