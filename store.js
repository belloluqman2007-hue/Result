/* ==========================================================================
   NEW (Pack 47): SCHOOL FILE STORE & DIGITAL VAULT (js/store.js)
   Allows creating folders, uploading any file, previewing, and downloading.
   ========================================================================== */
"use strict";

var storeCurrentFolder = "/";
var storeItems = [];

/* Files that browsers can display inline — everything else gets Download only */
function storeCanPreview(mimeType, fileName) {
  var mime = (mimeType || "").toLowerCase();
  var name = (fileName || "").toLowerCase();
  var ext  = name.split(".").pop();
  // Previewable: images, PDFs, plain text
  if (/^image\//.test(mime)) return true;
  if (mime === "application/pdf" || ext === "pdf") return true;
  if (/^text\//.test(mime) || ext === "txt" || ext === "csv") return true;
  // NOT previewable: Word docs, Excel, zip, etc.
  return false;
}

function storeInit() {
  storeLoad();
}

function storeNotify(text, ok) {
  var msg = document.getElementById("storeMsg");
  if (!msg) return;
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4500);
}

function storeLoad() {
  var tbody = document.getElementById("storeTableBody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#5B6B62;">Loading vault...</td></tr>';
  fetch("/api/store/list?folder=" + encodeURIComponent(storeCurrentFolder))
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      storeItems = Array.isArray(rows) ? rows : [];
      storeRenderBreadcrumbs();
      storeRender();
    })
    .catch(function () {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#B91C1C;">Could not load items. Check network.</td></tr>';
    });
}

