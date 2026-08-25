/* ==========================================================================
   js/ai-image-gen.js  (AI-Image pack - REWRITTEN, pack 37)
   Frontend logic for the AI Image Generator page.
   Talks to POST /api/ai/generate-image — API key is NEVER in this file.
   NEW: style preset + shape picker are sent with the prompt; the server
   enhances the prompt, draws with the best available engine and returns
   the professional art direction + which engine it used.
   Stores last 8 generated images in localStorage for the history strip.
   ========================================================================== */
"use strict";

/* ---------- DOM refs ---------- */
var imgPrompt      = null;
var imgCharCount   = null;
var imgBtn         = null;
var imgSpinner     = null;
var imgResult      = null;
var imgEl          = null;
var imgEngine      = null;
var imgRevisedWrap = null;
var imgRevisedText = null;
var imgDownload    = null;
var imgNew         = null;
var imgError       = null;
var imgHistoryWrap = null;
var imgHistoryList = null;
var imgAspect      = null;

var MAX_PROMPT     = 1000;
var HISTORY_KEY    = "amsAiImgHistory";
var MAX_HISTORY    = 8;
var selectedStyle  = "poster";

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", function () {
    imgPrompt      = document.getElementById("imgPrompt");
    imgCharCount   = document.getElementById("imgCharCount");
    imgBtn         = document.getElementById("imgBtn");
    imgSpinner     = document.getElementById("imgSpinner");
    imgResult      = document.getElementById("imgResult");
    imgEl          = document.getElementById("imgGenerated");
    imgEngine      = document.getElementById("imgEngine");
    imgRevisedWrap = document.getElementById("imgRevisedWrap");
    imgRevisedText = document.getElementById("imgRevisedText");
    imgDownload    = document.getElementById("imgDownload");
    imgNew         = document.getElementById("imgNew");
    imgError       = document.getElementById("imgError");
    imgHistoryWrap = document.getElementById("imgHistoryWrap");
    imgHistoryList = document.getElementById("imgHistoryList");
    imgAspect      = document.getElementById("imgAspect");

    if (imgPrompt) {
        imgPrompt.addEventListener("input", onPromptInput);
        imgPrompt.addEventListener("keydown", function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") generateImage();
        });
    }
    if (imgBtn)      imgBtn.addEventListener("click", generateImage);
    if (imgNew)      imgNew.addEventListener("click", resetForm);
    if (imgDownload) imgDownload.addEventListener("click", downloadImage);

    bindStyleChips();
    renderHistory();
});

/* ---------- style selector (radio-like chips) ---------- */
function bindStyleChips() {
    var wrap = document.getElementById("imgStyleChips");
    if (!wrap) return;
    wrap.querySelectorAll("button[data-style]").forEach(function (chip) {
        chip.addEventListener("click", function () {
            selectedStyle = chip.getAttribute("data-style");
            wrap.querySelectorAll("button[data-style]").forEach(function (c) {
                c.classList.toggle("aig-chip-on", c === chip);
            });
        });
    });
}

/* ---------- character counter ---------- */
function onPromptInput() {
    var len = (imgPrompt.value || "").length;
    if (imgCharCount) {
        imgCharCount.textContent = len + " / " + MAX_PROMPT;
        imgCharCount.style.color = len > MAX_PROMPT - 50 ? "#c0392b" : "#7d9488";
    }
}

/* ---------- main generate ---------- */
function generateImage() {
    var prompt = (imgPrompt ? imgPrompt.value : "").trim();
    if (!prompt) { showError("Please describe the image you want to generate."); return; }
    if (prompt.length > MAX_PROMPT) { showError("Description is too long (max " + MAX_PROMPT + " characters)."); return; }

    clearError();
    setLoading(true);

    /* csrf.js patches fetch — CSRF token is added automatically */
    fetch("/api/ai/generate-image", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt: prompt,
            style: selectedStyle,
            aspect: imgAspect ? imgAspect.value : "square"
        })
    })
    .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    })
    .then(function (res) {
        setLoading(false);
        if (!res.ok) {
            showError(res.d.error || "Could not generate image. Please try again.");
            return;
        }
        showImage(res.d.b64, res.d.revisedPrompt || prompt, prompt, {
            mime: res.d.mime,
            engine: res.d.engine,
            width: res.d.width,
            height: res.d.height
        });
    })
    .catch(function () {
        setLoading(false);
        showError("Network error — please check your connection and try again.");
    });
}

