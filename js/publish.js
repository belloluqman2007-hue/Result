/* ==========================================================================
   NEW FILE (pack 13) - js/publish.js
   Admin publishes/unpublishes results per class OR for the whole term.
   Students/parents only ever see what is published. Server enforces
   requireAdmin on saving - this page is just the friendly front-end.
   ========================================================================== */
"use strict";

function pubNotify(text, ok) {
  var msg = document.getElementById("pubMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  if (window.amsToast) amsToast(text, ok ? "success" : "error");
  setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function loadPublishState() {
  var term = document.getElementById("pubTerm").value;
  var session = document.getElementById("pubSession").value.trim();
  if (!term || !session) { pubNotify("Pick the Term and type the Session first (e.g. 2026/2027).", false); return; }

  var classesP = fetch("/classes").then(function (r) { return r.json(); });
  var stateP = fetch("/result-publish?term=" + encodeURIComponent(term) + "&session=" + encodeURIComponent(session))
    .then(function (r) { return r.json(); });

  Promise.all([classesP, stateP])
    .then(function (res) {
      var classes = Array.isArray(res[0]) ? res[0] : [];
      var state = Array.isArray(res[1]) ? res[1] : [];
      renderPublishTable(classes, state, term, session);
    })
    .catch(function () { pubNotify("Could not load classes. Check your internet.", false); });
}

function renderPublishTable(classes, state, term, session) {
  var wrap = document.getElementById("pubWholeWrap");
  var tbody = document.querySelector("#pubTable tbody");
  tbody.innerHTML = "";

  // Whole-term row (class_name '' on the server)
  var whole = state.find(function (r) { return r.class_name === ""; });
  var wholeOn = !!(whole && Number(whole.published) === 1);
  document.getElementById("pubWholeToggle").checked = wholeOn;
  document.getElementById("pubWholeLabel").textContent =
    "Publish ALL classes for " + term + " - " + session + (wholeOn ? "  (currently ON)" : "");

  if (!classes.length) {
    tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#5B6B62;">No classes found. Add classes first.</td></tr>';
  }

  classes.forEach(function (c) {
    var name = c.class_name;
    var row = state.find(function (r) { return r.class_name === name; });
    var on = !!(row && Number(row.published) === 1);

    var tr = document.createElement("tr");

    var tdName = document.createElement("td");
    tdName.innerHTML = "<b></b>";
    tdName.querySelector("b").textContent = name;
    tr.appendChild(tdName);

    var tdSw = document.createElement("td");
    var label = document.createElement("label");
    label.className = "sw";
    label.style.verticalAlign = "middle";
    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = on;
    input.addEventListener("change", function () { savePublish(name, input.checked, input); });
    var track = document.createElement("span");
    track.className = "sw-track";
    label.appendChild(input);
    label.appendChild(track);

    var stateText = document.createElement("span");
    stateText.style.marginLeft = "12px";
    stateText.style.fontSize = "12.5px";
    stateText.style.fontWeight = "700";
    stateText.textContent = on ? "Visible" : "Hidden";
    stateText.style.color = on ? "#157347" : "#5B6B62";
    input.addEventListener("change", function () {
      stateText.textContent = input.checked ? "Visible" : "Hidden";
      stateText.style.color = input.checked ? "#157347" : "#5B6B62";
    });

    tdSw.appendChild(label);
    tdSw.appendChild(stateText);
    tr.appendChild(tdSw);
    tbody.appendChild(tr);
  });

  wrap.style.display = "block";
}

function savePublish(className, publish, toggleEl) {
  var term = document.getElementById("pubTerm").value;
  var session = document.getElementById("pubSession").value.trim();
  toggleEl.disabled = true;

  fetch("/result-publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ class_name: className, term: term, session: session, published: publish ? 1 : 0 })
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (!res.ok) {
        toggleEl.checked = !publish; // revert UI
        pubNotify(res.d.message || "Could not save. (Admin account required.)", false);
        return;
      }
      var who = className === "" ? "ALL classes" : className;
      pubNotify((publish ? "\u2705 Published: " : "\u{1F512} Unpublished: ") + who + " - " + term + " - " + session, true);
    })
    .catch(function () {
      toggleEl.checked = !publish;
      pubNotify("Network error - the change was NOT saved.", false);
    })
    .finally(function () { toggleEl.disabled = false; });
}


// NEW (pack 14): fill the session datalist with the sessions the admin
// created on the School Settings page (falls back to HTML defaults).
(function () {
  fetch("/sessions").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    var list = document.getElementById("pubSessionList");
    if (!list) return;
    list.innerHTML = "";
    rows.forEach(function (row) {
      var opt = document.createElement("option");
      opt.value = row.session;
      opt.textContent = row.session + (Number(row.is_current) === 1 ? " (current)" : "");
      list.appendChild(opt);
    });
  }).catch(function () { /* keep HTML defaults */ });
})();
