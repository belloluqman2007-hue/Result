/* ==========================================================================
   NEW FILE (pack 24 - owner: "add chat in the side bar"): staff chat page
   logic. Uses ONLY the pack-23 routes (/api/messages...). Threads are
   grouped per student; opening a thread marks incoming mail as read.
   --------------------------------------------------------------------------
   CHANGED (pack 27 - owner: "Make the chat be like Whatsapp"): WhatsApp
   behaviours added on top of the same routes - round coloured avatars,
   live search, day separators, per-message time with double-tick read
   receipts (blue once the parent opens the portal chat), Enter-to-send
   auto-growing composer, and a mobile slide-in view with a back arrow.
   ========================================================================== */
(function () {
  "use strict";

  var allMsgs = [];
  var activeSid = null;
  var searchQ = "";
  var meName = "";

  /* WhatsApp-style muted avatar palette (picked deterministically by name) */
  var AVA_COLORS = ["#00A884", "#1FA855", "#0B8468", "#2E8BC0", "#7C5CD6", "#C2557A", "#D97706", "#4F7A8C", "#8B7D3A", "#5B6BC0"];

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>\"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function avaColor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVA_COLORS[h % AVA_COLORS.length];
  }

  function initial(name) {
    var clean = String(name || "?").trim();
    return (clean[0] || "?");
  }

  /* ---- time helpers (WhatsApp style) ---- */
  function dObj(v) {
    var d = new Date(String(v || "").replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function fmtClock(v) {
    var d = dObj(v);
    if (!d) return "";
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m);
  }
  function fmtListTime(v) { // list column: clock today, weekday this week, date older
    var d = dObj(v);
    if (!d) return "";
    var now = new Date();
    if (sameDay(d, now)) return fmtClock(v);
    var yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (sameDay(d, yest)) return "Yesterday";
    var diff = (now - d) / 86400000;
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDayLabel(v) { // day separator pill inside the conversation
    var d = dObj(v);
    if (!d) return "";
    var now = new Date();
    if (sameDay(d, now)) return "Today";
    var yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (sameDay(d, yest)) return "Yesterday";
    var lbl = d.getDate() + " " + MONTHS[d.getMonth()];
    if (d.getFullYear() !== now.getFullYear()) lbl += " " + d.getFullYear();
    return lbl;
  }

  /* double-tick icon; blue once the other side has read it */
  function ticksHtml(read) {
    return '<svg viewBox="0 0 18 12" class="' + (read ? "read" : "") + '" fill="currentColor" aria-hidden="true">' +
      '<path d="M12.6.6 5.9 7.9 4 6 2.8 7.2l3.1 3.4L13.8 1.8zM17.2.6l-6.7 7.3-.6-.6-1.1 1.2 1.7 2.1L18.4 1.8z"/>' +
      '<path d="M10.1.6 3.4 7.9l-.3-.3L2 8.8l1.7 1.8L11.3 1.8z" opacity="0"/>' +
      "</svg>";
  }

  /* staff session required (same guard style as other pages) */
  fetch("/me").then(function (r) { return r.json(); }).then(function (me) {
    if (!me || !me.loggedIn) { window.location.replace("login.html"); return; }
    meName = me.username || "";
    var line = document.getElementById("chMeLine");
    if (line) line.textContent = "Logged in as " + meName + " (" + me.role + ")";
    loadThreads();
    setInterval(function () { loadThreads(true); }, 30000); // gentle live refresh (unchanged)
  }).catch(function () { window.location.replace("login.html"); });

  /* group every message by the student it concerns (logic unchanged from pack 24) */
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
        if (activeSid) renderConvo(activeSid, true); // keep open conversation fresh
      })
      .catch(function () { /* keep old view */ });
  }

  /* NEW (pack 27): live search across names, IDs, classes and message text */
  function visibleThreads(threads) {
    if (!searchQ) return threads;
    var q = searchQ.toLowerCase();
    return threads.filter(function (t) {
      if ((t.name || "").toLowerCase().indexOf(q) !== -1) return true;
      if (t.sid.toLowerCase().indexOf(q) !== -1) return true;
      if ((t.cls || "").toLowerCase().indexOf(q) !== -1) return true;
      return t.msgs.some(function (m) { return (m.body || "").toLowerCase().indexOf(q) !== -1; });
    });
  }

  function renderThreads(threads, quiet) {
    var box = document.getElementById("chThreadList");
    var list = visibleThreads(threads);
    if (!list.length) {
      box.innerHTML = '<div class="ch-listempty">' +
        (searchQ
          ? "No chat matches <b>" + esc(searchQ) + "</b>."
          : "No parent messages yet.<br>When a parent writes from the portal the chat lands here.") +
        "</div>";
      return;
    }
    box.innerHTML = "";
    list.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ch-thread" + (t.sid === activeSid ? " on" : "");
      var name = t.name || t.sid;
      var lastMsg = t.msgs.length ? t.msgs[t.msgs.length - 1] : null;
      var lastBody = lastMsg ? lastMsg.body : "";
      var mineLast = lastMsg && lastMsg.sender_type === "staff";
      var ticks = mineLast
        ? '<span class="tk' + (lastMsg.read_at ? "" : " off") + '">' + ticksHtml(!!lastMsg.read_at) + "</span> "
        : "";
      b.innerHTML =
        '<span class="ch-ava" style="background:' + avaColor(name) + ';">' + esc(initial(name)) + "</span>" +
        '<span class="ch-tinfo">' +
          '<span class="ch-trow">' +
            '<span class="ch-tname">' + esc(name) + "</span>" +
            '<span class="ch-ttime' + (t.unread ? " hot" : "") + '">' + esc(fmtListTime(t.last)) + "</span>" +
          "</span>" +
          '<span class="ch-trow2">' +
            '<span class="ch-tprev">' + ticks + esc(lastBody.slice(0, 80)) + "</span>" +
            (t.unread ? '<span class="ch-unread">' + t.unread + "</span>" : "") +
          "</span>" +
        "</span>";
      b.addEventListener("click", function () { openThread(t.sid); });
      box.appendChild(b);
    });
  }

  function openThread(sid) {
    activeSid = sid;
    document.body.classList.add("ch-open"); // NEW (pack 27): mobile slides to the conversation
    renderConvo(sid);
    renderThreads(groupThreads(allMsgs), true);
    // opening = reading (server marks all visible parent mail as read - unchanged)
    fetch("/api/messages/read", { method: "POST" })
      .then(function () { loadThreads(true); })
      .catch(function () {});
  }

  function renderConvo(sid, isRefresh) {
    var head = document.getElementById("chConvoHead");
    var box = document.getElementById("chMsgs");
    var body = document.getElementById("chBody");
    var send = document.getElementById("chSend");
    var t = groupThreads(allMsgs).filter(function (x) { return x.sid === sid; })[0];
    if (!t) { activeSid = null; return; }
    var name = t.name || sid;

    // WhatsApp conversation header: avatar + name + "id · class" subtitle
    head.innerHTML =
      '<span class="ch-cava" style="background:' + avaColor(name) + ';">' + esc(initial(name)) + "</span>" +
      '<span class="ch-cmeta">' +
        '<span class="ch-cname">' + esc(name) + "</span>" +
        '<span class="ch-csub">' + esc(sid) + (t.cls ? " · " + esc(t.cls) : "") + " · Parent</span>" +
      "</span>";

    // keep the user's scroll position on background refresh; pin to bottom only
    // when they were already reading the newest messages (WhatsApp behaviour).
    var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;

    var html = "";
    var lastDay = "";
    t.msgs.forEach(function (m) {
      var day = fmtDayLabel(m.created_at);
      if (day && day !== lastDay) {
        html += '<div class="ch-daywrap"><span class="ch-day">' + esc(day) + "</span></div>";
        lastDay = day;
      }
      var mine = m.sender_type === "staff";
      var who = mine ? "" : (m.sender_name || "Parent");
      html +=
        '<div class="ch-row ' + (mine ? "mine" : "theirs") + '">' +
          '<div class="ch-bub">' +
            (mine ? "" : '<div class="ch-who">' + esc(who) + "</div>") +
            esc(m.body) +
            '<span class="ch-meta">' + esc(fmtClock(m.created_at)) + (mine ? ticksHtml(!!m.read_at) : "") + "</span>" +
          "</div>" +
        "</div>";
    });
    box.innerHTML = html ||
      '<div class="ch-emptyconvo">No messages in this conversation yet. Say salam first - the parent sees it in their portal.</div>';

    if (!isRefresh || nearBottom) box.scrollTop = box.scrollHeight;

    body.disabled = false;
    send.disabled = false;
    if (!isRefresh) body.focus();
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
        if (note) {
          note.textContent = res.d.message || "";
          note.className = "ch-note " + (res.ok ? "ok" : "err");
          setTimeout(function () {
            note.textContent = "Replies go straight to the parent's portal.";
            note.className = "ch-note";
          }, 3500);
        }
        if (res.ok) {
          body.value = "";
          growBody(); // NEW (pack 27): shrink the composer back after sending
          loadThreads(true);
        }
      })
      .catch(function () {
        var note = document.getElementById("chNote");
        note.textContent = "Network error - try again.";
        note.className = "ch-note err";
      })
      .finally(function () { send.disabled = false; });
  }

  /* NEW (pack 27): auto-growing composer (max height handled in CSS) */
  var bodyEl = document.getElementById("chBody");
  function growBody() {
    bodyEl.style.height = "auto";
    bodyEl.style.height = Math.min(bodyEl.scrollHeight, 120) + "px";
  }
  bodyEl.addEventListener("input", growBody);

  /* NEW (pack 27): live search box */
  document.getElementById("chSearch").addEventListener("input", function (ev) {
    searchQ = (ev.target.value || "").trim();
    renderThreads(groupThreads(allMsgs), true);
  });

  /* NEW (pack 27): mobile back arrow returns to the chat list */
  document.getElementById("chBackList").addEventListener("click", function () {
    document.body.classList.remove("ch-open");
  });

  /* Enter sends, Shift+Enter makes a new line (WhatsApp behaviour) */
  document.getElementById("chSend").addEventListener("click", sendReply);
  bodyEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendReply();
    }
  });
})();
