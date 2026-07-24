/* ==========================================================================
   NEW FILE (pack 13) - js/website.js
   Public school website behaviour: admission enquiry form + footer year.
   Talks ONLY to the new /admission-enquiry endpoint. Additive.
   ========================================================================== */
(function () {
  "use strict";

  var yearEl = document.getElementById("scYear");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // NEW (pack 14): if the admin has updated the school profile on the
  // School Settings page, the footer follows it. Falls back to the
  // hard-coded defaults when nothing is saved yet. Graceful, read-only.
  fetch("/school-settings")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      var addr = document.getElementById("scFooterAddr");
      var contact = document.getElementById("scFooterContact");
      if (addr && d.address) addr.textContent = d.address;
      if (contact) {
        var parts = [];
        if (d.phone1) parts.push(d.phone1);
        if (d.phone2) parts.push(d.phone2);
        var line = "";
        if (parts.length) line += "Tel: " + parts.join(", ");
        if (d.email) line += (line ? " · Email: " : "Email: ") + d.email;
        if (line) contact.textContent = line;
      }
    })
    .catch(function () { /* defaults stay */ });

  var form = document.getElementById("admissionForm");
  if (!form) return;

  var msg = document.getElementById("admMsg");
  var btn = document.getElementById("admSubmit");

  function show(text, ok) {
    msg.textContent = text;
    msg.className = "sc-form-msg " + (ok ? "ok" : "err");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.className = "sc-form-msg";
    btn.disabled = true;
    btn.textContent = "Sending...";

    fetch("/admission-enquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        child_name: document.getElementById("admChild").value.trim(),
        parent_name: document.getElementById("admParent").value.trim(),
        phone: document.getElementById("admPhone").value.trim(),
        class_applied: document.getElementById("admClass").value.trim(),
        message: document.getElementById("admMessage").value.trim()
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { show(res.d.message || "Could not send. Please try again.", false); }
        else {
          show(res.d.message || "Thank you! The school will contact you soon.", true);
          form.reset();
        }
      })
      .catch(function () { show("Network error - please check your internet and try again.", false); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "\u{1F4E8} Send Enquiry";
      });
  });
})();

/* ==========================================================================
   NEW (pack 22 - owner: "I can't see messages/notifications... in the
   website"): public notice board - general announcements + upcoming events
   served by /api/announcements-public (nothing internal ever leaves that
   route; if it's unreachable the section quietly shows a friendly line).
========================================================================== */
(function () {
  const box = document.getElementById("wbNotices");
  if (!box) return;
  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  fetch("/api/announcements-public")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const anns = (d && d.announcements) || [];
      const evs = (d && d.events) || [];
      if (!anns.length && !evs.length) {
        box.innerHTML = '<div class="wb-empty">No announcements right now - please check back soon.</div>';
        return;
      }
      let html = "";
      evs.forEach((e) => {
        const dstr = String(e.event_date || "").slice(0, 10);
        html += '<div class="wb-note wb-event">' +
          '<div class="wb-note-top"><b>' + esc(e.title) + '</b><span class="wb-chip wb-chip-ev">🗓 ' + esc(dstr) + "</span></div>" +
          (e.description ? '<p>' + esc(e.description) + "</p>" : "") +
          "</div>";
      });
      anns.forEach((n) => {
        html += '<div class="wb-note">' +
          '<div class="wb-note-top"><b>' + esc(n.title) + '</b><span class="wb-chip">📢 ' + esc(String(n.created_at || "").slice(0, 10)) + "</span></div>" +
          (n.body ? '<p>' + esc(n.body) + "</p>" : "") +
          "</div>";
      });
      box.innerHTML = html;
    })
    .catch(() => {
      box.innerHTML = '<div class="wb-empty">Announcements will appear here when the school posts them.</div>';
    });
})();

