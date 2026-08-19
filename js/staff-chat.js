/* Staff internal messaging — uses /api/staff-chat* routes only. */
(function () {
  "use strict";

  var me = null;
  var users = [];
  var messages = [];
  var active = null;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function initials(name) {
    var p = String(name || "?").trim().split(/\s+/);
    return ((p[0] || "?").charAt(0) + (p[1] ? p[1].charAt(0) : "")).toUpperCase();
  }

  function clock(v) {
    if (!v) return "";
    return String(v).replace("T", " ").slice(0, 16);
  }

  window.scInit = function () {
    Promise.all([
      fetch("/me").then(function (r) { return r.json(); }),
      fetch("/api/staff-chat/users").then(function (r) { return r.ok ? r.json() : []; }),
      fetch("/api/staff-chat").then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (pack) {
      me = pack[0] && pack[0].loggedIn ? pack[0] : null;
      if (!me) { window.location.href = "login.html"; return; }
      users = Array.isArray(pack[1]) ? pack[1] : [];
      messages = Array.isArray(pack[2]) ? pack[2] : [];
      renderPeople();
    }).catch(function () {
      document.getElementById("scPeople").innerHTML = '<div class="sc-idle">Could not load staff chat.</div>';
    });
  };

  function unreadFor(username) {
    return messages.filter(function (m) {
      return m.sender_ref === username && m.recipient_ref === me.username && !m.read_at;
    }).length;
  }

  function lastPreview(username) {
    var mine = messages.filter(function (m) {
      return (m.sender_ref === username && m.recipient_ref === me.username) ||
             (m.sender_ref === me.username && m.recipient_ref === username);
    });
    if (!mine.length) return "No messages yet";
    return mine[mine.length - 1].body || "";
  }

  function renderPeople() {
    var q = ((document.getElementById("scSearch") || {}).value || "").trim().toLowerCase();
    var list = users.filter(function (u) {
      if (u.username === me.username) return false;
      if (!q) return true;
      return String(u.username).toLowerCase().indexOf(q) !== -1 ||
             String(u.role || "").toLowerCase().indexOf(q) !== -1;
    });
    var box = document.getElementById("scPeople");
    if (!list.length) {
      box.innerHTML = '<div class="sc-idle">No other staff accounts.</div>';
      return;
    }
    box.innerHTML = list.map(function (u) {
      var n = unreadFor(u.username);
      return '<button type="button" class="sc-person' + (active === u.username ? " on" : "") +
        '" data-user="' + esc(u.username) + '" onclick="scOpen(\'' +
        String(u.username).replace(/'/g, "\\'") + "')\">" +
        '<span class="sc-ava">' + esc(initials(u.username)) + "</span>" +
        '<span><span class="sc-pname">' + esc(u.username) + "</span>" +
        '<span class="sc-prole">' + esc(u.role || "staff") + " · " + esc(lastPreview(u.username)).slice(0, 42) +
        "</span></span>" +
        (n ? '<span class="sc-unread">' + n + "</span>" : "") +
        "</button>";
    }).join("");
  }

  window.scFilter = function () { renderPeople(); };

  window.scOpen = function (username) {
    active = username;
    document.getElementById("scHead").textContent = username;
    document.getElementById("scBody").disabled = false;
    document.getElementById("scSendBtn").disabled = false;
    renderPeople();
    renderThread();
    fetch("/api/staff-chat/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username })
    }).then(function () {
      messages.forEach(function (m) {
        if (m.sender_ref === username && m.recipient_ref === me.username) m.read_at = m.read_at || new Date().toISOString();
      });
      renderPeople();
    }).catch(function () {});
  };

  function renderThread() {
    var box = document.getElementById("scMsgs");
    if (!active) return;
    var rows = messages.filter(function (m) {
      return (m.sender_ref === active && m.recipient_ref === me.username) ||
             (m.sender_ref === me.username && m.recipient_ref === active);
    });
    if (!rows.length) {
      box.innerHTML = '<div class="sc-idle">No messages yet. Say salam to ' + esc(active) + ".</div>";
      return;
    }
    box.innerHTML = rows.map(function (m) {
      var mine = m.sender_ref === me.username;
      return '<div class="sc-row ' + (mine ? "mine" : "theirs") + '"><div class="sc-bubble">' +
        esc(m.body) + '<span class="sc-meta">' + esc(clock(m.created_at)) + "</span></div></div>";
    }).join("");
    box.scrollTop = box.scrollHeight;
  }

  window.scSend = function (ev) {
    ev.preventDefault();
    if (!active) return;
    var bodyEl = document.getElementById("scBody");
    var body = (bodyEl.value || "").trim();
    if (!body) return;
    document.getElementById("scSendBtn").disabled = true;
    fetch("/api/staff-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: active, body: body })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d && res.d.message ? res.d.message : "fail");
        bodyEl.value = "";
        return fetch("/api/staff-chat").then(function (r) { return r.ok ? r.json() : []; });
      })
      .then(function (rows) {
        messages = Array.isArray(rows) ? rows : messages;
        renderThread();
        renderPeople();
      })
      .catch(function () {
        if (window.amsToast) window.amsToast("Could not send that message.", "error");
      })
      .finally(function () {
        document.getElementById("scSendBtn").disabled = false;
      });
  };
})();
