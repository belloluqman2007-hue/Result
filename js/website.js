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

/* ==========================================================================
   NEW (pack 40): public Honour Roll - top 3 per class from /honour-roll
   (read-only; the server only exposes name + average, nothing else).
   ========================================================================== */
(function () {
  var sec = document.getElementById("honour");
  var box = document.getElementById("wbHonour");
  if (!sec || !box) return;

  fetch("/honour-roll")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.classes || !d.classes.length) return;   // stay hidden
      var esc = function (v) {
        return String(v == null ? "" : v)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      };
      var medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
      var sub = document.getElementById("wbHonourSub");
      if (sub && d.term && d.session) sub.textContent = "Best averages - " + d.term + ", " + d.session + ". Ma sha Allah!";

      box.innerHTML = d.classes.map(function (c) {
        var cards = c.students.map(function (st, i) {
          var initials = String(st.full_name || "?").trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ""; }).join("").toUpperCase();
          return '<div class="wb-hon-card wb-hon-r' + (i + 1) + '">' +
            '<span class="wb-hon-medal">' + medals[i] + "</span>" +
            '<span class="wb-hon-ava">' + esc(initials) + "</span>" +
            '<b class="wb-hon-name">' + esc(String(st.full_name || "").trim()) + "</b>" +
            '<span class="wb-hon-avg">' + st.avg_total + "% average</span>" +
          "</div>";
        }).join("");
        return '<div class="wb-hon-class">' +
          '<div class="wb-hon-cname">' + esc(c.class_name) + "</div>" +
          '<div class="wb-hon-row">' + cards + "</div>" +
        "</div>";
      }).join("");

      sec.style.display = "";
    })
    .catch(function () { /* stay hidden - public site must look perfect even offline */ });
})();

/* ==========================================================================
   CHANGED (pack 104 - owner: the icons must be ON the page itself and
   visible; pack 103 hid the dock above 760px so desktops saw nothing):
   QUICK-JUMP polish for BOTH rows of section shortcuts.

   The quick-jump icons now live in TWO rows:
     1. #wb2Dock  - the floating dock pinned to the bottom of the screen
                    (full-width bar on phones, centred glass pill on wider
                    screens - css/website.css shows it at every width now);
     2. #wb2Jump  - the same 7 shortcuts INSIDE the page itself, in the
                    normal flow just above the footer.

   Both rows are plain HTML links, so jumping works with no JavaScript at
   all. This block only adds three niceties:
     1. Hides the icons of a section that is not on the page (the Honour
        Roll keeps itself hidden until results exist) IN BOTH ROWS and
        brings them back the moment that section is published.
     2. Highlights (gold) the icons of the section you are in right now.
        Pack 103 matched one link element, so with two rows only one row
        lit up; pack 104 matches by href, so the dock icon AND the
        in-page icon of the same section turn gold together.
     3. Tapping a shortcut on EITHER row folds the AI chat away.
   Nothing here touches results, scores, admissions or any request.
   ========================================================================== */
(function () {
  "use strict";
  var rows = [];
  ["wb2Dock", "wb2Jump"].forEach(function (id) {
    var r = document.getElementById(id);
    if (r) rows.push(r);
  });
  if (!rows.length) return;

  var links = [];
  rows.forEach(function (row) {
    links = links.concat(Array.prototype.slice.call(row.querySelectorAll("a[href^='#']")));
  });
  if (!links.length) return;

  /* one entry per unique href target, listing the links in BOTH rows */
  var targets = [];
  links.forEach(function (a) {
    var id = (a.getAttribute("href") || "").replace("#", "");
    var t = null;
    for (var i = 0; i < targets.length; i++) { if (targets[i].href === id) { t = targets[i]; break; } }
    if (!t) { t = { href: id, el: id ? document.getElementById(id) : null, links: [] }; targets.push(t); }
    t.links.push(a);
  });

  /* ---- 1. only show icons for sections that are really on the page ---- */
  function sectionHidden(el) {
    return !el || el.offsetParent === null;   // display:none / not laid out
  }
  function syncIcons() {
    targets.forEach(function (t) {
      var off = sectionHidden(t.el);
      t.links.forEach(function (a) {
        if (off) a.setAttribute("data-dock-off", "");
        else a.removeAttribute("data-dock-off");
      });
    });
  }
  syncIcons();

  /* the Honour Roll section switches itself on after /honour-roll answers */
  var honour = document.getElementById("honour");
  if (honour && "MutationObserver" in window) {
    new MutationObserver(syncIcons).observe(honour, { attributes: true, attributeFilter: ["style"] });
  }
  window.addEventListener("resize", syncIcons);

  /* ---- 2. highlight the section you are in (matched by href, so BOTH
          rows light up together) ---- */
  var pending = 0;
  function mark() {
    pending = 0;
    var line = (window.innerHeight || 640) * 0.34;   // "you are here" line
    var current = null;
    targets.forEach(function (t) {
      if (sectionHidden(t.el)) return;
      var r = t.el.getBoundingClientRect();
      // the section that covers the line (started above it, still not gone)
      if (r.top - line <= 0 && r.bottom > 0) current = t;
    });
    if (!current && window.pageYOffset < line) current = targets[0];   // hero / very top
    links.forEach(function (a) {
      var href = (a.getAttribute("href") || "").replace("#", "");
      a.classList.toggle("is-active", !!current && current.href === href);
    });
  }
  function onScroll() {
    if (!pending) pending = (window.requestAnimationFrame || function (f) { setTimeout(f, 60); })(mark);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  mark();

  /* tapping a shortcut while the AI chat is open: fold the chat away so the
     section you asked for is not sitting behind the conversation panel. */
  rows.forEach(function (row) {
    row.addEventListener("click", function () {
      var panel = document.getElementById("wb2AiPanel");
      var close = document.getElementById("wb2AiClose");
      if (panel && close && panel.classList.contains("wb2-ai-open")) close.click();
    });
  });
})();
