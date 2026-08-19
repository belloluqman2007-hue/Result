/* Class Management — list / add / rename / delete. */
(function () {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.mcLoad = function () {
    fetch("/api/manage-classes")
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];
        var box = document.getElementById("mcList");
        var count = document.getElementById("mcCount");
        if (!rows.length) {
          box.innerHTML = '<div class="mng-empty">No classes yet. Add one above.</div>';
          count.textContent = "";
          return;
        }
        box.innerHTML = rows.map(function (c) {
          var n = Number(c.student_count) || 0;
          var del = n > 0
            ? '<button type="button" class="mng-action-pill del" disabled title="Remove students first">Delete</button>'
            : '<button type="button" class="mng-action-pill del" data-act="del" data-id="' + Number(c.id) +
              '" data-name="' + esc(c.class_name) + '">Delete</button>';
          return '<div class="mng-row">' +
            '<div class="mng-row-main">' + esc(c.class_name) +
              '<div class="mng-row-sub">' + n + " student" + (n === 1 ? "" : "s") + "</div></div>" +
            '<span class="mng-chip">' + n + "</span>" +
            '<div class="mng-row-actions">' +
              '<button type="button" class="mng-action-pill edit" data-act="ren" data-id="' + Number(c.id) +
                '" data-name="' + esc(c.class_name) + '">Rename</button>' +
              del +
            "</div></div>";
        }).join("");
        count.textContent = rows.length + " class" + (rows.length === 1 ? "" : "es");
        box.querySelectorAll("[data-act]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var id = Number(btn.getAttribute("data-id"));
            var name = btn.getAttribute("data-name") || "";
            if (btn.getAttribute("data-act") === "ren") mcOpenRename(id, name);
            else mcDelete(id, name);
          });
        });
      })
      .catch(function () {
        document.getElementById("mcList").innerHTML = '<div class="mng-empty">Could not load classes.</div>';
      });
  };

  window.mcAdd = function () {
    var input = document.getElementById("mcNewName");
    var name = (input.value || "").trim();
    if (!name) {
      if (window.amsToast) window.amsToast("Type a class name first.", "error");
      return;
    }
    fetch("/add-class", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_name: name })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (window.amsToast) window.amsToast(res.d.message || (res.ok ? "Class added." : "Could not add class."), res.ok ? "success" : "error");
        if (res.ok) { input.value = ""; mcLoad(); }
      })
      .catch(function () {
        if (window.amsToast) window.amsToast("Could not add class.", "error");
      });
  };

  window.mcOpenRename = function (id, name) {
    document.getElementById("mcRenameId").value = id;
    document.getElementById("mcRenameOld").value = name;
    document.getElementById("mcRenameNew").value = name;
    document.getElementById("mcRenameOverlay").style.display = "flex";
    document.getElementById("mcRenameNew").focus();
  };

  window.mcCloseRename = function () {
    document.getElementById("mcRenameOverlay").style.display = "none";
  };

  window.mcSaveRename = function () {
    var id = document.getElementById("mcRenameId").value;
    var next = (document.getElementById("mcRenameNew").value || "").trim();
    if (!next) {
      if (window.amsToast) window.amsToast("Type the new class name.", "error");
      return;
    }
    fetch("/api/manage-classes/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_name: next })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (window.amsToast) window.amsToast(res.d.message || (res.ok ? "Renamed." : "Could not rename."), res.ok ? "success" : "error");
        if (res.ok) { mcCloseRename(); mcLoad(); }
      })
      .catch(function () {
        if (window.amsToast) window.amsToast("Could not rename class.", "error");
      });
  };

  window.mcDelete = function (id, name) {
    var go = window.amsConfirm
      ? window.amsConfirm("Delete class?", '"' + name + '" will be removed. This only works if it has 0 students.')
      : Promise.resolve(confirm("Delete class \"" + name + "\"?"));
    go.then(function (ok) {
      if (!ok) return;
      fetch("/api/manage-classes/" + encodeURIComponent(id), { method: "DELETE" })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (window.amsToast) window.amsToast(res.d.message || (res.ok ? "Deleted." : "Could not delete."), res.ok ? "success" : "error");
          if (res.ok) mcLoad();
        })
        .catch(function () {
          if (window.amsToast) window.amsToast("Could not delete class.", "error");
        });
    });
  };
})();
