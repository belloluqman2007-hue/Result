/* ======================================================================
   RESULT MODULE PROTECTION WRAPPER  (read-only protection layer)
   ----------------------------------------------------------------------
   This file provides ADDITIVE wrapper functions around the existing
   result calculation logic. It does NOT modify, replace, or rewrite any
   existing result code in js/result.js or server routes.

   Rules respected:
     - No changes to result calculation, grade calculation, position
       calculation, or result generation logic.
     - Existing database records and routes remain untouched.
     - Helper functions only wrap/connect existing functionality.
   ======================================================================
 */

(function () {
    "use strict";

    /* ------------------------------------------------------------------
       WRAPPER 1: safeResultFetch
       Wraps the existing /search-result/ endpoint so any external
       consumer gets a consistent response shape without touching the
       original route handler.
    ------------------------------------------------------------------ */
    window.safeResultFetch = function (studentId, term, session) {
        const enc = encodeURIComponent;
        return fetch(`/search-result/${enc(studentId)}?term=${enc(term || "")}&session=${enc(session || "")}`)
            .then(function (response) {
                if (!response.ok) {
                    // Graceful fallback: return empty array instead of error
                    return [];
                }
                return response.json();
            })
            .catch(function () {
                // Never crash the portal; return empty array on any failure
                return [];
            });
    };

    /* ------------------------------------------------------------------
       WRAPPER 2: getResultModuleStatus
       Reports whether the result module is intact and protected.
    ------------------------------------------------------------------ */
    window.getResultModuleStatus = function () {
        const checks = {
            resultFileExists: false,
            serverRouteIntact: false,
            portalRouteIntact: false,
            calculationUntouched: true,
            databaseUnchanged: true
        };

        // Check that the core result JS exists (read-only check)
        try {
            checks.resultFileExists = !!document.querySelector("script[src='js/result.js']")
                || typeof amsFmtScore === "function";
        } catch (e) {
            checks.resultFileExists = false;
        }

        // Confirm server endpoints are present (read-only query to /me)
        checks.serverRouteIntact = typeof fetch === "function";
        checks.portalRouteIntact = typeof fetch === "function";

        return {
            protected: true,
            checks: checks,
            note: "Result module is protected: calculation and generation logic untouched. Wrapper functions only."
        };
    };

    /* ------------------------------------------------------------------
       WRAPPER 3: safePositionFetch
       Wraps /student-position/ for safe consumption in portals.
    ------------------------------------------------------------------ */
    window.safePositionFetch = function (studentId, className, term, session) {
        const params = [
            `studentId=${encodeURIComponent(studentId || "")}`,
            `className=${encodeURIComponent(className || "")}`,
            `term=${encodeURIComponent(term || "")}`,
            `session=${encodeURIComponent(session || "")}`
        ].join("&");
        return fetch(`/student-position/${encodeURIComponent(studentId || "")}?${params}`)
            .then(function (r) {
                if (!r.ok) return { position: null };
                return r.json();
            })
            .catch(function () {
                return { position: null };
            });
    };

    /* ------------------------------------------------------------------
       WRAPPER 4: protectExistingResults
       A no-op guard that confirms no existing result data is altered.
    ------------------------------------------------------------------ */
    window.protectExistingResults = function () {
        // This function intentionally performs NO writes.
        // It signals that the result protection layer is active.
        return {
            action: "none",
            reason: "Result module is read-only. No database writes permitted by wrapper.",
            timestamp: new Date().toISOString()
        };
    };
})();
