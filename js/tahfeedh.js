/* ==========================================================================
   NEW FILE (pack 40) - js/tahfeedh.js
   Tahfeedh (Qur'an memorisation) tracker: per class roster, each student
   has a 0-30 juz progress with stepper buttons, a progress bar that turns
   gold at 30/30, and INSTANT saving (POST /tahfeedh on every change).
   Endpoints (created in pack 40, additive): GET /tahfeedh, POST /tahfeedh.
   ========================================================================== */
"use strict";

var tahRows = [];   // loaded roster {student_id, full_name, gender, juz, note}
var tahBusy = {};   // student_id -> true while its save is in flight

function tahNotify(text, ok) {
  var msg = document.getElementById("tahMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 2600);
}

function tahInit() {
  fetch("/classes")
    .then(function (r) { return r.json(); })
    .then(function (classes) {
      var sel = document.getElementById("tahClass");
      sel.innerHTML = '<option value="">Select class</option>';
      (classes || []).forEach(function (c) {
        var o = document.createElement("option");
        o.value = c.class_name; o.textContent = c.class_name;
        sel.appendChild(o);
      });
      sel.addEventListener("change", tahLoad);
    })
    .catch(function () {});
}

function tahLoad() {
  var cls = document.getElementById("tahClass").value;
  var list = document.getElementById("tahList");
  document.getElementById("tahAvg").style.display = "none";
  if (!cls) { list.innerHTML = '<div class="fin-ov-empty">Choose a class to see its students.</div>'; return; }
  list.innerHTML = '<div class="fin-ov-empty">Loading...</div>';
  fetch("/tahfeedh?class_name=" + encodeURIComponent(cls))
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      tahRows = Array.isArray(rows) ? rows : [];
      tahRender();
    })
    .catch(function () { list.innerHTML = '<div class="fin-ov-empty">Could not load. Check your internet.</div>'; });
}

function tahRender() {
  var list = document.getElementById("tahList");
  if (!tahRows.length) { list.innerHTML = '<div class="fin-ov-empty">No students in this class yet.</div>'; return; }

  var total = tahRows.reduce(function (a, r) { return a + (r.juz || 0); }, 0);
  var avg = (total / (tahRows.length * 30)) * 100;
  var done = tahRows.filter(function (r) { return (r.juz || 0) >= 30; }).length;
  var avgEl = document.getElementById("tahAvg");
  avgEl.style.display = "";
  avgEl.innerHTML = "Class average <b>" + Math.round(avg) + "%</b> &nbsp;\u00b7&nbsp; " +
    done + " completed Alhamdulillah \u{1F31F}";

  list.innerHTML = "";
  tahRows.forEach(function (r) {
    var juz = r.juz || 0;
    var pct = Math.round((juz / 30) * 100);
    var row = document.createElement("div");
    row.className = "tah-card" + (juz >= 30 ? " tah-done" : "");
    row.id = "tah-" + r.student_id.replace(/[^\w-]/g, "_");
    row.innerHTML =
      '<div class="tah-who"><b>' + (r.full_name || "-") + "</b><small>" + r.student_id + "</small></div>" +
      '<div class="tah-bar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="tah-ctl">' +
        '<button type="button" data-d="-5">\u22125</button>' +
        '<button type="button" data-d="-1">\u22121</button>' +
        '<span class="tah-num" data-num>' + juz + '<small>/30</small></span>' +
        '<button type="button" data-d="1">+1</button>' +
        '<button type="button" data-d="5">+5</button>' +
      "</div>" +
      '<div class="tah-pct">' + (juz >= 30 ? "\u{1F31F} Completed!" : pct + "%") + "</div>";
    row.querySelectorAll("button[data-d]").forEach(function (b) {
      b.addEventListener("click", function () { tahBump(r.student_id, Number(b.getAttribute("data-d"))); });
    });
    list.appendChild(row);
  });
}

function tahBump(sid, delta) {
  var r = tahRows.find(function (x) { return x.student_id === sid; });
  if (!r) return;
  var next = Math.max(0, Math.min(30, (r.juz || 0) + delta));
  if (next === (r.juz || 0)) return;
  r.juz = next;

  // instant paint (optimistic), then save
  var row = document.querySelector('[id="tah-' + sid.replace(/[^\w-]/g, "_") + '"]');
  if (row) {
    var pct = Math.round((next / 30) * 100);
    row.classList.toggle("tah-done", next >= 30);
    row.querySelector(".tah-bar span").style.width = pct + "%";
    row.querySelector("[data-num]").innerHTML = next + "<small>/30</small>";
    row.querySelector(".tah-pct").textContent = next >= 30 ? "\u{1F31F} Completed!" : pct + "%";
  }
  // refresh the class average chip
  var total = tahRows.reduce(function (a, x) { return a + (x.juz || 0); }, 0);
  var done = tahRows.filter(function (x) { return (x.juz || 0) >= 30; }).length;
  document.getElementById("tahAvg").innerHTML = "Class average <b>" +
    Math.round((total / (tahRows.length * 30)) * 100) + "%</b> &nbsp;\u00b7&nbsp; " + done + " completed Alhamdulillah \u{1F31F}";

  if (tahBusy[sid]) return;            // a save is already queued/flying
  tahBusy[sid] = true;
  fetch("/tahfeedh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: sid, juz: next })
  })
    .then(function (rs) { return rs.json().then(function (d) { return { ok: rs.ok, d: d }; }); })
    .then(function (res) {
      tahBusy[sid] = false;
      if (!res.ok) { tahNotify("Could not save " + sid + " - it will retry on your next tap.", false); return; }
      // if the user tapped again while saving, the latest value is sent now
      if (r.juz !== res.d.juz) { tahBusy[sid] = false; tahBump(sid, 0); return; }
      tahNotify("\u2705 " + (r.full_name || "").split(" ")[0] + " - " + next + "/30 saved", true);
    })
    .catch(function () { tahBusy[sid] = false; tahNotify("Network error - will retry on your next tap.", false); });
}