/* ==========================================================================
   NEW (pack 27 - owner: "Can we build ai inside the project"):
   WEBSITE AI ASSISTANT. Floating bubble -> chat panel. Talks ONLY to the
   same-origin /api/ai/assistant route (the key lives on the server).
   Conversation history is kept in sessionStorage (gone when the tab
   closes). When the AI key is not configured yet, the widget still opens
   and replies with a gentle explanation - nothing else on the site is
   touched.
   ========================================================================== */
(function () {
  "use strict";
  var fab = document.getElementById("wb2AiFab");
  var panel = document.getElementById("wb2AiPanel");
  if (!fab || !panel) return;

  var log = document.getElementById("wb2AiLog");
  var input = document.getElementById("wb2AiInput");
  var sendBtn = document.getElementById("wb2AiSend");
  var chips = document.getElementById("wb2AiChips");
  var state = document.getElementById("wb2AiState");
  var hist = [];
  var busy = false;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function saveHist() {
    try { sessionStorage.setItem("amsAiHist", JSON.stringify(hist.slice(-10))); } catch (e) {}
  }
  function loadHist() {
    try { hist = JSON.parse(sessionStorage.getItem("amsAiHist") || "[]"); } catch (e) { hist = []; }
  }
  function bubble(role, text, isErr) {
    var row = document.createElement("div");
    row.className = "wb2-ai-row " + (role === "user" ? "user" : "bot");
    row.innerHTML = '<div class="wb2-ai-bub' + (isErr ? " err" : "") + '">' + esc(text) + "</div>";
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }
  function typing(on) {
    var t = log.querySelector(".wb2-ai-typing");
    if (t) t.remove();
    if (on) {
      var row = document.createElement("div");
      row.className = "wb2-ai-row bot wb2-ai-typing";
      row.innerHTML = '<div class="wb2-ai-bub"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }
  }
  function greet() {
    bubble("assistant",
      "As-salaamu alaykum! \uD83D\uDC4B I am the Ameenullah school assistant. " +
      "Ask me about checking results, admission, our programs, or anything about the school.");
  }
  function openPanel() {
    panel.classList.add("wb2-ai-open");
    panel.setAttribute("aria-hidden", "false");
    if (!log.children.length) {
      loadHist();
      if (hist.length) {
        hist.forEach(function (h) { bubble(h.role, h.content); });
      } else {
        greet();
      }
    }
    setTimeout(function () { input.focus(); }, 200);
  }
  function closePanel() {
    panel.classList.remove("wb2-ai-open");
    panel.setAttribute("aria-hidden", "true");
  }

  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    chips.style.display = "none"; // one-tap hints hide after first use
    bubble("user", text);
    hist.push({ role: "user", content: text });
    saveHist();
    input.value = "";
    busy = true;
    typing(true);
    fetch("/api/ai/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: hist.slice(-8) })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        typing(false);
        if (res.ok && res.d.reply) {
          bubble("assistant", res.d.reply);
          hist.push({ role: "assistant", content: res.d.reply });
          saveHist();
        } else {
          // friendly note (AI off / rate limit / hiccup) - never a dead end
          bubble("assistant",
            (res.d && res.d.error) ||
            "I could not answer just now - please try again, or use the contact details at the bottom of the page.", true);
        }
      })
      .catch(function () {
        typing(false);
        bubble("assistant", "No connection right now - please check your data and try again.", true);
      })
      .finally(function () { busy = false; });
  }

  fab.addEventListener("click", function () {
    if (panel.classList.contains("wb2-ai-open")) closePanel(); else openPanel();
  });
  document.getElementById("wb2AiClose").addEventListener("click", closePanel);
  sendBtn.addEventListener("click", function () { send(input.value); });
  input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") send(input.value); });
  chips.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-q]");
    if (b) send(b.getAttribute("data-q"));
  });

  /* Tell the header when the AI is awake (purely cosmetic). */
  fetch("/api/ai/status").then(function (r) { return r.json(); }).then(function (d) {
    state.textContent = d.enabled
      ? "Online - ask me about results, admission, programs\u2026"
      : "Hello! Ask about the school (full AI answers coming soon).";
  }).catch(function () {});
})();
