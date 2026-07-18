/* ==========================================================
   SCHOOL SIGNATURES  (request #4)
   ----------------------------------------------------------
   CHANGED: the page is now DATA-DRIVEN - every role card below
   is generated from SIGNATURE_ROLES, so Vice Principal and Head
   Teacher joined Principal and Class Teacher with zero copied
   markup. Same server routes as before (/signatures,
   /save-signature, /delete-signature) and same function names
   (switchTab, clearPad, saveDrawnSignature, saveUploadedSignature,
   deleteSignature, loadCurrentSignatures).
   Drawn signatures are saved as transparent PNGs.
========================================================== */

// The four supported officials. Order = display order.
const SIGNATURE_ROLES = [
    { id: "principal",      label: "Principal" },
    { id: "vice_principal", label: "Vice Principal" },
    { id: "head_teacher",   label: "Head Teacher" },
    { id: "class_teacher",  label: "Class Teacher" }
];

const padContexts = {};
const padDrawing = {};
const padHasStrokes = {};

/* ---------------- card construction (no duplicate markup) ---------------- */

function buildSignatureCards() {
    const host = document.getElementById("sigCards");
    if (!host) return;

    SIGNATURE_ROLES.forEach(role => {
        const card = document.createElement("div");
        card.className = "mng-card";
        card.innerHTML =
            '<h2 class="mng-card-title">' +
                '<span class="mng-ico">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><path d="m16 8-9.04 9.07"/><path d="M17.5 15H9"/></svg>' +
                "</span>" + role.label +
            "</h2>" +

            // Preview (checkerboard shows transparent PNGs clearly)
            '<img id="' + role.id + '-preview" class="sig-preview" alt="' + role.label + ' signature" style="display:none;">' +
            '<p id="' + role.id + '-none" class="mng-card-sub" style="padding-left:0;">No signature on file yet.</p>' +

            // Tabs
            '<div class="sig-tabs">' +
                '<button type="button" class="sig-tab-btn active" onclick="switchTab(\'' + role.id + '\',\'draw\')">&#9998; Draw</button>' +
                '<button type="button" class="sig-tab-btn" onclick="switchTab(\'' + role.id + '\',\'upload\')">&#8681; Upload Image</button>' +
            "</div>" +

            // Draw panel
            '<div id="' + role.id + '-draw-panel" class="sig-panel active">' +
                '<div class="signature-pad-wrap"><canvas id="' + role.id + '-canvas" width="380" height="140"></canvas></div>' +
                '<div class="mng-actions" style="margin-top:12px;">' +
                    '<button type="button" class="mng-btn mng-btn-sm mng-btn-ghost" onclick="clearPad(\'' + role.id + '\')">Clear</button>' +
                    '<button type="button" class="mng-btn mng-btn-sm" onclick="saveDrawnSignature(\'' + role.id + '\')">Save Drawn Signature</button>' +
                "</div>" +
            "</div>" +

            // Upload panel
            '<div id="' + role.id + '-upload-panel" class="sig-panel">' +
                '<div class="mng-photo-row">' +
                    '<label class="mng-photo-btn" for="' + role.id + '-file">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>' +
                        "Choose Image (PNG/JPG)" +
                    "</label>" +
                    '<input type="file" id="' + role.id + '-file" accept="image/png, image/jpeg" style="display:none;">' +
                "</div>" +
                '<div class="mng-actions" style="margin-top:12px;">' +
                    '<button type="button" class="mng-btn mng-btn-sm" onclick="saveUploadedSignature(\'' + role.id + '\')">Save Uploaded Signature</button>' +
                "</div>" +
            "</div>" +

            // Remove (only shown when a signature exists)
            '<div class="mng-actions" id="' + role.id + '-remove-wrap" style="display:none; margin-top:16px; border-top:1px dashed var(--m-border,#D9E8E0); padding-top:14px;">' +
                '<button type="button" class="mng-btn mng-btn-sm mng-btn-danger" onclick="deleteSignature(\'' + role.id + '\')">Remove Signature</button>' +
            "</div>";

        host.appendChild(card);
        initPad(role.id);
    });
}

/* ---------------- drawing pad ---------------- */

