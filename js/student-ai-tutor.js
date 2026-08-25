/* ==========================================================================
   js/student-ai-tutor.js  (pack 37 - owner: "give student ai chat for
   learning at home")
   --------------------------------------------------------------------------
   Drives the AI LEARNING TUTOR page (student-ai-tutor.html) inside the
   Student & Parent Portal:
     * Multi-turn chat with the school AI wearing its TUTOR hat - lessons
       are explained step by step, practice questions are made on demand
       and quizzes are gentle. The chat is remembered on this device until
       "New" is pressed.
     * Only portal users (Student ID + surname) may chat; the server adds
       the student's first name + class so answers are age-appropriate.
     * If the school AI is not switched on yet, the child sees a friendly
       "coming soon" note (the admin switch-on card never appears here).
     * The AI tutor only teaches - it never sees results, fees, attendance
       or any private record.
   ========================================================================== */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, kind) {
    if (window.amsToast) window.amsToast(msg, kind || "info", 4200);
  }
  function jget(url) {
    return fetch(url).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    });
  }
  function jpost(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    });
  }

  /* ---------------- state ---------------- */
  var me = null;            // { student: { full_name, class_name, ... } }
  var aiOn = false;
  var chat = [];            // [{role, content, at}]
  var busy = false;
  var STORE_KEY = "amsStudentAiChat.v1";

  function saveChat() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(chat.slice(-60))); } catch (e) {}
  }
  function loadChat() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return (Array.isArray(arr) ? arr : []).filter(function (m) {
        return m && (m.role === "user" || m.role === "assistant") && m.content;
      });
    } catch (e) { return []; }
  }

  function firstName() {
    return me && me.student && me.student.full_name
      ? String(me.student.full_name).trim().split(/\s+/)[0]
      : "";
  }

  /* ---------------- rendering ---------------- */
  function fmtTime(at) {
    var d = at ? new Date(at) : new Date();
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m);
  }

  /* tiny markdown: **bold**, lists keep their marker, rest is plain text */
  function mdLite(text) {
    var lines = String(text || "").split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = esc(lines[i]);
      ln = ln.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      ln = ln.replace(/`([^`]+)`/g, "<code style='background:#f0f4f1;padding:1px 5px;border-radius:5px;font-size:12.5px;'>$1</code>");
      var lst = ln.match(/^(\s*(?:[-•]|\d{1,2}[.)]))\s+(.*)$/);
      if (lst) {
        ln = '<span style="display:inline-block;min-width:20px;color:#0f6a44;font-weight:800;">' + lst[1] + "</span>" + lst[2];
      }
      out.push(ln);
    }
    return out.join("<br>");
  }

  function bubble(role, content, at, opts) {
    opts = opts || {};
    var row = document.createElement("div");
    row.className = "tut-msg " + (role === "user" ? "me" : "bot");
    var html = "";
    if (role !== "user") html += '<span class="bot-ic">&#127891;</span>';
    html += '<div class="tut-bub">' +
            '<div class="tut-body">' + (opts.raw ? esc(content) : mdLite(content)) + "</div>" +
            '<span class="tut-meta">' + esc(fmtTime(at)) + "</span>";
    if (role !== "user" && !opts.typing) {
      html += '<br><button type="button" class="tut-copy" title="Copy this answer">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
              "<span>copy</span></button>";
    }
    html += "</div>";
    row.innerHTML = html;
    if (role !== "user" && !opts.typing) {
      row.querySelector(".tut-copy").addEventListener("click", function () {
        var txt = String(content || "");
        function done() { toast("Copied ✓", "success"); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
        } else { fallbackCopy(txt); done(); }
      });
    }
    return row;
  }
  function fallbackCopy(txt) {
    var ta = document.createElement("textarea");
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  function typingBubble() {
    var row = document.createElement("div");
    row.className = "tut-msg bot tut-typing";
    row.innerHTML = '<span class="bot-ic">&#127891;</span><div class="tut-bub"><span class="dt"></span><span class="dt"></span><span class="dt"></span></div>';
    return row;
  }

  function scrollBottom(smooth) {
    var log = $("tutLog");
    log.scrollTo({ top: log.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function renderAll() {
    var col = $("tutCol");
    col.innerHTML = '<div class="tut-chipday">Today</div>';
    var landing = document.createElement("div");
    landing.id = "tutLanding";
    col.appendChild(landing);
    if (!chat.length) paintLanding();
    chat.forEach(function (m) { col.appendChild(bubble(m.role, m.content, m.at)); });
    scrollBottom(false);
  }

  /* ---------------- landing ---------------- */
  function paintLanding() {
    var land = $("tutLanding");
    if (!land) return;
    if (aiOn) {
      var saySalam = firstName() ? "As-salaamu alaykum, " + esc(firstName()) + "! &#128075;" : "As-salaamu alaykum! &#128075;";
      land.innerHTML =
        '<div class="tut-welcome">' +
          '<div class="big">&#127891;</div>' +
          "<h2>" + saySalam + "</h2>" +
          "<p>I am your AI learning tutor. Ask me to explain any lesson, help with homework, or quiz you on anything - Arabic, Qur'an, Maths, English, Science and more. We learn step by step, together!</p>" +
          '<div class="tut-sugg">' +
            '<button type="button" data-q="Please explain fractions to me step by step, with an easy example.">&#9881;&#65039; Explain fractions</button>' +
            '<button type="button" data-q="Quiz me with 5 easy questions on Surah Al-Fatihah.">&#128214; Quiz me on Al-Fatihah</button>' +
            '<button type="button" data-q="Help me understand Tawheed - what does it mean, in simple words?">&#128161; Understand Tawheed</button>' +
            '<button type="button" data-q="Give me 5 practice questions on Arabic present-tense verbs.">&#9998;&#65039; Arabic verbs practice</button>' +
            '<button type="button" data-q="I have homework on photosynthesis but I dont understand it. Teach me please.">&#128218; Help with homework</button>' +
          "</div>" +
          '<div class="tut-note">&#9432; The tutor only teaches - it cannot see your results or school records. Ask your class teacher about those.</div>' +
        "</div>";
      land.querySelectorAll("button[data-q]").forEach(function (b) {
        b.addEventListener("click", function () {
          var inp = $("tutInput");
          inp.value = b.getAttribute("data-q");
          autoGrow();
          inp.focus();
          send();
        });
      });
    } else {
      land.innerHTML =
        '<div class="tut-welcome">' +
          "<h2>&#9200; Almost ready&hellip;</h2>" +
          "<p>The AI tutor is not switched on yet - the school office can switch it on in one minute. Please check back very soon, everything else in the portal works as usual.</p>" +
          '<div class="tut-note">&#9432; Tip for the office: open <b>AI Chat</b> from the staff dashboard to switch the school AI on. The tutor wakes up at the same time.</div>' +
        "</div>";
    }
  }

  /* ---------------- header state ---------------- */
  function setState(on) {
    aiOn = !!on;
    var dot = $("tutDot"), st = $("tutState");
    dot.className = "tut-dot" + (on ? "" : " off");
    st.textContent = on ? "online - ready to learn" : "not switched on yet";
    $("tutInput").disabled = !on;
    $("tutSend").disabled = !on;
    renderAll();
    if (on) $("tutInput").focus();
  }

  /* ---------------- sending ---------------- */
  function send() {
    var inp = $("tutInput");
    var text = inp.value.trim();
    if (!text || busy || !aiOn) return;
    busy = true;
    inp.value = "";
    autoGrow();
    chat.push({ role: "user", content: text, at: Date.now() });
    saveChat();
    var col = $("tutCol");
    col.appendChild(bubble("user", text, Date.now(), { raw: true }));
    var typing = typingBubble();
    col.appendChild(typing);
    scrollBottom(true);

    jpost("/api/ai/student-chat", {
      messages: chat.map(function (m) { return { role: m.role, content: m.content }; })
    }).then(function (res) {
      typing.remove();
      if (res.ok && res.d && res.d.reply) {
        chat.push({ role: "assistant", content: res.d.reply, at: Date.now() });
        saveChat();
        col.appendChild(bubble("assistant", res.d.reply, Date.now()));
      } else {
        var msg = (res.d && res.d.error) || "The AI tutor is resting - please try again in a moment.";
        col.appendChild(bubble("assistant", "\u26A0\uFE0E " + msg, Date.now(), { raw: true }));
        if (res.status === 503) setState(false);
      }
      scrollBottom(true);
    }).catch(function () {
      typing.remove();
      col.appendChild(bubble("assistant", "\u26A0\uFE0E Network error - check your connection and try again.", Date.now(), { raw: true }));
      scrollBottom(true);
    }).finally(function () {
      busy = false;
      $("tutInput").focus();
    });
  }

  function autoGrow() {
    var inp = $("tutInput");
    inp.style.height = "auto";
    inp.style.height = Math.min(132, inp.scrollHeight) + "px";
  }

  /* ---------------- wiring ---------------- */
  function boot() {
    jget("/portal/me").then(function (res) {
      var d = res && res.d;
      if (!d || !d.loggedIn || !d.student) { window.location.replace("portal-login.html"); return; }
      me = d;
      chat = loadChat();
      return jget("/api/ai/status").then(function (r2) {
        setState(!!(r2 && r2.d && r2.d.enabled));
      });
    }).catch(function () { window.location.replace("portal-login.html"); });

    $("tutSend").addEventListener("click", send);
    $("tutInput").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); }
    });
    $("tutInput").addEventListener("input", autoGrow);
    $("tutNewBtn").addEventListener("click", function () {
      if (chat.length && !confirm("Start a fresh lesson? The current conversation is cleared from this device.")) return;
      chat = [];
      saveChat();
      renderAll();
      $("tutInput").focus();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
