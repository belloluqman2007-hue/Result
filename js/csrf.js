/**
 * csrf.js — Global CSRF token auto-injector
 * Include this as the FIRST script on every HTML page.
 * It fetches a CSRF token once, caches it, and patches window.fetch
 * so every POST/PUT/DELETE/PATCH automatically includes x-csrf-token.
 * No other JS file needs to change.
 */
(function () {
    let csrfToken = null;
    let fetchingToken = null;

    function getToken() {
        if (csrfToken) return Promise.resolve(csrfToken);
        if (fetchingToken) return fetchingToken;
        fetchingToken = window._originalFetch("/api/csrf-token")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                csrfToken = data.csrfToken;
                fetchingToken = null;
                return csrfToken;
            })
            .catch(function () {
                fetchingToken = null;
                return null;
            });
        return fetchingToken;
    }

    // Save the original fetch before patching
    window._originalFetch = window.fetch.bind(window);

    // Patch global fetch
    window.fetch = function (url, options) {
        options = options || {};
        var method = (options.method || "GET").toUpperCase();
        var needsCsrf = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

        // Skip CSRF for login/logout/portal-login (they're exempt on the server too)
        var path = typeof url === "string" ? url : (url.url || "");
        var exempt = ["/login", "/portal-login", "/logout", "/api/csrf-token"];
        if (!needsCsrf || exempt.some(function (e) { return path === e || path.startsWith(e + "?"); })) {
            return window._originalFetch(url, options);
        }

        return getToken().then(function (token) {
            if (token) {
                options.headers = Object.assign({}, options.headers, { "x-csrf-token": token });
            }
            return window._originalFetch(url, options);
        });
    };

    // Refresh token after login (session changes invalidate old token)
    document.addEventListener("DOMContentLoaded", function () {
        // Pre-warm the token so first action is instant
        getToken();
    });
})();
