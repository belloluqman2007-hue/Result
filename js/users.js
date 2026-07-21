/* ==========================================================================
   NEW FILE (pack 14) - js/users.js
   Admin user management: create (admin / teacher / any custom position),
   reset passwords, delete users.
   Endpoints: GET /users, POST /create-user, POST /reset-user-password,
   DELETE /user/:id (all admin-only on the server).
   ========================================================================== */
"use strict";

function usrNotify(text, ok) {
  var msg = document.getElementById("usrMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function chosenRole() {
  var sel = document.getElementById("newRole");
  if (sel.value === "__custom") {
    return (document.getElementById("customRole").value || "").trim().toLowerCase().replace(/\s+/g, "_");
  }
  return sel.value;
}

function initUsers() {
  var sel = document.getElementById("newRole");
  sel.addEventListener("change", function () {
    document.getElementById("customRoleWrap").style.display = sel.value === "__custom" ? "grid" : "none";
  });
  loadUsers();
  tcInit(); // NEW (pack 23): teacher-class assignments for Messages
}

function createUser() {
  var username = document.getElementById("newUsername").value.trim();
  var password = document.getElementById("newPassword").value;
  var role = chosenRole();
  if (!username || !password || !role) {
    usrNotify("Fill the username, password and position first.", false);
    return;
  }

  fetch("/create-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username, password: password, role: role })
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) {
        usrNotify("\u2705 User created: " + username + " (" + role + ")", true);
        document.getElementById("newUsername").value = "";
        document.getElementById("newPassword").value = "";
        document.getElementById("customRole").value = "";
        loadUsers();
      } else {
        usrNotify(res.d.message || "Could not create user.", false);
      }
    })
    .catch(function () { usrNotify("Network error - user NOT created.", false); });
}

function loadUsers() {
  var tbody = document.querySelector("#usersTable tbody");
  fetch("/users")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#5B6B62;">No users found.</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      rows.forEach(function (u) {
        var tr = document.createElement("tr");

        var td1 = document.createElement("td");
        var b = document.createElement("b");
        b.textContent = u.username;
        td1.appendChild(b);
        tr.appendChild(td1);

        var td2 = document.createElement("td");
        td2.innerHTML = u.role === "admin"
          ? '<span class="sc-chip sc-chip-live">admin</span>'
          : '<span class="sc-chip sc-chip-soon">' + u.role + '</span>';
        tr.appendChild(td2);

        var td3 = document.createElement("td");
        td3.style.whiteSpace = "nowrap";

        var btnReset = document.createElement("button");
        btnReset.className = "mg-btn-light";
        btnReset.type = "button";
        btnReset.textContent = "\u{1F511} Reset password";
        btnReset.addEventListener("click", function () {
          var pw = prompt("New password for " + u.username + " (min. 4 characters):");
          if (pw === null) return;
          if (pw.length < 4) { usrNotify("Password must be at least 4 characters.", false); return; }
          fetch("/reset-user-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: u.id, password: pw })
          })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
              usrNotify(res.ok ? "\u2705 Password reset for " + u.username : (res.d.message || "Could not reset."), res.ok);
            })
            .catch(function () { usrNotify("Network error.", false); });
        });
        td3.appendChild(btnReset);

        var btnDel = document.createElement("button");
        btnDel.className = "mg-btn-light mg-btn-danger";
        btnDel.type = "button";
        btnDel.textContent = "\u{1F5D1} Delete";
        btnDel.style.marginLeft = "6px";
        btnDel.addEventListener("click", function () {
          if (!confirm("Delete the account '" + u.username + "' (" + u.role + ")? They will not be able to log in again.")) return;
          fetch("/user/" + u.id, { method: "DELETE" })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
              if (res.ok) { usrNotify("User deleted: " + u.username, true); loadUsers(); }
              else usrNotify(res.d.message || "Could not delete.", false);
            })
            .catch(function () { usrNotify("Network error.", false); });
        });
        td3.appendChild(btnDel);

        tr.appendChild(td3);
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#B3261E;">Could not load users (admin account required).</td></tr>';
    });
}

/* ==========================================================================
   NEW (pack 23 - Messages routing): assign teachers to classes so
   Parent -> Class Teacher messages land in the right teacher's inbox.
   Safe default in the server: a teacher with NO assignments still sees
   every parent message, so nothing can be hidden by a missing row here.
   ========================================================================== */
function tcInit() {
  var tSel = document.getElementById("tcTeacher");
  var cSel = document.getElementById("tcClass");
  if (!tSel || !cSel) return;

  fetch("/users").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    var teachers = (Array.isArray(rows) ? rows : []).filter(function (u) { return u.role !== "admin"; });
    tSel.innerHTML = teachers.length
      ? teachers.map(function (u) { return '<option value="' + u.username + '">' + u.username + " (" + u.role + ")</option>"; }).join("")
      : '<option value="">No teachers yet</option>';
  }).catch(function () {});

  fetch("/classes").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    var classes = Array.isArray(rows) ? rows : [];
    cSel.innerHTML = classes.length
      ? classes.map(function (c) { var n = c.class_name || c; return '<option value="' + n + '">' + n + "</option>"; }).join("")
      : '<option value="">No classes yet</option>';
  }).catch(function () {});

  tcLoad();
}

function tcLoad() {
  var box = document.getElementById("tcList");
  if (!box) return;
  fetch("/api/teacher-classes").then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    rows = Array.isArray(rows) ? rows : [];
    if (!rows.length) {
      box.innerHTML = '<span style="color:#93a19a; font-size:13px;">No assignments yet - every teacher currently sees ALL parent messages.</span>';
      return;
    }
    box.innerHTML = '<table class="mg-table"><thead><tr><th>Teacher</th><th>Class</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return "<tr><td><b>" + r.username + "</b></td><td>" + r.class_name + "</td>" +
          '<td><button class="mg-btn-light" type="button" onclick="tcRemove(' + r.id + ')">&#10005; Remove</button></td></tr>';
      }).join("") + "</tbody></table>";
  }).catch(function () {});
}

function tcAssign() {
  var username = document.getElementById("tcTeacher").value;
  var className = document.getElementById("tcClass").value;
  if (!username || !className) { usrNotify("Pick a teacher and a class.", false); return; }
  fetch("/api/teacher-classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username, class_name: className })
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      usrNotify(res.d.message || "", res.ok);
      if (res.ok) tcLoad();
    })
    .catch(function () { usrNotify("Network error.", false); });
}

function tcRemove(id) {
  fetch("/api/teacher-classes/" + id, { method: "DELETE" })
    .then(function (r) { return r.json(); })
    .then(function (d) { usrNotify(d.message || "Removed.", true); tcLoad(); })
    .catch(function () { usrNotify("Network error.", false); });
}