function initPad(role) {
    const canvas = document.getElementById(`${role}-canvas`);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#21201C";
    padContexts[role] = ctx;
    padDrawing[role] = false;
    padHasStrokes[role] = false;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        // Canvas can be CSS-scaled on small screens - map touch/pointer
        // coordinates back into canvas pixels.
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const src = (e.touches && e.touches.length > 0) ? e.touches[0] : e;
        return {
            x: (src.clientX - rect.left) * scaleX,
            y: (src.clientY - rect.top) * scaleY
        };
    }

    function start(e) {
        e.preventDefault();
        padDrawing[role] = true;
        padHasStrokes[role] = true;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    }

    function move(e) {
        if (!padDrawing[role]) return;
        e.preventDefault();
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    }

    function end(e) {
        padDrawing[role] = false;
    }

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", end);
    canvas.addEventListener("mouseleave", end);

    canvas.addEventListener("touchstart", start);
    canvas.addEventListener("touchmove", move);
    canvas.addEventListener("touchend", end);
}

function clearPad(role) {
    const canvas = document.getElementById(`${role}-canvas`);
    const ctx = padContexts[role];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    padHasStrokes[role] = false;
}

function switchTab(role, mode) {
    const drawPanel = document.getElementById(`${role}-draw-panel`);
    const uploadPanel = document.getElementById(`${role}-upload-panel`);
    const tabButtons = drawPanel.parentElement.querySelectorAll(".sig-tab-btn");

    if (mode === "draw") {
        drawPanel.classList.add("active");
        uploadPanel.classList.remove("active");
        tabButtons[0].classList.add("active");
        tabButtons[1].classList.remove("active");
    } else {
        uploadPanel.classList.add("active");
        drawPanel.classList.remove("active");
        tabButtons[1].classList.add("active");
        tabButtons[0].classList.remove("active");
    }
}

/* ---------------- save / delete ---------------- */

function notify(message, type) {
    if (window.amsToast) window.amsToast(message, type || "info", 4200);
    else alert(message);
}

function saveDrawnSignature(role) {
    if (!padHasStrokes[role]) {
        notify("Please draw a signature first.", "error");
        return;
    }

    const canvas = document.getElementById(`${role}-canvas`);

    // toBlob on a canvas the user drew on keeps the untouched pixels
    // transparent -> a real transparent PNG.
    canvas.toBlob(blob => {
        const formData = new FormData();
        formData.append("role", role);
        formData.append("signature", blob, `${role}.png`);
        submitSignature(formData, role);
    }, "image/png");
}

function saveUploadedSignature(role) {
    const fileInput = document.getElementById(`${role}-file`);

    if (fileInput.files.length === 0) {
        notify("Please choose an image file first.", "error");
        return;
    }

    const formData = new FormData();
    formData.append("role", role);
    formData.append("signature", fileInput.files[0]);
    submitSignature(formData, role);
}

function submitSignature(formData, role) {
    fetch("/save-signature", {
        method: "POST",
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        notify(data.message, data.message.toLowerCase().includes("success") ? "success" : "error");
        loadCurrentSignatures();
    })
    .catch(error => {
        console.log(error);
        notify("Error saving signature.", "error");
    });
}

function deleteSignature(role) {
    const doDelete = () => {
        fetch(`/delete-signature/${role}`, {
            method: "DELETE"
        })
        .then(response => response.json())
        .then(data => {
            notify(data.message, "success");
            loadCurrentSignatures();
        })
        .catch(error => {
            console.log(error);
            notify("Error removing signature.", "error");
        });
    };

    if (window.amsConfirm) {
        window.amsConfirm(
            "Remove this signature?",
            "Report cards will show a blank line until a new one is added.",
            { confirmText: "Yes, remove", cancelText: "Cancel" }
        ).then(yes => { if (yes) doDelete(); });
    } else if (confirm("Remove this signature? Report cards will show a blank line until a new one is added.")) {
        doDelete();
    }
}

function loadCurrentSignatures() {
    fetch("/signatures")
        .then(response => response.json())
        .then(signatures => {
            SIGNATURE_ROLES.forEach(role => {
                const match = signatures.find(s => s.role === role.id);
                const preview = document.getElementById(`${role.id}-preview`);
                const noneNote = document.getElementById(`${role.id}-none`);
                const removeWrap = document.getElementById(`${role.id}-remove-wrap`);
                if (!preview) return;

                if (match) {
                    preview.src = `${match.signature_path}?t=${Date.now()}`;
                    preview.style.display = "block";
                    if (noneNote) noneNote.style.display = "none";
                    if (removeWrap) removeWrap.style.display = "flex";
                } else {
                    preview.style.display = "none";
                    if (noneNote) noneNote.style.display = "block";
                    if (removeWrap) removeWrap.style.display = "none";
                }
            });
        })
        .catch(error => console.log(error));
}

/* ==========================================================
   NEW (per-class Class Teacher signatures, owner request):
   "space to accept many signatures and assign them to classes,
   so the signature appears on its own class's reports, not just
   random class."
   One full-width card UNDER the four role cards: pick a class,
   draw or upload its teacher's signature, save. Every class's
   reports then stamp ITS OWN teacher's signature; classes with
   nothing assigned keep using the shared Class Teacher
   signature above (unchanged fallback).
========================================================== */

