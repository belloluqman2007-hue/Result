/* ======================================================================
   STUDENT PORTAL RESULTS FIX  (additive reliability layer)
   ----------------------------------------------------------------------
   This file provides ADDITIVE fixes for the Student Portal results
   display without changing any existing result calculation logic.

   What it fixes:
     - Adds graceful fallbacks when results are not yet published.
     - Ensures session/term parameters are correctly passed.
     - Improves error messages so parents understand what's happening.
     - Keeps all existing /search-result/ routes untouched.

   Protection rules:
     - Does NOT modify result calculation, grade, or position logic.
     - Does NOT alter any database queries in server.js result routes.
     - Only adds wrapper/helper behavior in the portal frontend.
   ======================================================================
 */

(function () {
    "use strict";

    /* ------------------------------------------------------------------
       FIX 1: Enhanced published-terms loader with clear status
    ------------------------------------------------------------------ */
    window.enhanceLoadPublished = function () {
        const box = document.getElementById("ptTerms");
        if (!box) return;

        // If the box is empty or shows the default message, refresh it
        if (!box.innerHTML.trim() || box.querySelector(".pt-empty")) {
            fetch("/portal/published-terms")
                .then(function (r) {
                    if (!r.ok) {
                        throw new Error("Server returned status " + r.status);
                    }
                    return r.json();
                })
                .then(function (rows) {
                    if (!Array.isArray(rows) || !rows.length) {
                        box.innerHTML = '<div class="pt-empty"><span class="big">&#128197;</span>\n' +
                            '<b>No published results yet.</b><br>\n' +
                            'The school publishes results for each term after the exam period. ' +
                            'Please check back later — when results are ready, they will appear here automatically.</div>';
                        return;
                    }

                    // Clear and build the published terms list
                    box.innerHTML = "";
                    rows.forEach(function (row) {
                        var line = document.createElement("div");
                        line.className = "pt-pub-row";

                        var label = document.createElement("b");
                        label.textContent = row.term + " - " + row.session;
                        line.appendChild(label);

                        var badge = document.createElement("span");
                        badge.className = "pt-pub-badge";
                        badge.textContent = "Published";
                        line.appendChild(badge);

                        var btn = document.createElement("button");
                        btn.className = "mg-btn";
                        btn.type = "button";
                        btn.textContent = "\u{1F4C4} View Report Sheet";
                        btn.addEventListener("click", function () {
                            if (typeof openReport === "function") {
                                openReport(row.term, row.session, btn);
                            } else {
                                alert("Report viewer is loading. Please try the button again in a moment.");
                            }
                        });
                        line.appendChild(btn);
                        box.appendChild(line);
                    });
                })
                .catch(function (err) {
                    console.log("Portal results refresh error:", err);
                    if (!box.querySelector(".pt-empty")) {
                        box.innerHTML = '<div class="pt-empty">Could not load results at the moment. Please refresh the page or try again shortly.</div>';
                    }
                });
        }
    };

    /* ------------------------------------------------------------------
       FIX 2: Robust openReport with pre-flight checks
    ------------------------------------------------------------------ */
    window.safeOpenReport = function (term, session, btn) {
        // Ensure the student info is available
        if (typeof student === "undefined" || !student || !student.student_id) {
            if (window.amsToast) {
                window.amsToast("Please log in again to view your results.", "error", 5000);
            } else {
                alert("Your session has expired. Please log in again to view results.");
            }
            return;
        }

        // Validate parameters
        if (!term || !session) {
            if (window.amsToast) {
                window.amsToast("Term or session is missing. Please refresh and try again.", "info", 4000);
            } else {
                alert("Please select a published term and session first.");
            }
            return;
        }

        // Call the original openReport (kept untouched)
        if (typeof openReport === "function") {
            openReport(term, session, btn);
        } else {
            alert("Report viewer is not ready. Please refresh the page.");
        }
    };

    /* ------------------------------------------------------------------
       FIX 3: Auto-refresh when the portal page loads or becomes visible
    ------------------------------------------------------------------ */
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden && document.querySelector(".pt-view[data-view='results']\u002ept-view-on")) {
            // Page became visible while on Results view - refresh quietly
            setTimeout(function () {
                if (typeof enhanceLoadPublished === "function") {
                    enhanceLoadPublished();
                }
            }, 800);
        }
    });

    /* ------------------------------------------------------------------
       FIX 4: Boot the enhancement (only adds; does not replace anything)
    ------------------------------------------------------------------ */
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            setTimeout(function () {
                if (typeof enhanceLoadPublished === "function") {
                    enhanceLoadPublished();
                }
            }, 500);
        });
    } else {
        setTimeout(function () {
            if (typeof enhanceLoadPublished === "function") {
                enhanceLoadPublished();
            }
        }, 500);
    }
})();
