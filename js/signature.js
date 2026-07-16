const padContexts = {};
const padDrawing = { class_teacher: false, principal: false };
const padHasStrokes = { class_teacher: false, principal: false };

function initPad(role) {
    const canvas = document.getElementById(`${role}-canvas`);
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#21201C";
    padContexts[role] = ctx;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        if (e.touches && e.touches.length > 0) {
            return {
                x: e.touches[0].clientX - rect.left,
                y: e.touches[0].clientY - rect.top
            };
        }
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
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

initPad("class_teacher");
initPad("principal");

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

function saveDrawnSignature(role) {
    if (!padHasStrokes[role]) {
        alert("Please draw a signature first.");
        return;
    }

    const canvas = document.getElementById(`${role}-canvas`);

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
        alert("Please choose an image file first.");
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
        alert(data.message);
        loadCurrentSignatures();
    })
    .catch(error => {
        console.log(error);
        alert("Error saving signature.");
    });
}

function deleteSignature(role) {
    const confirmed = confirm("Remove this signature? Report cards will show a blank line until a new one is added.");
    if (!confirmed) return;

    fetch(`/delete-signature/${role}`, {
        method: "DELETE"
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
        loadCurrentSignatures();
    })
    .catch(error => {
        console.log(error);
        alert("Error removing signature.");
    });
}

function loadCurrentSignatures() {
    fetch("/signatures")
        .then(response => response.json())
        .then(signatures => {
            ["class_teacher", "principal"].forEach(role => {
                const match = signatures.find(s => s.role === role);
                const box = document.getElementById(`${role}-current`);
                const preview = document.getElementById(`${role}-preview`);

                if (match) {
                    preview.src = `${match.signature_path}?t=${Date.now()}`;
                    box.style.display = "block";
                } else {
                    box.style.display = "none";
                }
            });
        })
        .catch(error => console.log(error));
}