const CLASS_SIG_ROLE = "ctclass"; // pad-registry key for the per-class pad

function buildClassSignatureSection() {
    const host = document.getElementById("sigCards");
    if (!host) return;

    const wrap = document.createElement("div");
    wrap.className = "mng-card";
    wrap.style.gridColumn = "1 / -1"; // span the full card row
    wrap.innerHTML =
        '<h2 class="mng-card-title">' +
            '<span class="mng-ico">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><path d="m16 8-9.04 9.07"/><path d="M17.5 15H9"/></svg>' +
            "</span>Class Teacher - per Class" +
        "</h2>" +
        '<p class="mng-card-sub" style="padding-left:0;">Add MANY class teacher signatures - one for each class. ' +
        "A class's reports will stamp ITS OWN teacher's signature. Classes with nothing assigned here keep using " +
        'the shared "Class Teacher" signature above.</p>' +

        // class picker
        '<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:14px;">' +
            '<label for="ctClassSelect" style="font-weight:800; font-size:13px;">Assign to class:</label>' +
            '<select id="ctClassSelect" style="min-width:220px;"></select>' +
        "</div>" +

        // Draw / Upload tabs - same panel ids pattern, pad key "ctclass"
        '<div class="sig-tabs">' +
            '<button type="button" class="sig-tab-btn active" onclick="switchTab(\'ctclass\',\'draw\')">&#9998; Draw</button>' +
            '<button type="button" class="sig-tab-btn" onclick="switchTab(\'ctclass\',\'upload\')">&#8681; Upload Image</button>' +
        "</div>" +

        '<div id="ctclass-draw-panel" class="sig-panel active">' +
            '<div class="signature-pad-wrap"><canvas id="ctclass-canvas" width="380" height="140"></canvas></div>' +
            '<div class="mng-actions" style="margin-top:12px;">' +
                '<button type="button" class="mng-btn mng-btn-sm mng-btn-ghost" onclick="clearPad(\'ctclass\')">Clear</button>' +
                '<button type="button" class="mng-btn mng-btn-sm" onclick="saveClassDrawnSignature()">Save for Selected Class</button>' +
            "</div>" +
        "</div>" +

        '<div id="ctclass-upload-panel" class="sig-panel">' +
            '<div class="mng-photo-row">' +
                '<label class="mng-photo-btn" for="ctclass-file">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>' +
                    "Choose Image (PNG/JPG)" +
                "</label>" +
                '<input type="file" id="ctclass-file" accept="image/png, image/jpeg" style="display:none;">' +
            "</div>" +
            '<div class="mng-actions" style="margin-top:12px;">' +
                '<button type="button" class="mng-btn mng-btn-sm" onclick="saveClassUploadedSignature()">Save for Selected Class</button>' +
            "</div>" +
        "</div>" +

        // the assigned list (class -> signature, with remove buttons)
        '<div id="ctAssignedList" style="margin-top:18px; border-top:1px dashed var(--m-border,#D9E8E0); padding-top:14px;">' +
            '<p class="mng-card-sub" style="padding-left:0;">Loading assigned classes...</p>' +
        "</div>";

    host.appendChild(wrap);
    initPad(CLASS_SIG_ROLE);   // same drawing pad engine as the role cards
    loadClassOptions();
    loadClassSignatures();
}

function loadClassOptions() {
    fetch("/classes")
        .then(r => r.json())
        .then(classes => {
            const sel = document.getElementById("ctClassSelect");
            if (!sel) return;
            sel.innerHTML = "";
            if (!Array.isArray(classes) || !classes.length) {
                sel.innerHTML = "<option value=''>(no classes found)</option>";
                return;
            }
            classes.forEach(c => {
                const opt = document.createElement("option");
                opt.value = c.class_name;
                opt.textContent = c.class_name;
                sel.appendChild(opt);
            });
        })
        .catch(() => notify("Could not load the class list.", "error"));
}

function saveClassDrawnSignature() {
    if (!padHasStrokes[CLASS_SIG_ROLE]) {
        notify("Please draw a signature first.", "error");
        return;
    }
    const canvas = document.getElementById(`${CLASS_SIG_ROLE}-canvas`);
    // toBlob keeps the untouched pixels transparent (same as role cards)
    canvas.toBlob(blob => submitClassSignature(blob, "class-signature.png"), "image/png");
}

