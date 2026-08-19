/* ==========================================================
   SHARED UI UTILITIES  (js/ui.js)  [NEW FILE - ADDITIVE]
   ----------------------------------------------------------
   Modern UX primitives used across the app:
     1. Toast notification system (amsToast)
     2. Progressive upgrade: window.alert -> toast (non-blocking)
        NOTE: confirm() and prompt() are left NATIVE on purpose,
        because existing safety flows (wiping data, deleting a
        student's results) depend on their typed-confirmation
        return values. Nothing existing is changed behaviourally.
     3. Promise-based confirmation modal (amsConfirm) - used by
        NEW features only (announcements, events, directory).
     4. Dark mode (localStorage) - scoped to modern UI chrome,
        report card is forced light in modern-ui.css.
     5. Helpers: CSV export, table filtering, count-up numbers,
        relative time, empty states.
   Everything here is additive; no existing function is renamed
   or redefined (except the visual-only alert shim below).
========================================================== */

(function () {
    "use strict";

    /* ---------- Dark mode: apply BEFORE first paint ---------- */
    try {
        if (localStorage.getItem("ams-theme") === "dark") {
            document.documentElement.setAttribute("data-theme", "dark");
        }
    } catch (e) { /* private mode etc. - ignore */ }

    /* ---------- SVG icon set (inline strings, reused by toasts) ---------- */
    var ICONS = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="ams-toast-icon"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="ams-toast-icon"><circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><circle cx="12" cy="16.5" r=".6" fill="currentColor"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="ams-toast-icon"><circle cx="12" cy="12" r="10"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6" fill="currentColor"/></svg>',
    };

    /* ---------- 1. Toast system ---------- */
    function ensureToastRoot() {
        var root = document.getElementById("ams-toast-root");
        if (!root) {
            root = document.createElement("div");
            root.id = "ams-toast-root";
            document.body.appendChild(root);
        }
        return root;
    }

    /* amsToast(message, type) - type: "success" | "error" | "info" */
    window.amsToast = function (message, type, durationMs) {
        type = type || "success";
        var root = ensureToastRoot();
        var el = document.createElement("div");
        el.className = "ams-toast ams-toast-" + type;
        el.setAttribute("role", "status");

        var icon = document.createElement("span");
        icon.innerHTML = ICONS[type] || ICONS.info;
        el.appendChild(icon.firstChild || icon);

        var text = document.createElement("div");
        text.textContent = String(message); /* textContent = no HTML injection */
        el.appendChild(text);

        root.appendChild(el);

        var ttl = durationMs || (type === "error" ? 5200 : 3400);
        setTimeout(function () {
            el.classList.add("ams-toast-leaving");
            setTimeout(function () { el.remove(); }, 300);
        }, ttl);
    };

    /* ---------- 2. Visual-only alert() upgrade ----------
       Every existing page calls alert() purely for notifications.
       We keep the SAME call sites untouched and simply render the
       message as a modern toast instead of a blocking native box.
       Long multi-line safety messages (delete/wipe confirmations)
       still use native confirm()/prompt() which are NOT shimmed. */
    var nativeAlert = window.alert.bind(window);
    window.alert = function (message) {
        try {
            var msg = String(message == null ? "" : message);
            var type = "success";
            var lower = msg.toLowerCase();
            if (/error|failed|invalid|cannot|did not match|exceed|must|required|missing|not found|something went wrong/i.test(lower)) {
                type = "error";
            } else if (/please|check|make sure/i.test(lower)) {
                type = "info";
            }
            window.amsToast(msg, type);
        } catch (e) {
            nativeAlert(message); /* absolute fallback */
        }
    };

    /* ---------- 3. Promise-based confirmation modal (NEW features) ---------- */
    /* Usage: amsConfirm("Delete note?", "This cannot be undone.").then(ok => {...}) */
    window.amsConfirm = function (title, message, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var overlay = document.createElement("div");
            overlay.className = "ams-modal-overlay";

            var modal = document.createElement("div");
            modal.className = "ams-modal";

            var h = document.createElement("h3");
            h.textContent = title;
            modal.appendChild(h);

            var p = document.createElement("p");
            p.textContent = message;
            modal.appendChild(p);

            var actions = document.createElement("div");
            actions.className = "ams-modal-actions";

            var cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.className = "m-btn-ghost";
            cancelBtn.textContent = opts.cancelText || "Cancel";

            var okBtn = document.createElement("button");
            okBtn.type = "button";
            if (opts.danger !== false) okBtn.className = "m-btn-danger";
            okBtn.textContent = opts.confirmText || "Confirm";

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            modal.appendChild(actions);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            function close(result) {
                overlay.remove();
                document.removeEventListener("keydown", onKey);
                resolve(result);
            }
            function onKey(e) {
                if (e.key === "Escape") close(false);
            }
            cancelBtn.addEventListener("click", function () { close(false); });
            okBtn.addEventListener("click", function () { close(true); });
            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) close(false);
            });
            document.addEventListener("keydown", onKey);
            okBtn.focus();
        });
    };

    /* ---------- 4. Dark mode toggle (dashboard button calls this) ---------- */
    window.amsToggleTheme = function () {
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";
        if (isDark) {
            document.documentElement.removeAttribute("data-theme");
            try { localStorage.setItem("ams-theme", "light"); } catch (e) {}
        } else {
            document.documentElement.setAttribute("data-theme", "dark");
            try { localStorage.setItem("ams-theme", "dark"); } catch (e) {}
        }
        window.amsToast(isDark ? "Light mode enabled" : "Dark mode enabled", "info", 1800);
    };

    /* ---------- 5a. Export any table to Excel-compatible CSV ---------- */
    window.amsExportTableCSV = function (table, filename) {
        if (!table) return;
        var rows = [];
        var trs = table.querySelectorAll("tr");
        for (var i = 0; i < trs.length; i++) {
            /* Only export rows that are currently visible (respects filters) */
            if (trs[i].style.display === "none") continue;
            var cells = trs[i].querySelectorAll("th,td");
            var row = [];
            for (var j = 0; j < cells.length; j++) {
                var text = cells[j].textContent.replace(/\s+/g, " ").trim();
                /* Skip pure action-button columns (Edit/Delete/Action) */
                if (/^(Edit|Delete|Remove|Action)$/i.test(text)) text = "";
                row.push('"' + text.replace(/"/g, '""') + '"');
            }
            rows.push(row.join(","));
        }
        var csv = "﻿" + rows.join("\r\n"); /* BOM so Excel reads Arabic correctly */
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename || "export.csv";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            URL.revokeObjectURL(a.href);
            a.remove();
        }, 100);
        window.amsToast("Spreadsheet downloaded (" + (rows.length ? rows.length - 1 : 0) + " rows)");
    };

    /* Download an array-of-objects as CSV (used by Students Directory) */
    window.amsExportObjectsCSV = function (items, columns, filename) {
        if (!items || !items.length) {
            window.amsToast("There is no data to export.", "info");
            return;
        }
        var header = columns.map(function (c) { return '"' + c.label + '"'; }).join(",");
        var lines = items.map(function (item) {
            return columns.map(function (c) {
                var v = item[c.key] == null ? "" : String(item[c.key]);
                return '"' + v.replace(/"/g, '""') + '"';
            }).join(",");
        });
        var csv = "﻿" + header + "\r\n" + lines.join("\r\n");
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename || "export.csv";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
        window.amsToast(items.length + " record(s) exported to Excel/CSV");
    };

    /* ---------- 5b. Live client-side table filter ---------- */
    window.amsFilterTable = function (table, query) {
        if (!table) return { shown: 0, total: 0 };
        var q = (query || "").trim().toLowerCase();
        var shown = 0, total = 0;
        var trs = table.querySelectorAll("tr");
        for (var i = 0; i < trs.length; i++) {
            if (trs[i].querySelector("th")) continue; /* keep header visible */
            total++;
            if (!q) {
                trs[i].style.display = "";
                shown++;
                continue;
            }
            var text = trs[i].textContent.toLowerCase();
            var match = text.indexOf(q) !== -1;
            trs[i].style.display = match ? "" : "none";
            if (match) shown++;
        }
        return { shown: shown, total: total };
    };

    /* ---------- 5c. Animated count-up for stat numbers ---------- */
    window.amsCountUp = function (el, target, durationMs) {
        if (!el) return;
        target = Number(target) || 0;
        var duration = durationMs || 900;
        var start = null;
        function step(ts) {
            if (!start) start = ts;
            var progress = Math.min((ts - start) / duration, 1);
            var eased = 1 - Math.pow(1 - progress, 3); /* easeOutCubic */
            el.textContent = Math.round(target * eased);
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    };

    /* ---------- 5d. Human relative time ("2 hours ago") ---------- */
    window.amsTimeAgo = function (dateLike) {
        if (!dateLike) return "";
        var d = new Date(dateLike);
        if (isNaN(d)) return "";
        var diff = (Date.now() - d.getTime()) / 1000;
        if (diff < 60) return "just now";
        if (diff < 3600) return Math.floor(diff / 60) + " min ago";
        if (diff < 86400) return Math.floor(diff / 3600) + " hr ago";
        if (diff < 86400 * 30) return Math.floor(diff / 86400) + " day(s) ago";
        return d.toLocaleDateString();
    };

    /* ---------- 5e. Empty state block ---------- */
    window.amsEmptyState = function (title, subtitle) {
        return '<div class="ams-empty">' +
            '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
            '<rect x="10" y="14" width="44" height="38" rx="4"/>' +
            '<path d="M10 24h44"/><circle cx="20" cy="19.5" r="1.4" fill="currentColor"/>' +
            '<circle cx="27" cy="19.5" r="1.4" fill="currentColor"/>' +
            '<path d="M24 38c2 2.4 5 3.6 8 3.6s6-1.2 8-3.6"/></svg>' +
            "<h4>" + (title || "Nothing here yet") + "</h4>" +
            "<p>" + (subtitle || "") + "</p>" +
            "</div>";
    };

    /* ---------- 6. Topbar live clock (if #amsClock exists) ---------- */
    function startClock() {
        var clock = document.getElementById("amsClock");
        if (!clock) return;
        function tick() {
            var now = new Date();
            var time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
            var date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
            clock.innerHTML = "<strong>" + time + "</strong><small>" + date + "</small>";
        }
        tick();
        setInterval(tick, 15000);
    }

    /* ---------- 7. Mobile sidebar toggle + scrim ---------- */
    function initShell() {
        var ham = document.getElementById("amsMenuToggle");
        if (ham) {
            ham.addEventListener("click", function () {
                document.documentElement.classList.toggle("ams-nav-open");
            });
        }
        var scrim = document.querySelector(".ams-scrim");
        if (scrim) {
            scrim.addEventListener("click", function () {
                document.documentElement.classList.remove("ams-nav-open");
            });
        }
        /* Close the drawer after picking a link on mobile */
        var sideLinks = document.querySelectorAll(".ams-side-nav a");
        for (var i = 0; i < sideLinks.length; i++) {
            sideLinks[i].addEventListener("click", function () {
                document.documentElement.classList.remove("ams-nav-open");
            });
        }
    }

    /* ---------- 8. Sidebar logout (same API as legacy logout()) ----------
       Some pages (students.html) don't load app.js, so we expose a
       fallback logout here ONLY if app.js didn't define one. */
    if (typeof window.logout !== "function") {
        window.logout = function () {
            fetch("/logout", { method: "POST" })
                .then(function () { window.location.href = "login.html"; })
                .catch(function (e) { console.log(e); });
        };
    }

    /* ---------- 9. Inject a dark-mode toggle on every staff page ----------
       teacher-dashboard already has one in the topbar. Other admin pages
       get a matching button in the header (or a floating one). Portal /
       public / login pages are skipped. */
    function makeThemeBtn() {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ams-icon-btn";
        btn.id = "amsThemeToggle";
        btn.title = "Toggle dark mode";
        btn.setAttribute("aria-label", "Toggle dark mode");
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
        btn.addEventListener("click", function () { window.amsToggleTheme(); });
        return btn;
    }

    function injectDarkToggle() {
        if (document.getElementById("amsThemeToggle")) return;
        if (document.querySelector("[onclick*=\"amsToggleTheme\"]")) return;
        var page = (location.pathname.split("/").pop() || "").toLowerCase();
        if (document.body && document.body.classList.contains("pt-body")) return;
        if (/^(login\.html|portal-login\.html|portal\.html|index\.html|offline\.html|)$/.test(page)) return;
        if (!document.getElementById("amsThemeInjectCss")) {
            var st = document.createElement("style");
            st.id = "amsThemeInjectCss";
            st.textContent = ".ams-icon-btn{background:var(--m-surface,#fff);border:1.5px solid var(--m-border,#D9E8E0);color:var(--m-emerald,#0F3D2E);width:40px;height:40px;border-radius:12px;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}.ams-icon-btn svg{width:19px;height:19px;}.ams-theme-float{position:fixed;top:14px;right:14px;z-index:80;}";
            document.head.appendChild(st);
        }

        var right = document.querySelector(".ams-topbar-right");
        if (right) {
            right.insertBefore(makeThemeBtn(), right.firstChild);
            return;
        }
        var head = document.querySelector(".mng-head");
        if (head) {
            var btn = makeThemeBtn();
            btn.style.marginLeft = "auto";
            head.appendChild(btn);
            return;
        }
        var header = document.querySelector("header");
        if (header && header.querySelector("a[href*=\"teacher-dashboard\"]")) {
            var wrap = document.createElement("span");
            wrap.style.cssText = "margin-left:auto; display:inline-flex;";
            wrap.appendChild(makeThemeBtn());
            header.appendChild(wrap);
            return;
        }
        var floatBtn = makeThemeBtn();
        floatBtn.classList.add("ams-theme-float");
        document.body.appendChild(floatBtn);
    }

    document.addEventListener("DOMContentLoaded", function () {
        startClock();
        initShell();
        injectDarkToggle();
    });
})();
