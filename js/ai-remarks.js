/* ==========================================================================
   CHANGED (pack 29 - owner: "I don't need the ai remark remove it and turn
   it to chat. Chatting with ai effectively and fluently, and make all the
   ai working"): this file used to drive the one-note "AI Remarks" table.
   It now drives the STAFF AI CHAT page (ai-remarks.html):

     * Fluent multi-turn chat with the school AI. The page keeps the
       conversation and posts it to /api/ai/chat each time; the server adds
       the school voice and talks to the AI service. History is remembered
       on this device (localStorage) until "New" is pressed.
     * If the AI has no key yet, an ADMIN sees a one-minute switch-on card
       (paste free key -> POST /api/ai/config -> saved inside the app) which
       wakes up EVERY AI feature; teachers see a friendly "coming soon".
     * Nothing here touches results, report cards, chats with parents or
       any part of the database - it is a helper only.
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
  var me = null;            // { username, role }
  var aiOn = false;         // server says there is a working key
  var chat = [];            // [{role:'user'|'assistant', content, at}]
  var busy = false;
  var STORE_KEY = "amsStaffAiChat.v1";

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

  /* ---------------- rendering ---------------- */
  function fmtTime(at) {
    var d = at ? new Date(at) : new Date();
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m);
  }

  /* tiny markdown: **bold**, list lines keep their bullet/number, rest is
     plain text with line breaks. Everything is HTML-escaped first. */
  function mdLite(text) {
    var lines = String(text || "").split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = esc(lines[i]);
      ln = ln.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      ln = ln.replace(/`([^`]+)`/g, "<code style='background:#f0f4f1;padding:1px 5px;border-radius:5px;font-size:12.5px;'>$1</code>");
      var lst = ln.match(/^(\s*(?:[-\u2022]|\d{1,2}[.)]))\s+(.*)$/);
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
    row.className = "ai-msg " + (role === "user" ? "me" : "bot");
    var html = "";
    if (role !== "user") html += '<span class="bot-ic">&#10024;</span>';
    html += '<div class="ai-bub">' +
            '<div class="ai-body">' + (opts.raw ? esc(content) : mdLite(content)) + "</div>" +
            '<span class="ai-meta">' + esc(fmtTime(at)) + "</span>";
    if (role !== "user" && !opts.typing) {
      html += '<br><button type="button" class="ai-copy" title="Copy this answer">&#10697; copy</button>';
    }
    html += "</div>";
    row.innerHTML = html;
    if (role !== "user" && !opts.typing) {
      row.querySelector(".ai-copy").addEventListener("click", function () {
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
    row.className = "ai-msg bot ai-typing";
    row.innerHTML = '<span class="bot-ic">&#10024;</span><div class="ai-bub"><span class="dt"></span><span class="dt"></span><span class="dt"></span></div>';
    return row;
  }

  function scrollBottom(smooth) {
    var log = $("aiLog");
    log.scrollTo({ top: log.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function renderAll() {
    var col = $("aiCol");
    col.innerHTML = '<div class="ai-chipday">Today</div>';
    var landing = document.createElement("div");
    landing.id = "aiLanding";
    col.appendChild(landing);
    if (!chat.length) paintLanding();
    chat.forEach(function (m) { col.appendChild(bubble(m.role, m.content, m.at)); });
    scrollBottom(false);
  }

  /* ---------------- landing views ---------------- */
  function paintLanding() {
    var land = $("aiLanding");
    if (!land) return;
    if (aiOn) {
      land.innerHTML =
        '<div class="ai-welcome">' +
          '<div class="big"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" fill="#231a02"/><path d="M19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z" fill="#231a02" opacity=".75"/></svg></div>' +
          "<h2>As-salaamu alaykum! &#128075;</h2>" +
          "<p>I am your school AI - chat with me like a helpful colleague. Ask me to write report-card remarks, draft exam questions, compose letters to parents, translate English to Arabic, give teaching ideas&hellip; anything.</p>" +
          '<div class="ai-sugg">' +
            '<button type="button" data-q="Write a warm report-card remark for a brilliant student getting ready for third term holidays.">&#10024; Remark for a brilliant student</button>' +
            '<button type="button" data-q="Draft 5 exam questions on Tawheed for junior secondary students.">&#128218; Exam questions on Tawheed</button>' +
            '<button type="button" data-q="Write a friendly fee reminder message I can send to parents.">&#128176; Fee reminder to parents</button>' +
            '<button type="button" data-q="Give me a simple weekly plan to help a weak student catch up in Arabic grammar.">&#128161; Help a weak student</button>' +
          "</div>" +
        "</div>";
      land.querySelectorAll("button[data-q]").forEach(function (b) {
        b.addEventListener("click", function () {
          var inp = $("aiInput");
          inp.value = b.getAttribute("data-q");
          autoGrow();
          inp.focus();
          send();
        });
      });
    } else if (me && me.role === "admin") {
      land.innerHTML =
        '<div class="ai-welcome ai-setup">' +
          "<h2>&#9889; Switch the AI on - one minute, one time</h2>" +
          "<p>The AI chat (and every AI helper in this system) wakes up the moment you paste the school's free AI key below. Grab the key on your phone:</p>" +
          '<ol class="ai-steps">' +
            "<li>Open <a href=\"https://aistudio.google.com/apikey\" target=\"_blank\" rel=\"noopener\">aistudio.google.com/apikey</a> in Chrome (sign in with any Gmail).</li>" +
            "<li>Tap <b>Create API key</b> (it is free - no card, nothing to pay).</li>" +
            "<li>Tap the key to <b>copy</b> it, come back here and paste below.</li>" +
            "<li>Press <b>Save &amp; Switch On</b> - I will test it immediately and tell you it works.</li>" +
          "</ol>" +
          '<div class="ai-keyrow">' +
            '<input id="aiKeyInput" type="text" placeholder="Paste the AI key here (starts with AIza...)" autocomplete="off">' +
            '<button id="aiKeySave" type="button">Save &amp; Switch On</button>' +
          "</div>" +
          '<div class="ai-keynote" id="aiKeyNote"></div>' +
          '<div class="ai-connected" id="aiConnected" style="display:none;"></div>' +
          '<div class="ai-fine">Saved safely inside the school system - never shown fully again, never on GitHub. Worked on your phone, works for everyone: this AI chat, the exam question writer and the website assistant all wake up together. No Render steps, no redeploy.</div>' +
        "</div>";
      $("aiKeySave").addEventListener("click", saveKey);
      $("aiKeyInput").addEventListener("keydown", function (ev) { if (ev.key === "Enter") saveKey(); });
      checkExistingKey();
    } else {
      land.innerHTML =
        '<div class="ai-welcome">' +
          "<h2>&#9200; Almost ready&hellip;</h2>" +
          "<p>The office is switching the school AI on (it takes one minute). Please check back very soon - everything else in the app works as usual.</p>" +
        "</div>";
    }
  }

  function checkExistingKey() {
    jget("/api/ai/config").then(function (res) {
      if (!res.ok) return;
      var d = res.d;
      if (d && d.enabled && d.keyTail) {
        var box = $("aiConnected");
        box.style.display = "flex";
        box.innerHTML = "<span>&#9989; Connected</span><span class=\"k\">key " + esc(d.keyTail) +
          (d.updatedBy ? " &middot; added by " + esc(d.updatedBy) : "") + "</span>" +
          '<button type="button" id="aiKeyRemove">Remove key</button>';
        $("aiKeyRemove").addEventListener("click", removeKey);
        $("aiKeyNote").textContent = "A key is already saved. Paste a new one to replace it, or remove it.";
      }
    }).catch(function () {});
  }

  function saveKey() {
    var inp = $("aiKeyInput"), note = $("aiKeyNote"), btn = $("aiKeySave");
    var key = inp.value.trim();
    if (key.length < 10) {
      note.className = "ai-keynote err";
      note.textContent = "That looks too short - copy the WHOLE key and paste it here.";
      return;
    }
    btn.disabled = true;
    note.className = "ai-keynote";
    note.textContent = "Saving and testing the key\u2026";
    jpost("/api/ai/config", { apiKey: key }).then(function (res) {
      btn.disabled = false;
      if (!res.ok || !res.d || !res.d.saved) {
        note.className = "ai-keynote err";
        note.textContent = (res.d && res.d.error) || "Could not save - please try again.";
        return;
      }
      if (res.d.verified) {
        inp.value = "";
        setState(true); // jump straight to the chat (card + composer flip on)
        setTimeout(function () { toast("The school AI is ON \u2728 everywhere: this chat, exam questions and the website assistant.", "success"); }, 300);
      } else {
        note.className = "ai-keynote err";
        note.textContent = res.d.note || "Saved, but the test failed - check the key and press Save again.";
      }
    }).catch(function () {
      btn.disabled = false;
      note.className = "ai-keynote err";
      note.textContent = "Network error - please try again.";
    });
  }

  function removeKey() {
    if (!confirm("Remove the in-app AI key? The AI features will go to sleep until a key is added again.")) return;
    jpost("/api/ai/config", { apiKey: "" }).then(function () {
      toast("AI key removed.", "info");
      setState(false);
    }).catch(function () { toast("Could not remove - network error.", "error"); });
  }

  /* ---------------- header state ---------------- */
  function setState(on) {
    aiOn = !!on;
    var dot = $("aiDot"), st = $("aiState");
    dot.className = "ai-dot" + (on ? "" : " off");
    st.textContent = on ? "online - ready to chat" : "not switched on yet";
    $("aiInput").disabled = !on;
    $("aiSend").disabled = !on;
    renderAll();
    if (on) $("aiInput").focus();
  }

  /* ---------------- sending ---------------- */
  function send() {
    var inp = $("aiInput");
    var text = inp.value.trim();
    if (!text || busy || !aiOn) return;
    busy = true;
    inp.value = "";
    autoGrow();
    chat.push({ role: "user", content: text, at: Date.now() });
    saveChat();
    var col = $("aiCol");
    col.appendChild(bubble("user", text, Date.now(), { raw: true }));
    var typing = typingBubble();
    col.appendChild(typing);
    scrollBottom(true);

    jpost("/api/ai/chat", {
      messages: chat.map(function (m) { return { role: m.role, content: m.content }; })
    }).then(function (res) {
      typing.remove();
      if (res.ok && res.d && res.d.reply) {
        chat.push({ role: "assistant", content: res.d.reply, at: Date.now() });
        saveChat();
        col.appendChild(bubble("assistant", res.d.reply, Date.now()));
      } else {
        var msg = (res.d && res.d.error) || "The AI stumbled - please try again in a moment.";
        col.appendChild(bubble("assistant", "\u26A0\uFE0E " + msg, Date.now(), { raw: true }));
        if (res.status === 503) setState(false); // key gone - show the switch-on card again
      }
      scrollBottom(true);
    }).catch(function () {
      typing.remove();
      col.appendChild(bubble("assistant", "\u26A0\uFE0E Network error - check your connection and try again.", Date.now(), { raw: true }));
      scrollBottom(true);
    }).finally(function () {
      busy = false;
      $("aiInput").focus();
    });
  }

  function autoGrow() {
    var inp = $("aiInput");
    inp.style.height = "auto";
    inp.style.height = Math.min(132, inp.scrollHeight) + "px";
  }

  /* ---------------- wiring ---------------- */
  function boot() {
    jget("/me").then(function (res) {
      var d = res && res.d;
      if (!d || !d.loggedIn) { window.location.replace("login.html"); return; }
      me = d;
      chat = loadChat();
      return jget("/api/ai/status").then(function (r2) {
        setState(!!(r2 && r2.d && r2.d.enabled));
      });
    }).catch(function () { window.location.replace("login.html"); });

    $("aiSend").addEventListener("click", send);
    $("aiInput").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); }
    });
    $("aiInput").addEventListener("input", autoGrow);
    $("aiNewBtn").addEventListener("click", function () {
      if (chat.length && !confirm("Start a fresh chat? The current conversation is cleared from this device.")) return;
      chat = [];
      saveChat();
      renderAll();
      $("aiInput").focus();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
