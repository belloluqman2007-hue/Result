/* ==========================================================================
   NEW FILE (pack 24 - owner: "add chat in the side bar"): staff chat page
   logic. Uses ONLY the pack-23 routes (/api/messages...). Threads are
   grouped per student; opening a thread marks incoming mail as read.
   ========================================================================== */
(function () {
  "use strict";

  var allMsgs = [];
  var activeSid = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* staff session required (same guard style as other pages) */
  fetch("/me").then(function (r) { return r.json(); }).then(function (me) {
    if (!me || !me.loggedIn) { window.location.replace("login.html"); return; }
    var head = document.getElementById("chConvoHead");
    if (head) head.textContent = "Pick a conversation - logged in as " + me.username + " (" + me.role + ")";
    loadThreads();
    setInterval(function () { loadThreads(true); }, 30000); // gentle live refresh
  }).catch(function () { window.location.replace("login.html"); });

  /* group every message by the student it concerns */
  function groupThreads(rows) {
    var map = {};
    rows.forEach(function (m) {
      var sid = m.sender_type === "portal" ? m.sender_ref : m.recipient_ref;
      if (!sid) return;
      if (!map[sid]) map[sid] = { sid: sid, name: "", cls: "", last: "", unread: 0, msgs: [] };
      var t = map[sid];
      t.msgs.push(m);
      if (m.sender_type === "portal") {
        if (!t.name && m.sender_name) t.name = m.sender_name;
        if (!t.cls && m.recipient_class) t.cls = m.recipient_class;
        if (!m.read_at) t.unread++;
      }
      if (String(m.created_at) > String(t.last)) t.last = String(m.created_at);
    });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.sort(function (a, b) { return String(b.last).localeCompare(String(a.last)); });
    list.forEach(function (t) {
      t.msgs.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    });
    return list;
  }

  function loadThreads(quiet) {
    fetch("/api/messages")
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        allMsgs = Array.isArray(rows) ? rows : [];
        renderThreads(groupThreads(allMsgs), quiet);
        if (activeSid) renderConvo(activeSid); // keep open conversation fresh
      })
      .catch(function () { /* keep old view */ });
  }

  function renderThreads(threads, quiet) {
    var box = document.getElementById("chThreadList");
    if (!threads.length) {
      if (!quiet) box.innerHTML = '<div class="ch-empty">No parent messages yet. When a parent writes from the portal it lands here.</div>';
      return;
    }
    box.innerHTML = "";
    threads.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ch-thread" + (t.sid === activeSid ? " on" : "");
      var lastBody = t.msgs.length ? t.msgs[t.msgs.length - 1].body : "";
      b.innerHTML =
        (t.unread ? '<span class="ch-dot">' + t.unread + "</span>" : "") +
        "<b>" + esc(t.name || t.sid) + "</b>" +
        "<span>" + esc(t.sid) + (t.cls ? " \u00B7 " + esc(t.cls) : "") + "</span>" +
        "<span>" + esc(lastBody.slice(0, 60)) + "</span>";
      b.addEventListener("click", function () { openThread(t.sid); });
      box.appendChild(b);
    });
  }

  function openThread(sid) {
    activeSid = sid;
    renderConvo(sid);
    renderThreads(groupThreads(allMsgs), true);
    // opening = reading (server marks all visible parent mail as read)
    fetch("/api/messages/read", { method: "POST" })
      .then(function () { loadThreads(true); })
      .catch(function () {});
  }

  function renderConvo(sid) {
    var head = document.getElementById("chConvoHead");
    var box = document.getElementById("chMsgs");
    var body = document.getElementById("chBody");
    var send = document.getElementById("chSend");
    var t = groupThreads(allMsgs).filter(function (x) { return x.sid === sid; })[0];
    if (!t) { activeSid = null; return; }
    head.textContent = (t.name || sid) + "  \u00B7  " + sid + (t.cls ? "  \u00B7  " + t.cls : "");
    box.innerHTML = t.msgs.map(function (m) {
      var mine = m.sender_type === "staff";
      var who = mine ? (m.sender_name || "Staff") : (m.sender_name || "Parent");
      var when = String(m.created_at || "").replace("T", " ").slice(0, 16);
      return '<div class="ch-bub ' + (mine ? "staff" : "parent") + '">' +
        '<div class="ch-meta">' + esc(who) + " \u00B7 " + esc(when) + "</div>" + esc(m.body) + "</div>";
    }).join("") || '<div class="ch-empty">No messages in this conversation yet.</div>';
    box.scrollTop = box.scrollHeight;
    body.disabled = false;
    send.disabled = false;
    body.focus();
  }

  function sendReply() {
    var body = document.getElementById("chBody");
    var txt = (body.value || "").trim();
    if (!activeSid || !txt) return;
    var send = document.getElementById("chSend");
    send.disabled = true;
    fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: activeSid, body: txt })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        var note = document.getElementById("chNote");
        if (note) note.textContent = res.d.message || "";
        if (res.ok) { body.value = ""; loadThreads(true); }
      })
      .catch(function () { document.getElementById("chNote").textContent = "Network error - try again."; })
      .finally(function () { send.disabled = false; });
  }

  document.getElementById("chSend").addEventListener("click", sendReply);
  document.getElementById("chBody").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") sendReply();
  });
})();