function saveClassUploadedSignature() {
    const fileInput = document.getElementById("ctclass-file");
    if (fileInput.files.length === 0) {
        notify("Please choose an image file first.", "error");
        return;
    }
    submitClassSignature(fileInput.files[0], fileInput.files[0].name);
}

function submitClassSignature(blobOrFile, fileName) {
    const sel = document.getElementById("ctClassSelect");
    const className = ((sel && sel.value) || "").trim();
    if (!className) {
        notify("Please choose the class first.", "error");
        return;
    }
    const formData = new FormData();
    formData.append("class_name", className); // BEFORE the file: multer reads fields in order
    formData.append("signature", blobOrFile, fileName);
    fetch("/save-class-signature", { method: "POST", body: formData })
        .then(response => response.json())
        .then(data => {
            notify(data.message, (data.message || "").toLowerCase().includes("saved") ? "success" : "error");
            clearPad(CLASS_SIG_ROLE);
            const fileInput = document.getElementById("ctclass-file");
            if (fileInput) fileInput.value = "";
            loadClassSignatures();
        })
        .catch(error => {
            console.log(error);
            notify("Error saving signature.", "error");
        });
}

function loadClassSignatures() {
    const list = document.getElementById("ctAssignedList");
    if (!list) return;
    fetch("/class-signatures")
        .then(r => r.json())
        .then(rows => {
            rows = Array.isArray(rows) ? rows : [];
            if (!rows.length) {
                list.innerHTML = '<p class="mng-card-sub" style="padding-left:0;">No class signatures assigned yet - every class uses the shared Class Teacher signature above.</p>';
                return;
            }
            list.innerHTML = "";
            rows.forEach(row => {
                const item = document.createElement("div");
                item.style.cssText = "display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px dashed var(--m-border,#D9E8E0); flex-wrap:wrap;";

                const name = document.createElement("strong");
                name.style.minWidth = "180px";
                name.textContent = row.class_name;

                const img = document.createElement("img");
                img.alt = "";
                img.src = `${row.signature_path}?t=${Date.now()}`;
                img.style.cssText = "height:44px; max-width:180px; object-fit:contain; background:#fff; border:1px solid var(--m-border,#D9E8E0); border-radius:8px; padding:4px;";

                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "mng-btn mng-btn-sm mng-btn-danger";
                btn.textContent = "Remove";
                btn.style.marginLeft = "auto";
                btn.addEventListener("click", () => deleteClassSignature(row.class_name));

                item.appendChild(name);
                item.appendChild(img);
                item.appendChild(btn);
                list.appendChild(item);
            });
        })
        .catch(() => {
            list.innerHTML = '<p class="mng-card-sub" style="padding-left:0;">Could not load the class signatures.</p>';
        });
}

function deleteClassSignature(className) {
    const doDelete = () => {
        fetch(`/class-signature/${encodeURIComponent(className)}`, { method: "DELETE" })
            .then(response => response.json())
            .then(data => {
                notify(data.message, "success");
                loadClassSignatures();
            })
            .catch(error => {
                console.log(error);
                notify("Error removing signature.", "error");
            });
    };

    if (window.amsConfirm) {
        window.amsConfirm(
            `Remove the signature for ${className}?`,
            "That class's reports will use the shared Class Teacher signature again.",
            { confirmText: "Yes, remove", cancelText: "Cancel" }
        ).then(yes => { if (yes) doDelete(); });
    } else if (confirm(`Remove the signature for ${className}?`)) {
        doDelete();
    }
}

// Build the role cards as soon as the page's DOM is parsed
// (this file is loaded at the end of <body>).
// CHANGED (pack 17 - owner: "add all user space for signature"): besides
// the four officials (Principal / Vice Principal / Head Teacher / Class
// Teacher), EVERY login user from Manage Users gets their own signature
// slot (staff_<username>) - Bursar, Exam Officer, any custom position.
// Non-admin staff cannot read /users, so for them the page shows the
// official slots only, exactly as before. Building waits for the user
// list so every slot appears in one pass.
fetch("/users")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (users) {
        (Array.isArray(users) ? users : []).forEach(function (u) {
            var slot = "staff_" + String(u.username || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
            if (slot === "staff_") return;
            if (SIGNATURE_ROLES.some(function (r) { return r.id === slot; })) return;
            SIGNATURE_ROLES.push({
                id: slot,
                label: String(u.username || "User") + " (" + String(u.role || "staff") + ")"
            });
        });
    })
    .catch(function () { /* non-admin: official slots only */ })
    .finally(function () {
        buildSignatureCards();
        buildClassSignatureSection(); // NEW: "Class Teacher - per Class" section
        loadCurrentSignatures();      // refresh previews incl. the user slots
    });
