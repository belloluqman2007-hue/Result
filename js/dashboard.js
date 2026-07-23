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
                // NEW (pack 22): audience badge (+ event badge/date) and an
                // EDIT button beside the delete one - full control after
                // posting, exactly as the owner asked.
                var AUD_LABEL = { teacher: "Teachers", student: "Students", parent: "Parents", general: "Everyone" };
                var badges = '<span class="ams-note-badge">' + (AUD_LABEL[n.audience] || "Everyone") + "</span>" +
                    (n.kind === "event" ? '<span class="ams-note-badge b-event">Event' + (n.event_date ? " - " + String(n.event_date).slice(0, 10) : "") + "</span>" : "");
                div.innerHTML =
                    '<div class="ams-note-title"><span></span>' + badges +
                    '<button type="button" class="ams-note-edit" title="Edit announcement">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>' +
                    "</button>" +
                    '<button type="button" class="ams-note-del" title="Delete announcement">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>' +
                    "</button></div>" +
                    '<div class="ams-note-body"></div>' +
                    '<div class="ams-note-date"></div>';
                div.querySelector(".ams-note-title span").textContent = n.title;
                div.querySelector(".ams-note-body").textContent = n.body || "";
                div.querySelector(".ams-note-date").textContent = window.amsTimeAgo(n.created_at);
                div.querySelector(".ams-note-edit").addEventListener("click", function () {
                    document.getElementById("amsAnnTitle").value = n.title;
                    document.getElementById("amsAnnBody").value = n.body || "";
                    document.getElementById("amsAnnAudience").value = n.audience || "general";
                    document.getElementById("amsAnnKind").value = n.kind || "announcement";
                    document.getElementById("amsAnnKind").dispatchEvent(new Event("change"));
                    document.getElementById("amsAnnDate").value = n.event_date ? String(n.event_date).slice(0, 10) : "";
                    document.getElementById("amsAnnEditId").value = n.id;
                    document.getElementById("amsAnnSubmitBtn").textContent = "Save Changes";
                    document.getElementById("amsAnnCancelEdit").style.display = "inline-block";
                    document.getElementById("amsAnnouncementForm").scrollIntoView({ behavior: "smooth", block: "center" });
                });
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

        /* NEW (pack 22): event date shows only for the Event kind; the form
           also doubles as an EDITOR (PUT) - Cancel editing restores it. */
        var kindSel = document.getElementById("amsAnnKind");
        var dateWrap = document.getElementById("amsAnnDateWrap");
        function syncKindUI() { dateWrap.style.display = kindSel.value === "event" ? "flex" : "none"; }
        kindSel.addEventListener("change", syncKindUI);
        syncKindUI();

        function resetForm() {
            document.getElementById("amsAnnTitle").value = "";
            document.getElementById("amsAnnBody").value = "";
            document.getElementById("amsAnnAudience").value = "general";
            kindSel.value = "announcement";
            syncKindUI();
            document.getElementById("amsAnnDate").value = "";
            document.getElementById("amsAnnEditId").value = "";
            document.getElementById("amsAnnSubmitBtn").textContent = "Post Announcement";
            document.getElementById("amsAnnCancelEdit").style.display = "none";
        }
        document.getElementById("amsAnnCancelEdit").addEventListener("click", resetForm);

        form.addEventListener("submit", function (e) {
            e.preventDefault();
            var title = document.getElementById("amsAnnTitle").value.trim();
            var body = document.getElementById("amsAnnBody").value.trim();
            var editId = document.getElementById("amsAnnEditId").value;
            if (!title) {
                window.amsToast("Please enter an announcement title.", "error");
                return;
            }
            var payload = {
                title: title,
                body: body,
                audience: document.getElementById("amsAnnAudience").value,
                kind: kindSel.value,
                event_date: document.getElementById("amsAnnDate").value
            };
            fetch(editId ? "/api/announcements/" + editId : "/api/announcements", {
                method: editId ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    window.amsToast(d.message || (editId ? "Announcement updated" : "Announcement posted"), d.message && /required|date/i.test(d.message) ? "error" : "success");
                    if (!/required|warming|error|Could not/i.test(d.message || "")) {
                        resetForm();
                        loadAnnouncements();
                        // an event announcement also landed in Upcoming Events
                        if (payload.kind === "event" && typeof loadEvents === "function") loadEvents();
                    }
                })
                .catch(function () { window.amsToast("Could not save announcement", "error"); });
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
       NEW (pack 23 - owner requests): MESSAGES (parent <-> teacher /
       administration), NOTIFICATIONS bell badge, STAFF SETTINGS
       (change own password). All new routes; nothing existing touched.
    ====================================================== */
    function amsEsc(v) {
        return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function amsRefreshMsgBadge() {
        getJSON("/api/messages/unread").then(function (d) {
            var c = d && d.count ? d.count : 0;
            var badge = document.getElementById("amsMsgCount");
            var chip = document.getElementById("amsMsgUnreadChip");
            if (badge) {
                badge.style.display = c > 0 ? "inline-block" : "none";
                badge.textContent = c > 9 ? "9+" : String(c);
            }
            if (chip) {
                chip.style.display = c > 0 ? "inline-block" : "none";
                chip.textContent = c + " new";
            }
            // NEW (pack 24): the same count also lights the sidebar Chat link.
            var side = document.getElementById("amsSideChatBadge");
            if (side) {
                side.style.display = c > 0 ? "inline-block" : "none";
                side.textContent = c > 9 ? "9+" : String(c);
            }
            // NEW (pack 25): the sidebar Notifications link shows it too.
            var sideNotif = document.getElementById("amsSideNotifBadge");
            if (sideNotif) {
                sideNotif.style.display = c > 0 ? "inline-block" : "none";
                sideNotif.textContent = c > 9 ? "9+" : String(c);
            }
        }).catch(function () {});
    }

    function amsLoadMessages() {
        var box = document.getElementById("amsMsgList");
        if (!box) return;
        getJSON("/api/messages").then(function (rows) {
            rows = Array.isArray(rows) ? rows : [];
            if (!rows.length) {
                box.innerHTML = '<div class="ams-empty">No messages yet. Parents write from the Student/Parent portal - they land here.</div>';
                amsRefreshMsgBadge();
                return;
            }
            box.innerHTML = rows.map(function (m) {
                var fromParent = m.sender_type === "portal";
                var sid = fromParent ? m.sender_ref : m.recipient_ref;
                var who = fromParent ? (m.sender_name || sid) : (m.sender_name || "Staff");
                var when = String(m.created_at || "").replace("T", " ").slice(0, 16);
                var unread = fromParent && !m.read_at;
                return '<div class="ams-msg-item" data-sid="' + amsEsc(sid) + '" style="cursor:pointer; padding:8px 10px; margin:6px 0; border-radius:12px; ' +
                    (fromParent
                        ? "background:#eef4ef; border:1px solid " + (unread ? "#2F9E6E" : "#d7e0da") + ";"
                        : "background:#f7f4ea; border:1px solid #e6ddc4;") + '">' +
                    '<div style="font-size:11px; font-weight:700; color:#5B6B62;">' +
                        (fromParent ? "&#128105;&#8205;&#128103;&#8205;&#128102; " : "&#127979; ") + amsEsc(who) +
                        (m.recipient_class ? ' <span style="font-weight:400;">· class: ' + amsEsc(m.recipient_class) + "</span>" : "") +
                        ' <span style="float:right; font-weight:400;">' + amsEsc(when) + "</span>" +
                        (unread ? ' <span style="color:#C0392B;">● NEW</span>' : "") +
                    "</div>" +
                    '<div style="font-size:13px; line-height:1.45; white-space:pre-wrap;">' + amsEsc(m.body) + "</div>" +
                    (fromParent ? '<div style="font-size:11px; color:#14532d; margin-top:2px;">Tap to reply to ' + amsEsc(sid) + "</div>" : "") +
                "</div>";
            }).join("");
            Array.from(box.querySelectorAll(".ams-msg-item")).forEach(function (el) {
                el.addEventListener("click", function () {
                    var input = document.getElementById("amsMsgStudentId");
                    if (input) {
                        input.value = el.getAttribute("data-sid") || "";
                        var body = document.getElementById("amsMsgBody");
                        var info = document.getElementById("amsMsgReplyInfo");
                        if (info) info.textContent = "Replying to " + input.value + " - type below and press Send.";
                        if (body) body.focus();
                    }
                });
            });
            // show = read -> then clear the bell
            fetch("/api/messages/read", { method: "POST" })
                .then(function () { amsRefreshMsgBadge(); })
                .catch(function () {});
        }).catch(function () {
            box.innerHTML = '<div class="ams-empty">Could not load messages.</div>';
        });
    }

    function amsInitMessaging() {
        var sendBtn = document.getElementById("amsMsgSend");
        if (!sendBtn) return;
        sendBtn.addEventListener("click", function () {
            var sidEl = document.getElementById("amsMsgStudentId");
            var bodyEl = document.getElementById("amsMsgBody");
            var info = document.getElementById("amsMsgReplyInfo");
            var sid = (sidEl.value || "").trim();
            var body = (bodyEl.value || "").trim();
            if (!sid || !body) {
                if (info) info.textContent = "Pick the student (tap a parent message) and type a reply first.";
                return;
            }
            sendBtn.disabled = true;
            fetch("/api/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ student_id: sid, body: body })
            })
                .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
                .then(function (res) {
                    if (info) info.textContent = res.d.message || "";
                    if (window.amsToast) window.amsToast(res.d.message || (res.ok ? "Sent." : "Failed."), res.ok ? "success" : "error", 4000);
                    if (res.ok) { bodyEl.value = ""; amsLoadMessages(); }
                })
                .catch(function () { if (info) info.textContent = "Network error."; })
                .finally(function () { sendBtn.disabled = false; });
        });
        amsLoadMessages();
    }

    function amsInitStaffSettings() {
        getJSON("/me").then(function (me) {
            var el = document.getElementById("amsWhoAmI");
            if (el && me && me.loggedIn) {
                el.innerHTML = "Logged in as <b>" + amsEsc(me.username) + "</b> (" + amsEsc(me.role) + ")";
            }
        }).catch(function () {});
        var btn = document.getElementById("amsPwChangeBtn");
        if (!btn) return;
        btn.addEventListener("click", function () {
            var note = document.getElementById("amsPwNote");
            var cur = document.getElementById("amsPwCurrent").value;
            var n1 = document.getElementById("amsPwNew").value;
            var n2 = document.getElementById("amsPwNew2").value;
            if (n1 !== n2) { if (note) { note.textContent = "The two new passwords do not match."; note.style.color = "#C0392B"; } return; }
            fetch("/api/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ current: cur, newPassword: n1 })
            })
                .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
                .then(function (res) {
                    if (note) { note.textContent = res.d.message || ""; note.style.color = res.ok ? "#14532d" : "#C0392B"; }
                    if (res.ok) {
                        document.getElementById("amsPwCurrent").value = "";
                        document.getElementById("amsPwNew").value = "";
                        document.getElementById("amsPwNew2").value = "";
                    }
                })
                .catch(function () { if (note) { note.textContent = "Network error."; note.style.color = "#C0392B"; } });
        });
    }

    /* ======================================================
       INIT
    ====================================================== */
    document.addEventListener("DOMContentLoaded", function () {
        /* CHANGED (pack 26 - owner: "move student score, load student and
           notices ... to the sidebar"): the score entry + scores table moved
           to scores.html and the Notice Board to notices.html. This init no
           longer assumes one page holds every widget - each group starts
           ONLY when its own elements exist here. Behaviour per page is
           unchanged (all ids and handlers are the same ones as before). */
        var hasDash   = !!document.getElementById("amsClassCount");
        var hasBoard  = !!document.getElementById("amsAnnouncementForm");
        var hasEvents = !!document.getElementById("amsEventForm");
        var hasScores = !!document.getElementById("scoreTable");

        if (hasDash) {
            loadDashboardStats();
            loadActivity();
            amsRefreshMsgBadge();    // NEW (pack 23): notifications bell
            setInterval(amsRefreshMsgBadge, 60000);
            var msgBell = document.getElementById("amsMsgBell");
            if (msgBell) msgBell.addEventListener("click", function () {
                // CHANGED (pack 25): the bell now opens the new Notifications page
                window.location.href = "notifications.html";
            });

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
        }

        if (hasBoard)  { loadAnnouncements(); initAnnouncementForm(); }
        if (hasEvents) { loadEvents(); initEventForm(); }

        if (hasScores) {
            updateScoreCount();
            /* Keep the visible-row counter in sync when app.js
               adds/removes rows in #scoreTable */
            var table = document.getElementById("scoreTable");
            if (table && window.MutationObserver) {
                new MutationObserver(function () { updateScoreCount(); })
                    .observe(table, { childList: true, subtree: false });
            }
        }
    });
})();