/* ---------- display ---------- */
function showImage(b64, revisedPrompt, originalPrompt, meta) {
    meta = meta || {};
    var mime = meta.mime || "image/png";
    var src = "data:" + mime + ";base64," + b64;

    if (imgEl) {
        imgEl.src = src;
        imgEl.alt = originalPrompt;
    }

    /* Store b64 + mime for download */
    if (imgDownload) {
        imgDownload.dataset.b64 = b64;
        imgDownload.dataset.mime = mime;
    }

    /* Which engine drew it + exact size */
    if (imgEngine) {
        var bits = [];
        if (meta.engine) bits.push("<b>" + escHtml(meta.engine) + "</b>");
        if (meta.width && meta.height) bits.push(meta.width + " × " + meta.height + " px");
        imgEngine.innerHTML = bits.join(" &middot; ") || "";
    }

    /* Show revised prompt only if it differs meaningfully */
    if (imgRevisedWrap && imgRevisedText) {
        var showRevised = revisedPrompt && revisedPrompt !== originalPrompt;
        imgRevisedWrap.style.display = showRevised ? "block" : "none";
        if (showRevised) imgRevisedText.textContent = revisedPrompt;
    }

    if (imgResult) imgResult.style.display = "block";
    if (imgResult) imgResult.scrollIntoView({ behavior: "smooth", block: "start" });

    /* Save to history */
    saveHistory({ prompt: originalPrompt, b64: b64, mime: mime, engine: meta.engine || "", ts: Date.now() });
    renderHistory();
}

function escHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

/* ---------- download ---------- */
function downloadImage() {
    var b64 = imgDownload && imgDownload.dataset.b64;
    if (!b64) return;
    var mime = (imgDownload && imgDownload.dataset.mime) || "image/png";
    var ext = mime.indexOf("png") !== -1 ? "png" : "jpg";
    try {
        var byteStr = atob(b64);
        var arr = new Uint8Array(byteStr.length);
        for (var i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
        var blob = new Blob([arr], { type: mime });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement("a");
        a.href   = url;
        a.download = "amsais-ai-image-" + Date.now() + "." + ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    } catch (e) {
        showError("Download failed — please right-click the image and choose 'Save image as'.");
    }
}

/* ---------- reset ---------- */
function resetForm() {
    if (imgResult) imgResult.style.display = "none";
    if (imgEl) imgEl.src = "";
    if (imgEngine) imgEngine.innerHTML = "";
    if (imgDownload) { imgDownload.dataset.b64 = ""; imgDownload.dataset.mime = "image/png"; }
    if (imgRevisedWrap) imgRevisedWrap.style.display = "none";
    clearError();
    if (imgPrompt) { imgPrompt.value = ""; imgPrompt.focus(); onPromptInput(); }
}

/* ---------- history (localStorage) ---------- */
function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
    catch (e) { return []; }
}

function saveHistory(entry) {
    var hist = loadHistory();
    hist.unshift(entry);
    if (hist.length > MAX_HISTORY) hist = hist.slice(0, MAX_HISTORY);
    /* b64 strings are large — keep only the last 3 with full images */
    hist.forEach(function (h, i) { if (i >= 3) delete h.b64; });
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist)); } catch (e) { /* quota full */ }
}

function renderHistory() {
    if (!imgHistoryList || !imgHistoryWrap) return;
    var hist = loadHistory();
    if (!hist.length) { imgHistoryWrap.style.display = "none"; return; }
    imgHistoryWrap.style.display = "block";
    imgHistoryList.innerHTML = "";
    hist.forEach(function (h) {
        var card = document.createElement("div");
        card.className = "aig-hist-card";

        if (h.b64) {
            var mime = h.mime || "image/png";
            var thumb = document.createElement("img");
            thumb.className = "aig-hist-thumb";
            thumb.src = "data:" + mime + ";base64," + h.b64;
            thumb.alt = h.prompt || "Generated image";
            thumb.addEventListener("click", function () {
                if (imgResult) imgResult.style.display = "none";
                showImage(h.b64, h.prompt, h.prompt, { mime: h.mime, engine: h.engine });
                window.scrollTo({ top: 0, behavior: "smooth" });
            });
            card.appendChild(thumb);
        } else {
            var placeholder = document.createElement("div");
            placeholder.className = "aig-hist-thumb aig-hist-no-thumb";
            placeholder.textContent = "🖼";
            card.appendChild(placeholder);
        }

        var caption = document.createElement("p");
        caption.className = "aig-hist-caption";
        caption.textContent = (h.prompt || "").slice(0, 60) + ((h.prompt || "").length > 60 ? "…" : "");
        card.appendChild(caption);

        var ts = document.createElement("span");
        ts.className = "aig-hist-ts";
        ts.textContent = h.ts ? new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
        card.appendChild(ts);

        imgHistoryList.appendChild(card);
    });
}

/* ---------- helpers ---------- */
function setLoading(on) {
    if (imgBtn)     { imgBtn.disabled = on; imgBtn.textContent = on ? "Designing…" : "✨ Generate Image"; }
    if (imgSpinner) imgSpinner.style.display = on ? "flex" : "none";
    if (on && imgResult) imgResult.style.display = "none";
}

function showError(msg) {
    if (imgError) { imgError.textContent = msg; imgError.style.display = "block"; }
}

function clearError() {
    if (imgError) { imgError.textContent = ""; imgError.style.display = "none"; }
}
