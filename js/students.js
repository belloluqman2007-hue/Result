/* ==========================================================
   STUDENTS DIRECTORY  (js/students.js)  [NEW FILE - ADDITIVE]
   ----------------------------------------------------------
   Powers the NEW students.html page only:
     - loads the student list once from the NEW GET /students
     - live search (name / ID) + class & gender filters
     - client-side pagination
     - read-only profile modal
     - Excel/CSV export (via amsExportObjectsCSV in js/ui.js)
   All filtering/pagination happens in the browser - the server
   query is a plain SELECT; nothing is ever written.
========================================================== */

(function () {
    "use strict";

    var allStudents = [];      /* full list from server */
    var filtered = [];         /* after search + filters */
    var currentPage = 1;
    var PAGE_SIZE = 12;

    /* ---------- data loading ---------- */
    function loadStudents() {
        var grid = document.getElementById("amsDirGrid");
        /* skeleton placeholders while loading */
        grid.innerHTML = "";
        for (var i = 0; i < 6; i++) {
            var sk = document.createElement("div");
            sk.className = "ams-skeleton";
            sk.style.height = "96px";
            grid.appendChild(sk);
        }

        Promise.all([
            fetch("/students").then(function (r) {
                if (!r.ok) throw new Error("load failed");
                return r.json();
            }),
            fetch("/classes").then(function (r) { return r.json(); }).catch(function () { return []; })
        ]).then(function (res) {
            allStudents = res[0] || [];
            fillClassFilter(res[1] || []);
            document.getElementById("amsTotalInfo").textContent =
                allStudents.length + " registered student(s).";
            window.amsDirRefresh(1);
        }).catch(function (e) {
            console.log(e);
            grid.innerHTML = window.amsEmptyState(
                "Could not load students",
                "Check the server/database connection and reload."
            );
        });
    }

    /* ---------- class filter options ---------- */
    function fillClassFilter(classes) {
        var select = document.getElementById("amsDirClass");
        classes.forEach(function (c) {
            var opt = document.createElement("option");
            opt.value = c.class_name;
            opt.textContent = c.class_name;
            select.appendChild(opt);
        });
    }

    /* ---------- filter + search + paginate (global for inline handlers) ---------- */
    window.amsDirRefresh = function (page) {
        var q = document.getElementById("amsDirSearch").value.trim().toLowerCase();
        var cls = document.getElementById("amsDirClass").value;
        var gen = document.getElementById("amsDirGender").value;

        filtered = allStudents.filter(function (s) {
            if (cls && s.class_name !== cls) return false;
            if (gen && s.gender !== gen) return false;
            if (q) {
                var hay = (String(s.student_id) + " " + String(s.full_name)).toLowerCase();
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });

        var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        currentPage = Math.min(Math.max(1, page || currentPage), pages);

        document.getElementById("amsDirCount").textContent = filtered.length + " found";
        renderGrid();
        renderPager(pages);
    };

    /* ---------- card grid ---------- */
    function renderGrid() {
        var grid = document.getElementById("amsDirGrid");
        grid.innerHTML = "";

        if (!filtered.length) {
            grid.innerHTML = window.amsEmptyState(
                "No students match your search",
                "Try a different name, ID, or clear the filters."
            );
            return;
        }

        var start = (currentPage - 1) * PAGE_SIZE;
        var slice = filtered.slice(start, start + PAGE_SIZE);

        slice.forEach(function (s, idx) {
            var card = document.createElement("div");
            card.className = "ams-student-card";
            card.style.animationDelay = (idx * 35) + "ms";

            var img = document.createElement("img");
            img.alt = s.full_name || "Student photo";
            img.src = s.photo_path || "images/default.jpg"; /* default.jpg exists in /images */
            img.onerror = function () { this.onerror = null; this.src = "images/default.jpg"; };

            var info = document.createElement("div");
            var h = document.createElement("h4");
            h.textContent = s.full_name || "-";
            var meta = document.createElement("div");
            meta.className = "ams-student-meta";
            meta.textContent = (s.class_name || "-") + " · " + (s.gender || "-");
            var idBadge = document.createElement("span");
            idBadge.className = "ams-student-id";
            idBadge.textContent = s.student_id;

            info.appendChild(h);
            info.appendChild(meta);
            info.appendChild(idBadge);
            card.appendChild(img);
            card.appendChild(info);

            card.addEventListener("click", function () { openProfile(s); });
            grid.appendChild(card);
        });
    }

    /* ---------- pagination ---------- */
    function renderPager(pages) {
        var pager = document.getElementById("amsDirPager");
        pager.innerHTML = "";
        if (pages <= 1) return;

        function btn(label, page, opts) {
            opts = opts || {};
            var b = document.createElement("button");
            b.type = "button";
            b.innerHTML = label;
            if (opts.current) b.className = "ams-page-current";
            if (opts.disabled) b.disabled = true;
            b.addEventListener("click", function () { window.amsDirRefresh(page); });
            pager.appendChild(b);
        }

        btn("&lsaquo;", currentPage - 1, { disabled: currentPage === 1 });

        /* window of page numbers around the current page */
        var from = Math.max(1, currentPage - 2);
        var to = Math.min(pages, from + 4);
        from = Math.max(1, to - 4);
        for (var p = from; p <= to; p++) {
            btn(String(p), p, { current: p === currentPage });
        }

        var info = document.createElement("span");
        info.className = "ams-page-info";
        info.textContent = "Page " + currentPage + " of " + pages;
        pager.appendChild(info);

        btn("&rsaquo;", currentPage + 1, { disabled: currentPage === pages });
    }

    /* ---------- profile modal (read-only) ---------- */
    function openProfile(s) {
        var overlay = document.getElementById("amsProfileOverlay");
        var box = document.getElementById("amsProfileBox");

        var dob = "-";
        if (s.date_of_birth) {
            var d = new Date(s.date_of_birth);
            if (!isNaN(d)) {
                dob = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
            }
        }

        box.innerHTML =
            '<div class="ams-profile-head">' +
                '<img src="' + (s.photo_path || "images/default.jpg") + '" alt="Student photo" ' +
                     'onerror="this.onerror=null; this.src=\'images/default.jpg\';">' +
                "<div><h3></h3><span class='ams-student-id'></span></div>" +
            "</div>" +
            '<div class="ams-profile-rows">' +
                '<div class="ams-profile-row"><span>Student ID</span><span class="pv-id"></span></div>' +
                '<div class="ams-profile-row"><span>Class</span><span class="pv-class"></span></div>' +
                '<div class="ams-profile-row"><span>Gender</span><span class="pv-gender"></span></div>' +
                '<div class="ams-profile-row"><span>Date of Birth</span><span class="pv-dob"></span></div>' +
            "</div>" +
            '<div class="ams-modal-actions">' +
                '<button type="button" class="m-btn-ghost" onclick="amsProfileClose()">Close</button>' +
                '<a href="student-result.html"><button type="button">Open Result Checker</button></a>' +
            "</div>";

        box.querySelector("h3").textContent = s.full_name || "-";
        box.querySelector(".ams-student-id").textContent = s.student_id;
        box.querySelector(".pv-id").textContent = s.student_id;
        box.querySelector(".pv-class").textContent = s.class_name || "-";
        box.querySelector(".pv-gender").textContent = s.gender || "-";
        box.querySelector(".pv-dob").textContent = dob;

        overlay.style.display = "flex";
    }

    window.amsProfileClose = function () {
        document.getElementById("amsProfileOverlay").style.display = "none";
    };

    /* ---------- export current (filtered) view to CSV ---------- */
    window.amsDirExport = function () {
        window.amsExportObjectsCSV(filtered, [
            { key: "student_id", label: "Student ID" },
            { key: "full_name", label: "Full Name" },
            { key: "gender", label: "Gender" },
            { key: "class_name", label: "Class" },
            { key: "date_of_birth", label: "Date of Birth" }
        ], "students-directory.csv");
    };

    /* close the profile modal with Escape */
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") window.amsProfileClose();
    });

    document.addEventListener("DOMContentLoaded", loadStudents);
})();
