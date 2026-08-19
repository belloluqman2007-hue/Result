/* Grade Book — inline score grid. Saves one cell at a time via the
   existing /save-result and /update-result/:id routes. */
(function () {
  "use strict";

  var gbData = null;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

  function splitTotal(total, existing) {
    var t = Math.max(0, Math.min(100, Number(total) || 0));
    var ca = existing && existing.ca_score != null ? Number(existing.ca_score) || 0 : 0;
    var exam;
    if (existing && existing.id && t >= ca) {
      exam = Math.min(60, t - ca);
      if (ca + exam !== t) {
        exam = Math.min(60, t);
        ca = Math.min(40, Math.max(0, t - exam));
      }
    } else {
      exam = Math.min(60, t);
      ca = Math.min(40, Math.max(0, t - exam));
    }
    return {
      first_test: existing && existing.first_test != null ? Number(existing.first_test) || 0 : 0,
      second_test: existing && existing.second_test != null ? Number(existing.second_test) || 0 : 0,
      note_score: existing && existing.note_score != null ? Number(existing.note_score) || 0 : 0,
      attendance_score: existing && existing.attendance_score != null ? Number(existing.attendance_score) || 0 : 0,
      ca_score: ca,
      exam_score: exam,
      total_score: t,
      grade: gradeFor(t)
    };
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
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        gbData = data;
        renderGrid(data);
        status.textContent = (data.students || []).length + " students · " + (data.subjects || []).length +
          " subjects. Click a cell to edit the total score.";
      })
      .catch(function () {
        status.textContent = "Could not load the grade book.";
        document.getElementById("gbWrap").style.display = "none";
      });
  };

  function cellKey(sid, subject) {
    return sid + "||" + subject;
  }

  function renderGrid(data) {
    var students = data.students || [];
    var subjects = data.subjects || [];
    var map = {};
    (data.results || []).forEach(function (r) {
      map[cellKey(r.student_id, r.subject)] = r;
    });
    var html = "<thead><tr><th class=\"gb-name\">Student</th>";
    subjects.forEach(function (s) { html += "<th>" + esc(s) + "</th>"; });
    html += "</tr></thead><tbody>";
    if (!students.length) {
      html += '<tr><td colspan="' + (subjects.length + 1) + '" style="padding:22px;color:#5F6E66;">No students in this class.</td></tr>';
    }
    students.forEach(function (st) {
      html += '<tr data-sid="' + esc(st.student_id) + '"><td class="gb-name">' +
        esc(st.full_name) + '<div style="font-weight:500;color:#5F6E66;font-size:11px;">' +
        esc(st.student_id) + "</div></td>";
      subjects.forEach(function (sub) {
        var row = map[cellKey(st.student_id, sub)];
        var val = row && row.total != null ? String(Math.round(Number(row.total))) : "";
        html += '<td class="gb-cell" data-sid="' + esc(st.student_id) + '" data-name="' +
          esc(st.full_name) + '" data-subject="' + esc(sub) + '"' +
          (row && row.id ? ' data-rid="' + row.id + '"' : "") + ">" +
          (val === "" ? "—" : val) + "</td>";
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
      td.addEventListener("click", function () {
        if (td.querySelector("input")) return;
        startEdit(td);
      });
    });
  }

  function startEdit(td) {
    var current = (td.textContent || "").replace("—", "").trim();
    var input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = current;
    td.textContent = "";
    td.appendChild(input);
    input.focus();
    input.select();

    function cancel() {
      td.textContent = current === "" ? "—" : current;
    }
    function commit() {
      var raw = input.value.trim();
      if (raw === current || (raw === "" && current === "")) {
        cancel();
        return;
      }
      if (raw === "") {
        cancel();
        return;
      }
      var score = Number(raw);
      if (!isFinite(score) || score < 0 || score > 100) {
        if (window.amsToast) window.amsToast("Score must be between 0 and 100.", "error");
        cancel();
        return;
      }
      saveCell(td, score, current);
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); input.removeEventListener("blur", commit); cancel(); }
    });
    input.addEventListener("blur", commit);
  }

  function saveCell(td, score, previous) {
    if (!gbData) return;
    var sid = td.getAttribute("data-sid");
    var name = td.getAttribute("data-name");
    var subject = td.getAttribute("data-subject");
    var rid = td.getAttribute("data-rid");
    var existing = null;
    (gbData.results || []).forEach(function (r) {
      if (r.student_id === sid && r.subject === subject) existing = r;
    });
    var bits = splitTotal(score, existing);
    var payload = {
      student_id: sid,
      student_name: name,
      class_name: gbData.class_name,
      term: gbData.term,
      session: gbData.session,
      subject: subject,
      first_test: bits.first_test,
      second_test: bits.second_test,
      note_score: bits.note_score,
      attendance_score: bits.attendance_score,
      ca_score: bits.ca_score,
      exam_score: bits.exam_score,
      total_score: bits.total_score,
      grade: bits.grade
    };
    td.classList.add("gb-saving");
    td.textContent = String(Math.round(score));
    var url = rid ? "/update-result/" + encodeURIComponent(rid) : "/save-result";
    var method = rid ? "PUT" : "POST";
    fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        td.classList.remove("gb-saving");
        if (!res.ok) throw new Error(res.d && res.d.message ? res.d.message : "Save failed");
        if (!rid && res.d && res.d.id) {
          td.setAttribute("data-rid", res.d.id);
          if (gbData.results) {
            gbData.results.push({
              id: res.d.id,
              student_id: sid,
              subject: subject,
              total: bits.total_score,
              ca_score: bits.ca_score,
              exam_score: bits.exam_score,
              first_test: bits.first_test,
              second_test: bits.second_test,
              note_score: bits.note_score,
              attendance_score: bits.attendance_score,
              grade: bits.grade
            });
          }
        } else if (existing) {
          existing.total = bits.total_score;
          existing.ca_score = bits.ca_score;
          existing.exam_score = bits.exam_score;
          existing.grade = bits.grade;
        }
        td.classList.add("gb-ok");
        setTimeout(function () { td.classList.remove("gb-ok"); }, 900);
        if (window.amsToast) window.amsToast("Saved " + name + " · " + subject, "success", 1600);
      })
      .catch(function () {
        td.classList.remove("gb-saving");
        td.classList.add("gb-err");
        td.textContent = previous === "" ? "—" : previous;
        setTimeout(function () { td.classList.remove("gb-err"); }, 1400);
        if (window.amsToast) window.amsToast("Could not save that score.", "error");
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
