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
    var isAdminUser = false;   /* NEW (edit profile): filled from /me once */
    var editingStudent = null; /* NEW: the student currently in the edit form */

    /* NEW (edit profile): check once whether the logged-in staff member
       is the admin - only admins see the Edit button (the server also
       enforces this, so it's belt-and-braces). */
    fetch("/me")
        .then(function (r) { return r.json(); })
        .then(function (me) { isAdminUser = !!(me && me.loggedIn && me.role === "admin"); })
        .catch(function () { isAdminUser = false; });

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
                /* NEW (request #4): parent/guardian details on the profile */
                '<div class="ams-profile-row"><span>Parent Name</span><span class="pv-parent"></span></div>' +
                '<div class="ams-profile-row"><span>Parent Phone</span><span class="pv-phone"></span></div>' +
                '<div class="ams-profile-row"><span>Address</span><span class="pv-address"></span></div>' +
            "</div>" +
            '<div class="ams-modal-actions">' +
                '<button type="button" class="m-btn-ghost" onclick="amsProfileClose()">Close</button>' +
                '<a href="student-result.html"><button type="button">Open Result Checker</button></a>' +
                /* NEW (request #4): Edit Profile (admin only - wired below) */
                '<button type="button" class="m-btn-sm" id="amsEditBtn">&#9998; Edit Profile</button>' +
                /* NEW (student management): photo upload + delete buttons,
                   wired up right after the modal is shown. */
                '<button type="button" class="m-btn-sm" id="amsPhotoBtn">&#128247; Add / Change Photo</button>' +
                '<input type="file" id="amsPhotoInput" accept="image/jpeg,image/png" style="display:none">' +
                '<button type="button" class="m-btn-danger m-btn-sm" id="amsDeleteBtn">&#128465; Delete Student</button>' +
            "</div>";

        box.querySelector("h3").textContent = s.full_name || "-";
        box.querySelector(".ams-student-id").textContent = s.student_id;
        box.querySelector(".pv-id").textContent = s.student_id;
        box.querySelector(".pv-class").textContent = s.class_name || "-";
        box.querySelector(".pv-gender").textContent = s.gender || "-";
        box.querySelector(".pv-dob").textContent = dob;
        /* NEW (request #4): parent fields may be missing on older rows */
        box.querySelector(".pv-parent").textContent = s.parent_name || "-";
        box.querySelector(".pv-phone").textContent = s.parent_phone || "-";
        box.querySelector(".pv-address").textContent = s.address || "-";

        /* ---------- NEW (request #4): Edit Profile (admin only) ---------- */
        var editBtn = box.querySelector("#amsEditBtn");
        if (editBtn) {
            editBtn.style.display = isAdminUser ? "" : "none";
            editBtn.addEventListener("click", function () { openEditProfile(s); });
        }

        /* ---------- NEW (student management): Add/Change Photo ----------
           Excel bulk upload cannot carry photos, so photos for imported
           students are attached here, one student at a time. */
        var photoBtn = box.querySelector("#amsPhotoBtn");
        var photoInput = box.querySelector("#amsPhotoInput");
        if (photoBtn && photoInput) {
            photoBtn.addEventListener("click", function () { photoInput.click(); });
            photoInput.addEventListener("change", function () {
                if (!photoInput.files.length) return;
                var fd = new FormData();
                fd.append("student_id", s.student_id); // BEFORE the file: multer uses it to name the file
                fd.append("photo", photoInput.files[0]);
                photoBtn.disabled = true;
                fetch("/update-student-photo", { method: "POST", body: fd })
                    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                    .then(function (out) {
                        photoBtn.disabled = false;
                        if (!out.ok) return window.amsToast(out.j.message || "Photo upload failed", "error");
                        s.photo_path = out.j.photo_path;
                        var img = box.querySelector(".ams-profile-head img");
                        if (img) img.src = out.j.photo_path + "?t=" + Date.now();
                        window.amsToast("Photo saved \u2713", "success");
                        loadStudents(); // refresh the grid behind the modal
                    })
                    .catch(function () {
                        photoBtn.disabled = false;
                        window.amsToast("Network error while uploading photo", "error");
                    });
            });
        }

        /* ---------- NEW (student management): Delete student ----------
           Uses the existing server route /delete-student (admin-only).
           After the student is removed, their saved results are cleared
           with the existing /delete-results-by-student route. */
        var deleteBtn = box.querySelector("#amsDeleteBtn");
        if (deleteBtn) {
            deleteBtn.addEventListener("click", function () {
                window.amsConfirm(
                    "Delete " + (s.full_name || s.student_id) + "?",
                    "This permanently removes the student AND all of their saved exam results. This cannot be undone.",
                    { confirmText: "Yes, delete", cancelText: "Cancel" }
                ).then(function (yes) {
                    if (!yes) return;
                    deleteBtn.disabled = true;
                    fetch("/delete-student/" + encodeURIComponent(s.student_id), { method: "DELETE" })
                        .then(function (r) {
                            if (r.status === 401 || r.status === 403) {
                                deleteBtn.disabled = false;
                                window.amsToast("Only the admin account can delete students.", "error", 4500);
                                return false;
                            }
                            if (!r.ok) throw new Error("delete-failed");
                            // Student removed - now clear their results too (best effort).
                            return fetch("/delete-results-by-student/" + encodeURIComponent(s.student_id), { method: "DELETE" })
                                .catch(function () { /* leave any orphan results; they never appear anywhere */ })
                                .then(function () { return true; });
                        })
                        .then(function (done) {
                            if (!done) return;
                            window.amsToast("Student deleted.", "success");
                            window.amsProfileClose();
                            loadStudents();
                        })
                        .catch(function () {
                            deleteBtn.disabled = false;
                            window.amsToast("Could not delete. Please try again.", "error");
                        });
                });
            });
        }

        overlay.style.display = "flex";
    }

    window.amsProfileClose = function () {
        document.getElementById("amsProfileOverlay").style.display = "none";
    };

    /* ==========================================================
       NEW (Edit Student Profile - request #4)
       ----------------------------------------------------------
       Opens a modal whose form is PRE-FILLED with the student's
       existing data and saves through the NEW admin route
       POST /update-student/:studentId. Photo is optional - when
       no new photo is picked, the current one is kept.
       The FormData sends "student_id" BEFORE the photo file,
       because multer names the saved image using that field.
    ========================================================== */
    function openEditProfile(s) {
        editingStudent = s;

        document.getElementById("amsEditFullName").value = s.full_name || "";
        document.getElementById("amsEditAdmNo").value = s.student_id || "";
        document.getElementById("amsEditGender").value = s.gender || "";

        /* date inputs need yyyy-mm-dd */
        var dobVal = "";
        if (s.date_of_birth) {
            var d = new Date(s.date_of_birth);
            if (!isNaN(d)) {
                dobVal = d.getFullYear() + "-" +
                    String(d.getMonth() + 1).padStart(2, "0") + "-" +
                    String(d.getDate()).padStart(2, "0");
            }
        }
        document.getElementById("amsEditDob").value = dobVal;

        document.getElementById("amsEditParentName").value = s.parent_name || "";
        document.getElementById("amsEditParentPhone").value = s.parent_phone || "";
        document.getElementById("amsEditAddress").value = s.address || "";

        var photoInput = document.getElementById("amsEditPhoto");
        photoInput.value = "";
        var preview = document.getElementById("amsEditPhotoPreview");
        preview.src = s.photo_path || "images/default.png";

        /* class dropdown: live list, student's current class preselected */
        var classSelect = document.getElementById("amsEditClass");
        fetch("/classes")
            .then(function (r) { return r.json(); })
            .then(function (classes) {
                classSelect.innerHTML = "";
                (classes || []).forEach(function (c) {
                    var opt = document.createElement("option");
                    opt.value = c.class_name;
                    opt.textContent = c.class_name;
                    classSelect.appendChild(opt);
                });
                /* keep the saved class selectable even if it was deleted
                   from the class list since the student was registered */
                if (s.class_name && !Array.from(classSelect.options).some(function (o) { return o.value === s.class_name; })) {
                    var extra = document.createElement("option");
                    extra.value = s.class_name;
                    extra.textContent = s.class_name;
                    classSelect.appendChild(extra);
                }
                classSelect.value = s.class_name || "";
            })
            .catch(function () {
                classSelect.innerHTML = "";
                var opt = document.createElement("option");
                opt.value = s.class_name || "";
                opt.textContent = s.class_name || "-";
                classSelect.appendChild(opt);
            });

        document.getElementById("amsEditOverlay").style.display = "flex";
    }

    window.amsEditClose = function () {
        document.getElementById("amsEditOverlay").style.display = "none";
        editingStudent = null;
    };

    function saveEditProfile() {
        if (!editingStudent) return;

        var fullName = document.getElementById("amsEditFullName").value.trim();
        var admNo = document.getElementById("amsEditAdmNo").value.trim();
        var gender = document.getElementById("amsEditGender").value;
        var dob = document.getElementById("amsEditDob").value;
        var cls = document.getElementById("amsEditClass").value;
        var parentName = document.getElementById("amsEditParentName").value.trim();
        var parentPhone = document.getElementById("amsEditParentPhone").value.trim();
        var address = document.getElementById("amsEditAddress").value.trim();
        var photoInput = document.getElementById("amsEditPhoto");

        if (!fullName || !admNo || !gender || !cls) {
            window.amsToast("Full Name, Admission Number, Gender and Class are required.", "error", 4500);
            return;
        }

        var fd = new FormData();
        fd.append("student_id", admNo);            /* BEFORE photo: multer names the file with this */
        fd.append("full_name", fullName);
        fd.append("gender", gender);
        fd.append("class_name", cls);
        fd.append("date_of_birth", dob);
        fd.append("parent_name", parentName);
        fd.append("parent_phone", parentPhone);
        fd.append("address", address);
        if (photoInput.files.length > 0) {
            fd.append("photo", photoInput.files[0]);
        }

        var saveBtn = document.getElementById("amsEditSaveBtn");
        saveBtn.disabled = true;

        fetch("/update-student/" + encodeURIComponent(editingStudent.student_id), {
            method: "POST",
            body: fd
        })
            .then(function (r) {
                return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
            })
            .then(function (out) {
                saveBtn.disabled = false;
                if (out.status === 401 || out.status === 403) {
                    window.amsToast("Only the admin account can edit student profiles.", "error", 5000);
                    return;
                }
                if (!out.ok) {
                    window.amsToast(out.j.message || "Could not save changes.", "error", 5000);
                    return;
                }
                window.amsToast("Profile updated \u2713", "success");
                window.amsEditClose();
                window.amsProfileClose(); /* close stale profile view too */
                loadStudents();           /* refresh the directory grid */
            })
            .catch(function () {
                saveBtn.disabled = false;
                window.amsToast("Network error while saving. Please try again.", "error");
            });
    }

    document.getElementById("amsEditSaveBtn").addEventListener("click", saveEditProfile);

    /* live preview when a replacement photo is chosen */
    document.getElementById("amsEditPhoto").addEventListener("change", function () {
        var photoInput = document.getElementById("amsEditPhoto");
        if (photoInput.files && photoInput.files[0]) {
            document.getElementById("amsEditPhotoPreview").src = URL.createObjectURL(photoInput.files[0]);
        }
    });

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
        if (e.key === "Escape") {
            window.amsProfileClose();
            window.amsEditClose(); /* NEW (request #4) */
        }
    });

    document.addEventListener("DOMContentLoaded", loadStudents);
})();
