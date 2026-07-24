/* ==========================================================================
   NEW FILE (pack 24 - owner: "add chat in the side bar"): staff chat page
   logic. Uses ONLY the pack-23/28 routes (/api/messages...).
   --------------------------------------------------------------------------
   CHANGED (pack 27): WhatsApp look - avatars, search, day separators,
   ticks, auto-grow composer, mobile slide-in.
   CHANGED (pack 28 - owner requests):
     1. NEW CHAT - "select who I want to chat with": compose button opens a
        searchable student list (/api/chat-students), tapping one starts a
        brand-new conversation even before the parent ever writes.
     2. VOICE NOTES - mic button records, uploads (/api/messages/voice) and
        renders playable audio bubbles. Audio streams from /voice/:id.
     3. TWO THREADS - office (admin) and class-teacher conversations are
        separate, with little chips marking which is which.
     4. STUDENT INFO - tapping the conversation header opens a
        WhatsApp-style contact card for that student.
     5. Smaller read-ticks (owner found them too big).
   ========================================================================== */
(function () {
  "use strict";

  var allMsgs = [];
  var activeKey = null;          // "sid|thread"
  var pendingThread = null;      // brand-new conversation with no messages yet
  var searchQ = "";
  var meName = "";
  var meRole = "admin";

  var AVA_COLORS = ["#00A884", "#1FA855", "#0B8468", "#2E8BC0", "#7C5CD6", "#C2557A", "#D97706", "#4F7A8C", "#8B7D3A", "#5B6BC0"];

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>\"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function keyOf(sid, thread) { return sid + "|" + (thread === "teacher" ? "teacher" : "admin"); }
  function threadOfMsg(m) {
    // parent mail's thread = who it was sent to; staff replies carry it
    if (m.thread === "teacher" || m.thread === "admin") return m.thread;
    return m.sender_type === "portal" ? (m.recipient_type === "teacher" ? "teacher" : "admin") : "admin";
  }
  function avaColor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVA_COLORS[h % AVA_COLORS.length];
  }
  function initial(name) { return (String(name || "?").trim()[0] || "?"); }

  /* ---- time helpers ---- */
  function dObj(v) {
    var d = new Date(String(v || "").replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function fmtClock(v) {
    var d = dObj(v);
    if (!d) return "";
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m);
  }
  function fmtListTime(v) {
    var d = dObj(v);
    if (!d) return "";
    var now = new Date();
    if (sameDay(d, now)) return fmtClock(v);
    var yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (sameDay(d, yest)) return "Yesterday";
    if ((now - d) / 86400000 < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDayLabel(v) {
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
  function fmtDur(s) {
    s = Math.max(0, Number(s) || 0);
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ":" + (r < 10 ? "0" + r : r);
  }

  function ticksHtml(read) {
    return '<svg viewBox="0 0 18 12" class="' + (read ? "read" : "") + '" fill="currentColor" aria-hidden="true">' +
      '<path d="M12.6.6 5.9 7.9 4 6 2.8 7.2l3.1 3.4L13.8 1.8zM17.2.6l-6.7 7.3-.6-.6-1.1 1.2 1.7 2.1L18.4 1.8z"/>' +
      "</svg>";
  }

  /* staff session required */
  fetch("/me").then(function (r) { return r.json(); }).then(function (me) {
    if (!me || !me.loggedIn) { window.location.replace("login.html"); return; }
    meName = me.username || "";
    meRole = me.role || "admin";
    var line = document.getElementById("chMeLine");
    if (line) line.textContent = "Logged in as " + meName + " (" + meRole + ")";
    loadThreads();
    setInterval(function () { loadThreads(true); }, 30000);
  }).catch(function () { window.location.replace("login.html"); });

  /* group into conversations: one per student PER thread (office / teacher) */
  function groupThreads(rows) {
    var map = {};
    rows.forEach(function (m) {
      var sid = m.sender_type === "portal" ? m.sender_ref : m.recipient_ref;
      if (!sid) return;
      var thread = threadOfMsg(m);
      var k = keyOf(sid, thread);
      if (!map[k]) map[k] = { key: k, sid: sid, thread: thread, name: "", cls: "", last: "", unread: 0, msgs: [] };
      var t = map[k];
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
    // the pending (brand-new) conversation floats to the top until first message
    if (pendingThread && !map[pendingThread.key]) {
      list.unshift(pendingThread);
    } else if (pendingThread && map[pendingThread.key] && map[pendingThread.key].msgs.length) {
      pendingThread = null; // the server now has it - drop the placeholder
    }
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
        if (activeKey) renderConvo(activeKey, true);
      })
      .catch(function () { /* keep old view */ });
  }

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

  function previewText(m) {
    if (!m) return "";
    if (m.kind === "voice") return "\u{1F3A4} Voice note" + (m.duration ? " (" + fmtDur(m.duration) + ")" : "");
    return String(m.body || "").slice(0, 80);
  }

  function renderThreads(threads, quiet) {
    var box = document.getElementById("chThreadList");
    var list = visibleThreads(threads);
    if (!list.length) {
      box.innerHTML = '<div class="ch-listempty">' +
        (searchQ
          ? "No chat matches <b>" + esc(searchQ) + "</b>."
          : 'No chats yet.<br>Tap the &#9998; button above to start one with any parent.') +
        "</div>";
      return;
    }
    box.innerHTML = "";
    list.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ch-thread" + (t.key === activeKey ? " on" : "");
      var name = t.name || t.sid;
      var lastMsg = t.msgs.length ? t.msgs[t.msgs.length - 1] : null;
      var mineLast = lastMsg && lastMsg.sender_type === "staff";
      var ticks = mineLast
        ? '<span class="tk">' + ticksHtml(!!lastMsg.read_at) + "</span> "
        : "";
      var threadChip = '<span class="ch-list-chip' + (t.thread === "teacher" ? " teacher" : "") + '">' +
        (t.thread === "teacher" ? "Class Teacher" : "Office") + "</span>";
      b.innerHTML =
        '<span class="ch-ava" style="background:' + avaColor(name) + ';">' + esc(initial(name)) + "</span>" +
        '<span class="ch-tinfo">' +
          '<span class="ch-trow">' +
            '<span class="ch-tname">' + esc(name) + "</span>" +
            '<span class="ch-ttime' + (t.unread ? " hot" : "") + '">' + esc(fmtListTime(t.last)) + "</span>" +
          "</span>" +
          '<span class="ch-trow2">' +
            '<span class="ch-tprev">' + ticks + esc(previewText(lastMsg)) + "</span>" +
            threadChip +
            (t.unread ? '<span class="ch-unread">' + t.unread + "</span>" : "") +
          "</span>" +
        "</span>";
      b.addEventListener("click", function () { openThread(t.key); });
      box.appendChild(b);
    });
  }

  function openThread(key) {
    activeKey = key;
    document.body.classList.add("ch-open");
    document.getElementById("chProfile").classList.remove("open");
    renderConvo(key);
    renderThreads(groupThreads(allMsgs), true);
    fetch("/api/messages/read", { method: "POST" })
      .then(function () { loadThreads(true); })
      .catch(function () {});
  }

  function threadForKey(key) {
    var t = groupThreads(allMsgs).filter(function (x) { return x.key === key; })[0];
    if (!t && pendingThread && pendingThread.key === key) return pendingThread;
    return t || null;
  }

  function renderConvo(key, isRefresh) {
    var head = document.getElementById("chConvoHead");
    var box = document.getElementById("chMsgs");
    var body = document.getElementById("chBody");
    var send = document.getElementById("chSend");
    var mic = document.getElementById("chMicBtn");
    var t = threadForKey(key);
    if (!t) { activeKey = null; return; }
    var name = t.name || t.sid;

    head.innerHTML =
      '<span class="ch-cava" style="background:' + avaColor(name) + ';">' + esc(initial(name)) + "</span>" +
      '<span class="ch-cmeta">' +
        '<span class="ch-cname">' + esc(name) +
          '<span class="ch-thchip' + (t.thread === "teacher" ? " teacher" : "") + '">' +
            (t.thread === "teacher" ? "Class Teacher" : "Office") + "</span></span>" +
        '<span class="ch-csub">' + esc(t.sid) + (t.cls ? " · " + esc(t.cls) : "") + " · Parent</span>" +
      "</span>";

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
      var bodyHtml;
      if (m.kind === "voice") { // NEW (pack 28): playable voice bubble
        bodyHtml =
          '<div class="ch-audio-wrap">' +
            '<audio controls preload="metadata" src="/voice/' + encodeURIComponent(m.id) + '"></audio>' +
            (m.duration ? '<span class="ch-audio-dur">' + esc(fmtDur(m.duration)) + "</span>" : "") +
          "</div>";
      } else {
        bodyHtml = esc(m.body);
      }
      html +=
        '<div class="ch-row ' + (mine ? "mine" : "theirs") + '">' +
          '<div class="ch-bub">' +
            (mine ? "" : '<div class="ch-who">' + esc(who) + "</div>") +
            bodyHtml +
            '<span class="ch-meta">' + esc(fmtClock(m.created_at)) + (mine ? ticksHtml(!!m.read_at) : "") + "</span>" +
          "</div>" +
        "</div>";
    });
    box.innerHTML = html ||
      '<div class="ch-emptyconvo">No messages here yet. Say salam first - the parent sees it in their portal.</div>';

    if (!isRefresh || nearBottom) box.scrollTop = box.scrollHeight;

    body.disabled = false;
    send.disabled = false;
    mic.disabled = !recorderSupported;
    mic.title = recorderSupported ? "Voice note" : "Voice notes are not supported on this browser";
    if (!isRefresh) body.focus();
  }

  function currentThread() { return threadForKey(activeKey); }

  function sendReply() {
    if (recorder) { stopRecording(true); return; } // while recording, the plane SENDs the voice note
    var body = document.getElementById("chBody");
    var txt = (body.value || "").trim();
    var t = currentThread();
    if (!t || !txt) return;
    var send = document.getElementById("chSend");
    send.disabled = true;
    fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: t.sid, body: txt, thread: t.thread })
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
        if (res.ok) { body.value = ""; growBody(); loadThreads(true); }
      })
      .catch(function () {
        var note = document.getElementById("chNote");
        note.textContent = "Network error - try again.";
        note.className = "ch-note err";
      })
      .finally(function () { send.disabled = false; });
  }

  /* =============== NEW (pack 28): NEW CHAT - pick any parent =============== */
  var newChat = document.getElementById("chNewChat");
  var newSearch = document.getElementById("chNewSearch");
  var newResults = document.getElementById("chNewResults");
  var searchTimer = null;

  function openNewChat() {
    newChat.classList.add("open");
    newChat.setAttribute("aria-hidden", "false");
    newSearch.value = "";
    newResults.innerHTML = '<div class="ch-newhint">Type at least 2 letters to search for a parent.<br>Tap a student to open the chat.</div>';
    setTimeout(function () { newSearch.focus(); }, 120);
  }
  function closeNewChat() {
    newChat.classList.remove("open");
    newChat.setAttribute("aria-hidden", "true");
  }
  document.getElementById("chNewBtn").addEventListener("click", openNewChat);
  document.getElementById("chNewClose").addEventListener("click", closeNewChat);

  newSearch.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var q = newSearch.value.trim();
      if (q.length < 2) {
        newResults.innerHTML = '<div class="ch-newhint">Type at least 2 letters to search for a parent.<br>Tap a student to open the chat.</div>';
        return;
      }
      newResults.innerHTML = '<div class="ch-newhint">Searching...</div>';
      fetch("/api/chat-students?q=" + encodeURIComponent(q))
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
          rows = Array.isArray(rows) ? rows : [];
          if (!rows.length) {
            newResults.innerHTML = '<div class="ch-newhint">No student found for "' + esc(q) + '".' +
              (meRole !== "admin" ? "<br><small>You can only start chats with parents of your own classes.</small>" : "") + "</div>";
            return;
          }
          newResults.innerHTML = "";
          rows.forEach(function (st) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "ch-newrow";
            b.innerHTML =
              '<span class="ch-ava" style="width:42px; height:42px; flex-basis:42px; font-size:16px; background:' + avaColor(st.full_name) + ';">' + esc(initial(st.full_name)) + "</span>" +
              '<span style="flex:1; min-width:0;">' +
                "<b>" + esc(st.full_name) + "</b><br>" +
                '<span class="sub">' + esc(st.student_id) + (st.class_name ? " · " + esc(st.class_name) : "") + "</span>" +
              "</span>";
            b.addEventListener("click", function () { startNewThread(st); });
            newResults.appendChild(b);
          });
        })
        .catch(function () { newResults.innerHTML = '<div class="ch-newhint">Network error - try again.</div>'; });
    }, 280);
  });

  function startNewThread(st) {
    var thread = meRole === "teacher" ? "teacher" : "admin"; // my side of the desk
    var k = keyOf(st.student_id, thread);
    var existing = groupThreads(allMsgs).filter(function (t) { return t.sid === st.student_id; })[0];
    if (existing) k = existing.key; // continue the ONE conversation if it already exists
    pendingThread = existing ? null : { key: k, sid: st.student_id, thread: k.split("|")[1], name: st.full_name, cls: st.class_name || "", last: "", unread: 0, msgs: [] };
    closeNewChat();
    openThread(k);
  }

  /* =============== NEW (pack 28): STUDENT INFO slide-over =============== */
  var profile = document.getElementById("chProfile");
  document.getElementById("chConvoHead").addEventListener("click", function () {
    var t = currentThread();
    if (!t) return;
    var el = document.getElementById("chProfileBody");
    el.innerHTML = '<div class="ch-newhint">Loading student info...</div>';
    profile.classList.add("open");
    profile.setAttribute("aria-hidden", "false");
    fetch("/student/" + encodeURIComponent(t.sid))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var st = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!st) { el.innerHTML = '<div class="ch-newhint">Could not load this student.</div>'; return; }
        var name = st.full_name || t.name || t.sid;
        var photo = st.photo_path ? '<img src="/' + esc(st.photo_path) + '" alt="" onerror="this.style.display=\'none\'">' : esc(initial(name));
        el.innerHTML =
          '<div class="ch-pcard">' +
            '<div class="ch-pava" style="background:' + avaColor(name) + ';">' + photo + "</div>" +
            '<div class="ch-pname">' + esc(name) + "</div>" +
            '<div class="ch-psub">' + esc(st.student_id || t.sid) + (st.class_name ? " · " + esc(st.class_name) : "") + "</div>" +
          "</div>" +
          '<div class="ch-pcard">' +
            prow("Student ID", st.student_id) +
            prow("Class", st.class_name) +
            prow("Gender", st.gender) +
            prow("Date of Birth", st.date_of_birth ? String(st.date_of_birth).slice(0, 10) : "") +
          "</div>" +
          '<div class="ch-pcard">' +
            prow("Parent / Guardian", st.parent_name) +
            (st.parent_phone
              ? '<div class="ch-prow"><div class="lbl">Parent Phone</div><div class="val"><a href="tel:' + esc(String(st.parent_phone).replace(/[^0-9+]/g, "")) + '">&#128222; ' + esc(st.parent_phone) + "</a></div></div>"
              : "") +
            prow("Home Address", st.address) +
          "</div>";
      })
      .catch(function () { el.innerHTML = '<div class="ch-newhint">Network error - try again.</div>'; });
    function prow(lbl, val) {
      if (val == null || val === "") return "";
      return '<div class="ch-prow"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + esc(val) + "</div></div>";
    }
  });
  document.getElementById("chProfileClose").addEventListener("click", function () {
    profile.classList.remove("open");
    profile.setAttribute("aria-hidden", "true");
  });

  /* =============== NEW (pack 28): VOICE NOTES =============== */
  var recorderSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  var recorder = null, recChunks = [], recStart = 0, recTimer = null, recStream = null;
  var micBtn = document.getElementById("chMicBtn");
  if (!recorderSupported) micBtn.disabled = true;

  function pickMime() {
    var cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/mpeg"];
    for (var i = 0; i < cands.length; i++) {
      try { if (MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) {}
    }
    return "";
  }

  micBtn.addEventListener("click", function () {
    if (recorder) { stopRecording(true); return; }
    var t = currentThread();
    if (!t) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recStream = stream;
      recChunks = [];
      var mime = pickMime();
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
      recorder.onstop = function () {
        var blob = new Blob(recChunks, { type: (recorder && recorder.mimeType) || "audio/webm" });
        var sendIt = recorder._amsSend;
        recorder = null;
        if (recStream) { recStream.getTracks().forEach(function (tr) { tr.stop(); }); recStream = null; }
        clearInterval(recTimer);
        document.getElementById("chComposer").classList.remove("recording");
        if (sendIt) uploadVoice(blob, Math.round((Date.now() - recStart) / 1000));
      };
      recStart = Date.now();
      recorder.start(250);
      document.getElementById("chComposer").classList.add("recording");
      var timeEl = document.getElementById("chRecTime");
      timeEl.textContent = "0:00";
      recTimer = setInterval(function () {
        var s = Math.round((Date.now() - recStart) / 1000);
        timeEl.textContent = fmtDur(s);
        if (s >= 120) stopRecording(true); // courteous cap, like WhatsApp
      }, 500);
    }).catch(function () {
      var note = document.getElementById("chNote");
      note.textContent = "Microphone blocked - allow mic access for this site and try again.";
      note.className = "ch-note err";
      setTimeout(function () { note.textContent = "Replies go straight to the parent's portal."; note.className = "ch-note"; }, 4000);
    });
  });

  function stopRecording(andSend) {
    if (!recorder) return;
    recorder._amsSend = !!andSend;
    try { recorder.stop(); } catch (e) {}
  }
  document.getElementById("chRecCancel").addEventListener("click", function () { stopRecording(false); });

  function uploadVoice(blob, seconds) {
    var t = currentThread();
    if (!t) return;
    if (!blob || !blob.size) return;
    if (blob.size > 6 * 1024 * 1024) {
      var n0 = document.getElementById("chNote");
      n0.textContent = "That recording is too large - keep it under 2 minutes.";
      n0.className = "ch-note err";
      return;
    }
    var note = document.getElementById("chNote");
    note.textContent = "Sending voice note...";
    note.className = "ch-note";
    var fd = new FormData();
    var ext = (blob.type || "").indexOf("mp4") !== -1 ? "m4a" : ((blob.type || "").indexOf("ogg") !== -1 ? "ogg" : "webm");
    fd.append("voice", blob, "note." + ext);
    fd.append("student_id", t.sid);
    fd.append("thread", t.thread);
    fd.append("duration", String(Math.max(1, seconds || 1)));
    fetch("/api/messages/voice", { method: "POST", body: fd })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        note.textContent = res.d.message || (res.ok ? "Voice note sent." : "Could not send.");
        note.className = "ch-note " + (res.ok ? "ok" : "err");
        if (res.ok) loadThreads(true);
        setTimeout(function () { note.textContent = "Replies go straight to the parent's portal."; note.className = "ch-note"; }, 3500);
      })
      .catch(function () {
        note.textContent = "Network error - the voice note was not sent.";
        note.className = "ch-note err";
      });
  }

  /* ---------------- composer, search, mobile nav (pack 27, unchanged) ----- */
  var bodyEl = document.getElementById("chBody");
  function growBody() {
    bodyEl.style.height = "auto";
    bodyEl.style.height = Math.min(bodyEl.scrollHeight, 120) + "px";
  }
  bodyEl.addEventListener("input", growBody);

  document.getElementById("chSearch").addEventListener("input", function (ev) {
    searchQ = (ev.target.value || "").trim();
    renderThreads(groupThreads(allMsgs), true);
  });
  document.getElementById("chBackList").addEventListener("click", function () {
    document.body.classList.remove("ch-open");
  });

  document.getElementById("chSend").addEventListener("click", sendReply);
  bodyEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendReply();
    }
  });
})();