function storeRenderBreadcrumbs() {
  var bc = document.getElementById("storeBreadcrumbs");
  if (!bc) return;
  var parts = storeCurrentFolder.split("/").filter(Boolean);
  var html = '<a href="javascript:void(0)" onclick="storeNavigate(\'/\')" style="color:#1C5A42; text-decoration:none;">🏠 Home</a>';
  var pathAcc = "";
  parts.forEach(function (p) {
    pathAcc += "/" + p;
    html += ' <span style="color:#888;">/</span> <a href="javascript:void(0)" onclick="storeNavigate(\'' + pathAcc.replace(/'/g, "\\'") + '\')" style="color:#1C5A42; text-decoration:none;">' + storeEsc(p) + '</a>';
  });
  bc.innerHTML = html;
}

function storeNavigate(folderPath) {
  var p = folderPath || "/";
  if (p !== "/" && p.endsWith("/")) p = p.slice(0, -1);
  storeCurrentFolder = p;
  storeLoad();
}

function storeRender() {
  var tbody = document.getElementById("storeTableBody");
  if (!tbody) return;
  var q = (document.getElementById("storeSearch") || {}).value || "";
  q = q.trim().toLowerCase();

  var filtered = storeItems.filter(function (item) {
    if (!q) return true;
    var name = (item.file_name || item.original_name || "").toLowerCase();
    return name.indexOf(q) !== -1;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#777; padding:24px 0;">' +
      (storeItems.length ? "No files match that search." : "This folder is empty. Upload a file or create a folder!") +
      '</td></tr>';
    return;
  }

  var html = "";
  filtered.forEach(function (item) {
    var isFolder = Number(item.is_folder) === 1;
    var icon = "📄";
    if (isFolder) {
      icon = "📁";
    } else {
      var t = (item.file_type || "").toLowerCase();
      var name = (item.original_name || "").toLowerCase();
      if (t.indexOf("image/") !== -1 || /\.(png|jpe?g|gif|webp)$/.test(name)) icon = "🖼️";
      else if (t.indexOf("audio/") !== -1 || /\.(mp3|wav|ogg|m4a|aac)$/.test(name)) icon = "🎵";
      else if (t.indexOf("pdf") !== -1 || /\.pdf$/.test(name)) icon = "📄";
      else if (t.indexOf("spreadsheet") !== -1 || t.indexOf("excel") !== -1 || /\.(xlsx|xls|csv)$/.test(name)) icon = "📊";
      else if (t.indexOf("word") !== -1 || /\.(docx|doc|txt)$/.test(name)) icon = "📝";
      else if (t.indexOf("zip") !== -1 || t.indexOf("archive") !== -1 || /\.(zip|rar|7z)$/.test(name)) icon = "📦";
      else icon = "📎";
    }

    var sizeStr = isFolder ? "Folder" : storeFormatSize(item.file_size || 0);
    var dtStr = item.created_at ? new Date(item.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-";
    var nextFolder = storeCurrentFolder === "/" ? ("/" + item.file_name) : (storeCurrentFolder + "/" + item.file_name);

    html += "<tr>" +
      "<td>" +
      (isFolder
        ? '<a href="javascript:void(0)" onclick="storeNavigate(\'' + nextFolder.replace(/'/g, "\\'") + '\')" style="color:#0F3D2E; font-weight:700; text-decoration:none; display:flex; align-items:center; gap:8px;"><span>' + icon + '</span> <span>' + storeEsc(item.file_name) + '</span></a>'
        : '<div style="display:flex; align-items:center; gap:8px; font-weight:600; color:#222;"><span>' + icon + '</span> <span>' + storeEsc(item.original_name || item.file_name) + '</span></div>') +
      "</td>" +
      "<td>" + sizeStr + "</td>" +
      "<td>" + dtStr + "</td>" +
      '<td style="text-align:right; white-space:nowrap;">' +
      (isFolder
        ? '<button type="button" class="mg-btn-sm mg-btn-light" onclick="storeNavigate(\'' + nextFolder.replace(/'/g, "\\'") + '\')">Open</button> '
        : (storeCanPreview(item.file_type, item.original_name || item.file_name)
            ? '<a href="/api/store/view/' + item.id + '" target="_blank" class="mg-btn-sm mg-btn-light" style="text-decoration:none; display:inline-block; margin-right:4px;">👁️ Preview</a> '
            : '') +
          '<a href="/api/store/download/' + item.id + '" class="mg-btn-sm mg-btn" style="text-decoration:none; display:inline-block; margin-right:4px;">⬇️ Download</a> ') +
      '<button type="button" class="mg-btn-sm mg-btn-light" style="color:#B91C1C;" onclick="storeDeleteItem(' + item.id + ', \'' + storeEsc(item.file_name || item.original_name).replace(/'/g, "\\'") + '\')">🗑️ Delete</button>' +
      "</td>" +
      "</tr>";
  });

  tbody.innerHTML = html;
}

function storeFormatSize(bytes) {
  if (!bytes) return "0 KB";
  var k = 1024;
  if (bytes < k) return bytes + " B";
  if (bytes < k * k) return Math.round(bytes / k) + " KB";
  return (bytes / (k * k)).toFixed(1) + " MB";
}

function storeEsc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------------- modals & actions ---------------- */
function storeOpenFolderModal() {
  document.getElementById("storeNewFolderName").value = "";
  document.getElementById("storeFolderModal").style.display = "flex";
}
function storeCloseFolderModal() {
  document.getElementById("storeFolderModal").style.display = "none";
}
function storeCreateFolder() {
  var name = document.getElementById("storeNewFolderName").value.trim();
  if (!name) { alert("Please enter a folder name."); return; }
  fetch("/api/store/create-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_path: storeCurrentFolder, folder_name: name })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      storeCloseFolderModal();
      storeNotify(res.message || "Folder created.", true);
      storeLoad();
    })
    .catch(function () {
      storeNotify("Error creating folder.", false);
    });
}

function storeOpenUploadModal() {
  document.getElementById("storeFileInput").value = "";
  document.getElementById("storeUploadProgress").style.display = "none";
  document.getElementById("storeUploadSubmitBtn").disabled = false;
  document.getElementById("storeUploadModal").style.display = "flex";
}
function storeCloseUploadModal() {
  document.getElementById("storeUploadModal").style.display = "none";
}

function storeSubmitUpload() {
  var fileInput = document.getElementById("storeFileInput");
  if (!fileInput.files || !fileInput.files.length) {
    alert("Please select at least one file to upload.");
    return;
  }
  var fd = new FormData();
  fd.append("folder_path", storeCurrentFolder);
  for (var i = 0; i < fileInput.files.length; i++) {
    fd.append("files", fileInput.files[i]);
  }

  document.getElementById("storeUploadProgress").style.display = "block";
  document.getElementById("storeUploadSubmitBtn").disabled = true;

  fetch("/api/store/upload", {
    method: "POST",
    body: fd
  })
    .then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || "Upload failed"); });
      return r.json();
    })
    .then(function (res) {
      storeCloseUploadModal();
      storeNotify(res.message || "File uploaded successfully.", true);
      storeLoad();
    })
    .catch(function (err) {
      document.getElementById("storeUploadProgress").style.display = "none";
      document.getElementById("storeUploadSubmitBtn").disabled = false;
      storeNotify("Error uploading file: " + (err.message || "unknown error"), false);
    });
}

function storeDeleteItem(id, name) {
  if (!confirm("Are you sure you want to delete '" + name + "'? This cannot be undone.")) return;
  fetch("/api/store/delete/" + id, { method: "DELETE" })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      storeNotify(res.message || "Deleted.", true);
      storeLoad();
    })
    .catch(function () {
      storeNotify("Could not delete item.", false);
    });
}
