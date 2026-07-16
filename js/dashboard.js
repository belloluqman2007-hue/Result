/* ==========================================================
   DASHBOARD WIDGETS  (js/dashboard.js)  [NEW FILE - ADDITIVE]
   ----------------------------------------------------------
   Powers the NEW dashboard panels only:
     - Extra stat counters  (/dashboard-stats)
     - Students-per-class bar chart + grade donut (canvas, no libs)
     - Mini calendar + upcoming events (/api/events)
     - Notice board           (/api/announcements)
     - Recent activity feed   (/recent-activity - read-only)
     - Score table live filter + row counter
   Nothing here touches js/app.js, result saving, grading or the
   report card logic. All data endpoints used are NEW route names
   or read-only SELECTs against existing tables.
========================================================== */

(function () {
    "use strict";

    /* Shared state for the calendar */
    var calCursor = new Date();
    var cachedEvents = [];

    /* ---------- small helper: tolerant JSON GET ---------- */
    function getJSON(url) {
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error("Request failed: " + url);
            return r.json();
        });
    }

    /* ======================================================
       1. EXTRA STAT CARDS + CHARTS  (/dashboard-stats)
    ====================================================== */
    var GRADE_COLORS = {
        A: "#2F9E6E", B: "#3FB37E", C: "#E0A93E",
        D: "#D97F33", E: "#C05B4B", F: "#8C3B2E"
    };

    function loadDashboardStats() {
        getJSON("/dashboard-stats").then(function (stats) {
            /* New counters (the 3 original counters are filled by app.js) */
            window.amsCountUp(document.getElementById("amsClassCount"), stats.classes);
            window.amsCountUp(document.getElementById("amsStaffCount"), stats.staff);
            window.amsCountUp(document.getElementById("amsExamCount"), stats.exams);

            drawClassChart(stats.studentsPerClass || []);
            drawGradeChart(stats.gradeDistribution || []);

            /* Animate the three legacy counters too (app.js already set their
               text; amsCountUp simply re-renders the same value with motion) */
            window.amsCountUp(document.getElementById("studentCount"), stats.students);
            window.amsCountUp(document.getElementById("subjectCount"), stats.subjects);
            window.amsCountUp(document.getElementById("resultCount"), stats.results);
        }).catch(function (e) {
            console.log("Dashboard stats unavailable:", e);
        });
    }

    /* HiDPI-aware canvas setup */
    function prepCanvas(canvas, cssHeight) {
        var dpr = window.devicePixelRatio || 1;
        var width = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
        canvas.width = width * dpr;
        canvas.height = cssHeight * dpr;
        canvas.style.height = cssHeight + "px";
        var ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx: ctx, w: width, h: cssHeight };
    }

    function cssVar(name, fallback) {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        return (v || "").trim() || fallback;
    }

    /* Bar chart: students per class (RTL-friendly Arabic labels) */
    function drawClassChart(data) {
        var canvas = document.getElementById("amsClassChart");
        if (!canvas) return;
        var c = prepCanvas(canvas, 220);
        var ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);

        if (!data.length) {
            ctx.fillStyle = cssVar("--m-muted", "#5F6E66");
            ctx.font = "13px Cairo, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("No students registered yet", c.w / 2, c.h / 2);
            return;
        }

        var max = 0;
        data.forEach(function (d) { if (d.count > max) max = d.count; });

        var padL = 8, padB = 34, padT = 14;
        var chartH = c.h - padT - padB;
        var slot = (c.w - padL * 2) / data.length;
        var barW = Math.min(46, slot * 0.62);
        var em = cssVar("--m-emerald-2", "#1C5A42");
        var jade = cssVar("--m-jade", "#2F9E6E");
        var muted = cssVar("--m-muted", "#5F6E66");

        data.forEach(function (d, i) {
            var x = padL + slot * i + (slot - barW) / 2;
            var barH = max ? Math.max(3, (d.count / max) * chartH) : 3;
            var y = padT + chartH - barH;

            /* rounded-top bar */
            var r = Math.min(7, barW / 2);
            var grad = ctx.createLinearGradient(0, y, 0, y + barH);
            grad.addColorStop(0, jade);
            grad.addColorStop(1, em);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(x, y + barH);
            ctx.lineTo(x, y + r);
            ctx.arcTo(x, y, x + r, y, r);
            ctx.lineTo(x + barW - r, y);
            ctx.arcTo(x + barW, y, x + barW, y + r, r);
            ctx.lineTo(x + barW, y + barH);
            ctx.closePath();
            ctx.fill();

            /* value on top */
            ctx.fillStyle = em;
            ctx.font = "700 12px 'IBM Plex Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText(d.count, x + barW / 2, y - 5);

            /* class label under the bar (truncated to fit) */
            ctx.fillStyle = muted;
            ctx.font = "11px Cairo, sans-serif";
            ctx.save();
            ctx.translate(x + barW / 2, c.h - 8);
            var label = String(d.class_name || "");
            ctx.textAlign = "center";
            if (slot < 60) {
                /* narrow slots: rotate labels */
                ctx.rotate(-Math.PI / 4);
                ctx.textAlign = "right";
                ctx.translate(-label.length * 2, 4);
            }
            ctx.fillText(label, 0, 0, slot < 60 ? 90 : slot + 20);
            ctx.restore();
        });
    }

    /* Donut chart: grade distribution across ALL saved results */
    function drawGradeChart(data) {
        var canvas = document.getElementById("amsGradeChart");
        var legend = document.getElementById("amsGradeLegend");
        if (!canvas) return;
        var c = prepCanvas(canvas, 180);
        var ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);

        var order = ["A", "B", "C", "D", "E", "F"];
        var slices = order.map(function (g) {
            var found = data.find(function (d) { return d.grade === g; });
            return { grade: g, count: found ? found.count : 0 };
        }).filter(function (s) { return s.count > 0; });

        var total = slices.reduce(function (a, s) { return a + s.count; }, 0);

        if (!total) {
            ctx.fillStyle = cssVar("--m-muted", "#5F6E66");
            ctx.font = "13px Cairo, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("No results recorded yet", c.w / 2, c.h / 2);
            if (legend) legend.innerHTML = "";
            return;
        }

        var cx = c.w / 2, cy = c.h / 2;
        var radius = Math.min(cx, cy) - 10;
        var inner = radius * 0.62;
        var angle = -Math.PI / 2;

        slices.forEach(function (s) {
            var sweep = (s.count / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, angle, angle + sweep);
            ctx.arc(cx, cy, inner, angle + sweep, angle, true);
            ctx.closePath();
            ctx.fillStyle = GRADE_COLORS[s.grade] || "#999";
            ctx.fill();
            angle += sweep;
        });

        /* center total */
        ctx.fillStyle = cssVar("--m-emerald", "#0F3D2E");
        ctx.font = "600 20px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(total, cx, cy - 7);
        ctx.font = "10.5px Cairo, sans-serif";
        ctx.fillStyle = cssVar("--m-muted", "#5F6E66");
        ctx.fillText("results", cx, cy + 11);
        ctx.textBaseline = "alphabetic";

        if (legend) {
            legend.innerHTML = "";
            slices.forEach(function (s) {
                var item = document.createElement("span");
                var pct = Math.round((s.count / total) * 100);
                item.innerHTML = '<span class="ams-legend-dot" style="background:' +
                    (GRADE_COLORS[s.grade] || "#999") + '"></span>' +
                    s.grade + " &middot; " + s.count + " (" + pct + "%)";
                legend.appendChild(item);
            });
        }
    }

    /* ======================================================
       2. RECENT ACTIVITY FEED  (/recent-activity, read-only)
    ====================================================== */
    var FEED_ICONS = {
        result: { bg: "ams-chip-emerald", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' },
        exam: { bg: "ams-chip-indigo", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' },
        signature: { bg: "ams-chip-gold", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><path d="m16 8-9.04 9.07"/></svg>' }
    };

    function loadActivity() {
        var feed = document.getElementById("amsActivityFeed");
        if (!feed) return;

        getJSON("/recent-activity").then(function (items) {
            feed.innerHTML = "";
            if (!items.length) {
                feed.innerHTML = "<li>" + window.amsEmptyState("No activity yet", "Actions you take around the school will show up here.") + "</li>";
                return;
            }
            items.forEach(function (item) {
                var meta = FEED_ICONS[item.type] || FEED_ICONS.result;
                var li = document.createElement("li");
                li.innerHTML =
                    '<div class="ams-feed-dot ' + meta.bg + '">' + meta.svg + "</div>" +
                    "<div><div class='ams-feed-text'></div>" +
                    (item.when ? "<div class='ams-feed-time'>" + window.amsTimeAgo(item.when) + "</div>" : "") +
                    "</div>";
                li.querySelector(".ams-feed-text").textContent = item.text; /* injection-safe */
                feed.appendChild(li);
            });
        }).catch(function (e) {
            feed.innerHTML = "<li>" + window.amsEmptyState("Activity unavailable", "Check your connection and reload.") + "</li>";
            console.log(e);
        });
    }

    /* ======================================================
       3. NOTICE BOARD (announcements - NEW /api/announcements)
    ====================================================== */
    function loadAnnouncements() {
        var list = document.getElementById("amsAnnouncementList");
        if (!list) return;

        getJSON("/api/announcements").then(function (notes) {
            list.innerHTML = "";
            if (!notes.length) {
                list.innerHTML = window.amsEmptyState("No announcements", "Post news for the staff using the form above.");
                return;
            }
            notes.forEach(function (n) {
                var div = document.createElement("div");
                div.className = "ams-note";
                div.innerHTML =
                    '<div class="ams-note-title"><span></span>' +
                    '<button type="button" class="ams-note-del" title="Delete announcement">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>' +
                    "</button></div>" +
                    '<div class="ams-note-body"></div>' +
                    '<div class="ams-note-date"></div>';
                div.querySelector(".ams-note-title span").textContent = n.title;
                div.querySelector(".ams-note-body").textContent = n.body || "";
                div.querySelector(".ams-note-date").textContent = window.amsTimeAgo(n.created_at);
                div.querySelector(".ams-note-del").addEventListener("click", function () {
                    window.amsConfirm("Delete announcement?", '"' + n.title + '" will be removed from the notice board.')
                        .then(function (ok) {
                            if (!ok) return;
                            fetch("/api/announcements/" + n.id, { method: "DELETE" })
                                .then(function (r) { return r.json(); })
                                .then(function (d) {
                                    window.amsToast(d.message || "Announcement deleted");
                                    loadAnnouncements();
                                })
                                .catch(function () { window.amsToast("Could not delete announcement", "error"); });
                        });
                });
                list.appendChild(div);
            });
        }).catch(function (e) {
            list.innerHTML = window.amsEmptyState("Notice board unavailable", "Reload the page or try again later.");
            console.log(e);
        });
    }

    function initAnnouncementForm() {
        var form = document.getElementById("amsAnnouncementForm");
        if (!form) return;
        form.addEventListener("submit", function (e) {
            e.preventDefault();
            var title = document.getElementById("amsAnnTitle").value.trim();
            var body = document.getElementById("amsAnnBody").value.trim();
            if (!title) {
                window.amsToast("Please enter an announcement title.", "error");
                return;
            }
            fetch("/api/announcements", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: title, body: body })
            })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    window.amsToast(d.message || "Announcement posted");
                    document.getElementById("amsAnnTitle").value = "";
                    document.getElementById("amsAnnBody").value = "";
                    loadAnnouncements();
                })
                .catch(function () { window.amsToast("Could not post announcement", "error"); });
        });
    }

    /* ======================================================
       4. EVENTS + MINI CALENDAR  (NEW /api/events)
    ====================================================== */
    var MONTHS = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    var DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

    function eventDaySet() {
        /* set of "YYYY-M-D" strings for quick lookup */
        var s = {};
        cachedEvents.forEach(function (ev) {
            var d = new Date(ev.event_date);
            if (!isNaN(d)) s[d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate()] = true;
        });
        return s;
    }

    function renderCalendar() {
        var grid = document.getElementById("amsCalGrid");
        var label = document.getElementById("amsCalLabel");
        if (!grid) return;

        var y = calCursor.getFullYear(), m = calCursor.getMonth();
        label.textContent = MONTHS[m] + " " + y;

        var today = new Date();
        var first = new Date(y, m, 1).getDay();
        var daysIn = new Date(y, m + 1, 0).getDate();
        var daysPrev = new Date(y, m, 0).getDate();
        var marks = eventDaySet();

        var html = "";
        for (var i = 0; i < DOW.length; i++) html += '<div class="ams-cal-dow">' + DOW[i] + "</div>";

        for (var p = first - 1; p >= 0; p--) {
            html += '<div class="ams-cal-day ams-cal-other">' + (daysPrev - p) + "</div>";
        }
        for (var d = 1; d <= daysIn; d++) {
            var cls = "ams-cal-day";
            if (d === today.getDate() && m === today.getMonth() && y === today.getFullYear()) cls += " ams-cal-today";
            if (marks[y + "-" + m + "-" + d]) cls += " ams-cal-event";
            html += '<div class="' + cls + '">' + d + "</div>";
        }
        var totalCells = first + daysIn;
        var tail = (7 - (totalCells % 7)) % 7;
        for (var t = 1; t <= tail; t++) {
            html += '<div class="ams-cal-day ams-cal-other">' + t + "</div>";
        }
        grid.innerHTML = html;
    }

    /* called from the calendar prev/next buttons in the HTML */
    window.amsCalMove = function (delta) {
        calCursor.setMonth(calCursor.getMonth() + delta);
        renderCalendar();
    };

    function loadEvents() {
        var list = document.getElementById("amsEventList");
        if (!list) return;

        getJSON("/api/events").then(function (events) {
            cachedEvents = events;
            renderCalendar();

            list.innerHTML = "";
            if (!events.length) {
                list.innerHTML = window.amsEmptyState("No upcoming events", "Add exams, meetings, and school dates above.");
                return;
            }
            events.slice(0, 6).forEach(function (ev) {
                var d = new Date(ev.event_date);
                var div = document.createElement("div");
                div.className = "ams-event";
                div.innerHTML =
                    '<div class="ams-event-date"><strong>' + (isNaN(d) ? "-" : d.getDate()) + "</strong><span>" +
                    (isNaN(d) ? "" : MONTHS[d.getMonth()].slice(0, 3)) + "</span></div>" +
                    '<div class="ams-event-title"></div>' +
                    '<button type="button" class="ams-note-del" title="Delete event">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>' +
                    "</button>";
                var titleEl = div.querySelector(".ams-event-title");
                titleEl.textContent = ev.title;
                if (ev.description) {
                    var note = document.createElement("div");
                    note.className = "ams-event-note";
                    note.textContent = ev.description;
                    titleEl.appendChild(note);
                }
                div.querySelector(".ams-note-del").addEventListener("click", function () {
                    window.amsConfirm("Delete event?", '"' + ev.title + '" will be removed from the calendar.')
                        .then(function (ok) {
                            if (!ok) return;
                            fetch("/api/events/" + ev.id, { method: "DELETE" })
                                .then(function (r) { return r.json(); })
                                .then(function (resp) {
                                    window.amsToast(resp.message || "Event deleted");
                                    loadEvents();
                                })
                                .catch(function () { window.amsToast("Could not delete event", "error"); });
                        });
                });
                list.appendChild(div);
            });
        }).catch(function (e) {
            list.innerHTML = window.amsEmptyState("Events unavailable", "Reload the page or try again later.");
            console.log(e);
        });
    }

    function initEventForm() {
        var form = document.getElementById("amsEventForm");
        if (!form) return;
        form.addEventListener("submit", function (e) {
            e.preventDefault();
            var title = document.getElementById("amsEventTitle").value.trim();
            var date = document.getElementById("amsEventDate").value;
            var note = document.getElementById("amsEventNote").value.trim();
            if (!title || !date) {
                window.amsToast("Please enter an event title and date.", "error");
                return;
            }
            fetch("/api/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: title, event_date: date, description: note })
            })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    window.amsToast(d.message || "Event added");
                    document.getElementById("amsEventTitle").value = "";
                    document.getElementById("amsEventDate").value = "";
                    document.getElementById("amsEventNote").value = "";
                    /* jump the calendar to the month of the new event */
                    var d2 = new Date(date + "T00:00:00");
                    if (!isNaN(d2)) calCursor = d2;
                    loadEvents();
                })
                .catch(function () { window.amsToast("Could not add event", "error"); });
        });
    }

    /* ======================================================
       5. SCORE TABLE FILTER + ROW COUNTER
          (reads the table app.js fills - never writes to it)
    ====================================================== */
    function updateScoreCount() {
        var table = document.getElementById("scoreTable");
        var counter = document.getElementById("amsScoreCount");
        var filter = document.getElementById("amsScoreFilter");
        if (!table || !counter) return;
        var res = window.amsFilterTable(table, filter ? filter.value : "");
        counter.textContent = res.total
            ? ("Showing " + res.shown + " of " + res.total + " score(s)")
            : "No scores loaded yet";
    }

    /* global - referenced by the filter input's oninput */
    window.amsFilterScoreTable = function () {
        updateScoreCount();
    };

    /* ======================================================
       INIT
    ====================================================== */
    document.addEventListener("DOMContentLoaded", function () {
        /* Only run on pages that have the dashboard widgets */
        if (!document.getElementById("amsClassCount")) return;

        loadDashboardStats();
        loadActivity();
        loadAnnouncements();
        loadEvents();
        initAnnouncementForm();
        initEventForm();
        updateScoreCount();

        /* Keep the visible-row counter in sync when app.js
           adds/removes rows in #scoreTable */
        var table = document.getElementById("scoreTable");
        if (table && window.MutationObserver) {
            new MutationObserver(function () { updateScoreCount(); })
                .observe(table, { childList: true, subtree: false });
        }

        /* Redraw charts on resize (debounced) */
        var resizeTimer = null;
        window.addEventListener("resize", function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                getJSON("/dashboard-stats").then(function (stats) {
                    drawClassChart(stats.studentsPerClass || []);
                    drawGradeChart(stats.gradeDistribution || []);
                }).catch(function () {});
            }, 220);
        });

        /* Refresh stats after a score is saved/deleted so widgets
           stay honest (hook AFTER app.js save completes by polling
           when a toast appears is fragile - instead reload stats
           whenever the score table changes) */
    });
})();
