/* ==========================================================================
   NEW FILE (pack 24 - owner: "add chat in the side bar"): staff chat page
   logic. Uses ONLY the pack-23 routes (/api/messages...). Threads are
   grouped per student; opening a thread marks incoming mail as read.

   CHANGED (pack 25 - owner: confidentiality): teachers see ONLY
   conversations for their own assigned classes; admin sees all.

   CHANGED (pack 26): "New Conversation" button lets staff write to any
   student's parent FIRST, before the parent has messaged. Uses the
   existing POST /api/messages endpoint (it accepts any student_id).
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
    if (head) head.textContent = "Pick a conversation \u2013 logged in as " + me.username + " (" + me.role + ")";
    /* NEW (pack 26): wire the New Conversation form */
    wireNewConvo();
    loadThreads();
    setInterval(function () { loadThreads(true); }, 30000); // gentle live refresh
  }).catch(function () { window.location.replace("login.html"); });

  /* -----------------------------------------------------------------------
     NEW (pack 26): "New Conversation" - staff types a student ID and a
     first message; POST /api/messages creates the thread immediately so
     the parent sees it the next time they open Chat in the portal.
     ----------------------------------------------------------------------- */
  function wireNewConvo() {
    var btn  = document.getElementById("chNewBtn");
    var form = document.getElementById("chNewForm");
    var cancel = document.getElementById("chNewCancel");
    var send = document.getElementById("chNewSend");
    var note = document.getElementById("chNewNote");
    if (!btn || !form) return;

    btn.addEventListener("click", function () {
      form.style.display = form.style.display === "none" ? "block" : "none";
      if (form.style.display === "block") {
        document.getElementById("chNewSid").focus();
        note.textContent = "";
      }
    });
    if (cancel) cancel.addEventListener("click", function () { form.style.display = "none"; note.textContent = ""; });

    if (send) send.addEventListener("click", function () {
      var sid  = (document.getElementById("chNewSid").value || "").trim();
      var body = (document.getElementById("chNewBody").value || "").trim();
      if (!sid || !body) { note.textContent = "Enter both the Student ID and your message."; return; }
      send.disabled = true;
      fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: sid, body: body })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          note.textContent = res.d.message || "";
          if (res.ok) {
            document.getElementById("chNewSid").value = "";
            document.getElementById("chNewBody").value = "";
            form.style.display = "none";
            loadThreads(false); // refresh thread list so new convo appears
            openThread(sid);    // jump into it immediately
          }
        })
        .catch(function () { note.textContent = "Network error \u2013 try again."; })
        .finally(function () { send.disabled = false; });
    });

    /* pressing Enter in the body field also sends */
    var bodyEl = document.getElementById("chNewBody");
    if (bodyEl) bodyEl.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); if (send) send.click(); }
    });
  }

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
      if (m.sender_type === "staff" && !t.name && m.recipient_ref === sid) {
        /* staff-initiated thread: we only have recipient_ref, not a name yet */
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
      if (!quiet) box.innerHTML = '<div class="ch-empty">No parent messages yet. When a parent writes from the portal it lands here.<br><br>You can also start a conversation using the button above.</div>';
      return;
    }
    box.innerHTML = "";
    threads.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ch-thread" + (t.sid === activeSid ? " on" : "");
      var lastMsg = t.msgs.length ? t.msgs[t.msgs.length - 1] : null;
      var lastBody = lastMsg ? (lastMsg.body || "") : "";
      var lastDir  = lastMsg && lastMsg.sender_type === "staff" ? "\u21A4 " : ""; // ↤ = you replied
      b.innerHTML =
        (t.unread ? '<span class="ch-dot">' + t.unread + "</span>" : "") +
        "<b>" + esc(t.name || t.sid) + "</b>" +
        "<span>" + esc(t.sid) + (t.cls ? " \u00B7 " + esc(t.cls) : "") + "</span>" +
        "<span>" + lastDir + esc(lastBody.slice(0, 60)) + "</span>";
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
    }).join("") || '<div class="ch-empty">No messages yet. Your message above will be the first.</div>';
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
      .catch(function () { document.getElementById("chNote").textContent = "Network error \u2013 try again."; })
      .finally(function () { send.disabled = false; });
  }

  document.getElementById("chSend").addEventListener("click", sendReply);
  document.getElementById("chBody").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") sendReply();
  });
})();
