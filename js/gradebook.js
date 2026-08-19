/* Grade Book — every student in the class gets visible CA + Exam inputs.
   Saves via POST /api/gradebook/cell (upsert). Pack 87: tashkeel-safe
   matching, always-visible editors, no click-to-edit hide. */
(function () {
  "use strict";

  var gbData = null;
  var saveTimers = {};

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function sidKey(s) {
    return String(s == null ? "" : s).trim().toLowerCase();
  }

  function nameKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
      .replace(/\s+/g, " ");
  }

  function gradeFor(total) {
    var t = Number(total) || 0;
    if (t >= 70) return "A";
    if (t >= 60) return "B";
    if (t >= 50) return "C";
    if (t >= 45) return "D";
    if (t >= 40) return "E";
    return "F";
  }

  function numOrBlank(v) {
    if (v == null || v === "") return "";
    var n = Number(v);
    if (!isFinite(n)) return "";
    return String(Math.round(n));
  }

  function findResult(sid, subject) {
    if (!gbData || !gbData.results) return null;
    var wantSid = sidKey(sid);
    var wantSub = nameKey(subject);
    var found = null;
    gbData.results.forEach(function (r) {
      if (sidKey(r.student_id) === wantSid && nameKey(r.subject) === wantSub) found = r;
    });
    return found;
  }

  window.gbInit = function () {
    Promise.all([
      fetch("/classes").then(function (r) { return r.ok ? r.json() : []; }),
      fetch("/sessions").then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (pair) {
      var classes = Array.isArray(pair[0]) ? pair[0] : [];
      var sessions = Array.isArray(pair[1]) ? pair[1] : [];
      var cls = document.getElementById("gbClass");
      cls.innerHTML = '<option value="">Select class…</option>' + classes.map(function (c) {
        return '<option value="' + esc(c.class_name) + '">' + esc(c.class_name) + "</option>";
      }).join("");
      var sess = document.getElementById("gbSession");
      if (!sessions.length) {
        sess.innerHTML = '<option value="2026/2027">2026/2027</option>';
      } else {
        sess.innerHTML = sessions.map(function (s) {
          var name = s.session || s;
          return '<option value="' + esc(name) + '"' + (Number(s.is_current) === 1 ? " selected" : "") + ">" + esc(name) + "</option>";
        }).join("");
      }
    }).catch(function () {
      document.getElementById("gbStatus").textContent = "Could not load classes or sessions.";
    });

    var search = document.getElementById("gbSearch");
    if (search) {
      search.addEventListener("input", function () { filterRows(search.value); });
    }
  };

  window.gbLoad = function () {
    var cls = document.getElementById("gbClass").value;
    var term = document.getElementById("gbTerm").value;
    var session = document.getElementById("gbSession").value;
    var status = document.getElementById("gbStatus");
    if (!cls || !term || !session) {
      status.textContent = "Pick a class, term and session first.";
      return;
    }
    status.textContent = "Loading…";
    fetch("/api/gradebook?class=" + encodeURIComponent(cls) + "&term=" + encodeURIComponent(term) + "&session=" + encodeURIComponent(session))
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; }).catch(function () {
          return { ok: false, d: { message: "Could not read the grade book." } };
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d && res.d.message ? res.d.message : "Could not load the grade book.");
        gbData = res.d;
        renderGrid(res.d);
        var nStu = (res.d.students || []).length;
        var nSub = (res.d.subjects || []).length;
        if (!nStu) {
          status.textContent = "No students found for this class. Check the class name under Students / Class Management.";
        } else if (!nSub) {
          status.textContent = nStu + " students found, but this class has no subjects yet. Add subjects under Classes & Subjects, then reload.";
        } else {
          status.textContent = nStu + " students · " + nSub +
            " subjects. Type CA (max 40) and Exam (max 60) in any cell — it saves when you leave the box.";
        }
        var search = document.getElementById("gbSearch");
        if (search) filterRows(search.value);
      })
      .catch(function (err) {
        status.textContent = err && err.message ? err.message : "Could not load the grade book.";
        document.getElementById("gbWrap").style.display = "none";
      });
  };

  function renderGrid(data) {
    var students = data.students || [];
    var subjects = data.subjects || [];
    var html = "<thead><tr><th class=\"gb-name\">Student</th>";
    subjects.forEach(function (s) {
      html += "<th>" + esc(s) + "<div class=\"gb-subh\">CA · Exam</div></th>";
    });
    html += "</tr></thead><tbody>";
    if (!students.length) {
      html += '<tr><td colspan="' + (subjects.length + 1) + '" style="padding:22px;color:#5F6E66;">No students in this class.</td></tr>';
    } else if (!subjects.length) {
      html += '<tr><td colspan="1" style="padding:22px;color:#5F6E66;">No subjects assigned to this class yet.</td></tr>';
    }
    students.forEach(function (st) {
      var q = (sidKey(st.student_id) + " " + String(st.full_name || "").toLowerCase());
      html += '<tr data-sid="' + esc(st.student_id) + '" data-q="' + esc(q) + '"><td class="gb-name">' +
        esc(st.full_name) + '<div class="gb-id">' + esc(st.student_id) + "</div></td>";
      subjects.forEach(function (sub) {
        var row = findResult(st.student_id, sub);
        var ca = row ? numOrBlank(row.ca_score) : "";
        var ex = row ? numOrBlank(row.exam_score) : "";
        var tot = row && row.total != null ? Math.round(Number(row.total)) : "";
        var gr = row && row.grade ? row.grade : (tot === "" ? "" : gradeFor(tot));
        html += '<td class="gb-cell" data-sid="' + esc(st.student_id) + '" data-name="' +
          esc(st.full_name) + '" data-subject="' + esc(sub) + '"' +
          (row && row.id ? ' data-rid="' + row.id + '"' : "") + ">" +
          '<div class="gb-edit">' +
            '<input class="gb-ca" type="number" min="0" max="40" step="1" inputmode="decimal" placeholder="CA" value="' + esc(ca) + '" aria-label="CA for ' + esc(st.full_name) + " · " + esc(sub) + '">' +
            '<input class="gb-ex" type="number" min="0" max="60" step="1" inputmode="decimal" placeholder="Ex" value="' + esc(ex) + '" aria-label="Exam for ' + esc(st.full_name) + " · " + esc(sub) + '">' +
          "</div>" +
          '<div class="gb-tot">' + (tot === "" ? "—" : tot + " " + esc(gr)) + "</div>" +
          "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody>";
    document.getElementById("gbTable").innerHTML = html;
    document.getElementById("gbWrap").style.display = "block";
    bindCells();
  }

  function bindCells() {
    document.querySelectorAll("#gbTable td.gb-cell").forEach(function (td) {
      var ca = td.querySelector(".gb-ca");
      var ex = td.querySelector(".gb-ex");
      if (!ca || !ex) return;
      function schedule() { queueSave(td); }
      ca.addEventListener("change", schedule);
      ex.addEventListener("change", schedule);
      ca.addEventListener("blur", schedule);
      ex.addEventListener("blur", schedule);
      td.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          (document.activeElement || ca).blur();
        }
      });
    });
  }

  function filterRows(q) {
    q = String(q || "").trim().toLowerCase();
    document.querySelectorAll("#gbTable tbody tr").forEach(function (tr) {
      if (!q) { tr.style.display = ""; return; }
      var hay = (tr.getAttribute("data-q") || "").toLowerCase();
      tr.style.display = hay.indexOf(q) !== -1 ? "" : "none";
    });
  }

  function queueSave(td) {
    var key = td.getAttribute("data-sid") + "||" + td.getAttribute("data-subject");
    if (saveTimers[key]) clearTimeout(saveTimers[key]);
    saveTimers[key] = setTimeout(function () {
      saveTimers[key] = null;
      saveCell(td);
    }, 280);
  }

  function saveCell(td) {
    if (!gbData) return;
    var caEl = td.querySelector(".gb-ca");
    var exEl = td.querySelector(".gb-ex");
    if (!caEl || !exEl) return;
    var caRaw = caEl.value.trim();
    var exRaw = exEl.value.trim();
    if (caRaw === "" && exRaw === "" && !td.getAttribute("data-rid")) {
      td.querySelector(".gb-tot").textContent = "—";
      return;
    }
    var ca = caRaw === "" ? 0 : Number(caRaw);
    var exam = exRaw === "" ? 0 : Number(exRaw);
    if (!isFinite(ca) || ca < 0 || ca > 40) {
      if (window.amsToast) window.amsToast("CA must be between 0 and 40.", "error");
      return;
    }
    if (!isFinite(exam) || exam < 0 || exam > 60) {
      if (window.amsToast) window.amsToast("Exam must be between 0 and 60.", "error");
      return;
    }
    var total = Math.max(0, Math.min(100, ca + exam));
    var grade = gradeFor(total);
    var sid = td.getAttribute("data-sid");
    var name = td.getAttribute("data-name");
    var subject = td.getAttribute("data-subject");
    var existing = findResult(sid, subject);
    var payload = {
      student_id: sid,
      student_name: name,
      class_name: gbData.class_name,
      term: gbData.term,
      session: gbData.session,
      subject: subject,
      first_test: existing && existing.first_test != null ? Number(existing.first_test) || 0 : 0,
      second_test: existing && existing.second_test != null ? Number(existing.second_test) || 0 : 0,
      note_score: existing && existing.note_score != null ? Number(existing.note_score) || 0 : 0,
      attendance_score: existing && existing.attendance_score != null ? Number(existing.attendance_score) || 0 : 0,
      ca_score: ca,
      exam_score: exam,
      total_score: total,
      grade: grade
    };
    td.classList.add("gb-saving");
    td.querySelector(".gb-tot").textContent = Math.round(total) + " " + grade;
    fetch("/api/gradebook/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; }).catch(function () {
          return { ok: false, d: { message: "Save failed" } };
        });
      })
      .then(function (res) {
        td.classList.remove("gb-saving");
        if (!res.ok) throw new Error(res.d && res.d.message ? res.d.message : "Save failed");
        if (res.d && res.d.id) td.setAttribute("data-rid", res.d.id);
        if (existing) {
          existing.ca_score = ca;
          existing.exam_score = exam;
          existing.total = total;
          existing.grade = grade;
          if (res.d && res.d.id) existing.id = res.d.id;
        } else if (gbData.results) {
          gbData.results.push({
            id: res.d && res.d.id,
            student_id: sid,
            subject: subject,
            total: total,
            ca_score: ca,
            exam_score: exam,
            first_test: payload.first_test,
            second_test: payload.second_test,
            note_score: payload.note_score,
            attendance_score: payload.attendance_score,
            grade: grade
          });
        }
        td.classList.add("gb-ok");
        setTimeout(function () { td.classList.remove("gb-ok"); }, 900);
      })
      .catch(function (err) {
        td.classList.remove("gb-saving");
        td.classList.add("gb-err");
        setTimeout(function () { td.classList.remove("gb-err"); }, 1400);
        if (window.amsToast) window.amsToast(err && err.message ? err.message : "Could not save that score.", "error");
      });
  }

  window.gbExport = function () {
    var cls = document.getElementById("gbClass").value;
    var term = document.getElementById("gbTerm").value;
    var session = document.getElementById("gbSession").value;
    if (!cls || !term || !session) {
      if (window.amsToast) window.amsToast("Load a grade book first.", "info");
      return;
    }
    window.location.assign(
      "/api/gradebook/export?class=" + encodeURIComponent(cls) +
      "&term=" + encodeURIComponent(term) +
      "&session=" + encodeURIComponent(session)
    );
  };
})();
