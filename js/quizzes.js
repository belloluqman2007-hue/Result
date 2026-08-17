/* ==========================================================================
   js/quizzes.js
   Staff quiz builder (GET/POST/DELETE /quizzes, GET /quizzes/:id/attempts).
   Questions are built client-side as { q, options[4], answer }. csrf.js
   already patches window.fetch.
   ========================================================================== */
"use strict";

var qzList = [];

function qzNotify(text, ok) {
    var msg = document.getElementById("qzMsg");
    msg.textContent = text;
    msg.className = "mg-msg " + (ok ? "ok" : "err");
    setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

function initQuizzes() {
    fetch("/classes", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (classes) {
            var sel = document.getElementById("qzClass");
            (Array.isArray(classes) ? classes : []).forEach(function (c) {
                var opt = document.createElement("option");
                opt.value = c.class_name;
                opt.textContent = c.class_name;
                sel.appendChild(opt);
            });
        })
        .catch(function () {});
    addQuestion();
    loadQuizzes();
}

function questionHTML(n) {
    return '<div class="mg-card" style="margin-top:10px;" data-qid="' + n + '">' +
        '<h4 style="margin:0 0 8px; font-size:13px; color:#14532d;">Question ' + n + '</h4>' +
        '<input type="text" class="qz-q" placeholder="Question text" style="width:100%; padding:9px 11px; border:1.5px solid #c8d6ca; border-radius:8px; font-size:14px; font-family:inherit;">' +
        '<div class="qz-opts" style="display:grid; gap:6px; margin-top:8px;">' +
            [0,1,2,3].map(function (i) {
                return '<div style="display:flex; gap:8px; align-items:center;">' +
                    '<input type="radio" name="qzCorrect' + n + '" value="' + i + '">' +
                    '<input type="text" class="qz-opt" placeholder="Option ' + (i+1) + '" style="flex:1; padding:8px 10px; border:1.5px solid #c8d6ca; border-radius:8px; font-size:13.5px; font-family:inherit;">' +
                '</div>';
            }).join("") +
        '</div>' +
        '<p style="font-size:11px; color:#93a19a; margin:6px 0 0;">Tick the radio button beside the correct answer.</p>' +
        '<button class="mg-btn-light mg-btn-danger" type="button" style="margin-top:6px;" onclick="removeQuestion(' + n + ')">Remove question</button>' +
    '</div>';
}

function addQuestion() {
    var box = document.getElementById("qzQuestions");
    var n = box.querySelectorAll("[data-qid]").length + 1;
    box.insertAdjacentHTML("beforeend", questionHTML(n));
}

function removeQuestion(n) {
    var el = document.querySelector('[data-qid="' + n + '"]');
    if (el) el.parentNode.removeChild(el);
}

function collectQuestions() {
    var out = [];
    document.querySelectorAll("#qzQuestions [data-qid]").forEach(function (card) {
        var q = card.querySelector(".qz-q").value.trim();
        var opts = [];
        card.querySelectorAll(".qz-opt").forEach(function (o) { opts.push(o.value.trim()); });
        var correct = card.querySelector('input[type="radio"]:checked');
        if (!q || opts.some(function (o) { return !o; }) || !correct) return;
        out.push({ q: q, options: opts, answer: Number(correct.value) });
    });
    return out;
}

function saveQuiz() {
    var title = document.getElementById("qzTitle").value.trim();
    var questions = collectQuestions();
    if (!title) { qzNotify("Give the quiz a title.", false); return; }
    if (questions.length < 1) {
        qzNotify("Add at least one complete question (question + 4 options + correct answer).", false);
        return;
    }
    var body = {
        title: title,
        class_name: document.getElementById("qzClass").value,
        subject: document.getElementById("qzSubject").value.trim(),
        due_date: document.getElementById("qzDue").value,
        questions: questions
    };
    fetch("/quizzes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
            if (res.ok) {
                qzNotify("✅ " + (res.d.message || "Quiz saved."), true);
                document.getElementById("qzTitle").value = "";
                document.getElementById("qzSubject").value = "";
                document.getElementById("qzQuestions").innerHTML = "";
                addQuestion();
                loadQuizzes();
            } else {
                qzNotify(res.d.message || "Could not save.", false);
            }
        })
        .catch(function () { qzNotify("Network error — NOT saved.", false); });
}

function loadQuizzes() {
    var tbody = document.querySelector("#qzTable tbody");
    fetch("/quizzes", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
            rows = Array.isArray(rows) ? rows : [];
            qzList = rows;
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#5B6B62;">No quizzes yet.</td></tr>';
                return;
            }
            tbody.innerHTML = "";
            rows.forEach(function (q) {
                var nq = 0;
                try { nq = (JSON.parse(q.questions || "[]") || []).length; } catch (e) {}
                var tr = document.createElement("tr");
                var t1 = document.createElement("td");
                t1.innerHTML = "<b>" + esc(q.title) + "</b>";
                tr.appendChild(t1);
                [q.class_name, q.subject].forEach(function (v) {
                    var td = document.createElement("td"); td.textContent = v || "-"; tr.appendChild(td);
                });
                var t4 = document.createElement("td"); t4.textContent = nq; tr.appendChild(t4);
                var t5 = document.createElement("td"); t5.textContent = q.due_date ? String(q.due_date).slice(0,10) : "-"; tr.appendChild(t5);
                var t6 = document.createElement("td");
                var btnA = document.createElement("button");
                btnA.className = "mg-btn-light"; btnA.type = "button"; btnA.textContent = "View";
                btnA.addEventListener("click", function () { qzShowAttempts(q); });
                t6.appendChild(btnA);
                tr.appendChild(t6);
                var t7 = document.createElement("td");
                var btnD = document.createElement("button");
                btnD.className = "mg-btn-light mg-btn-danger"; btnD.type = "button"; btnD.textContent = "🗑";
                btnD.title = "Delete quiz (admin only)";
                btnD.addEventListener("click", function () {
                    if (!confirm("Delete '" + q.title + "' and all its attempts?")) return;
                    fetch("/quizzes/" + q.id, { method: "DELETE", credentials: "same-origin" })
                        .then(function (r) { return r.json(); })
                        .then(function (d) { qzNotify(d.message || "Deleted.", true); loadQuizzes(); })
                        .catch(function () { qzNotify("Network error.", false); });
                });
                t7.appendChild(btnD);
                tr.appendChild(t7);
                tbody.appendChild(tr);
            });
        })
        .catch(function () {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#B3261E;">Could not load quizzes.</td></tr>';
        });
}

function qzShowAttempts(q) {
    document.getElementById("qzAttemptsTitle").textContent = q.title;
    var body = document.getElementById("qzAttemptsBody");
    body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#5B6B62;">Loading...</td></tr>';
    document.getElementById("qzAttemptsOverlay").style.display = "flex";
    fetch("/quizzes/" + q.id + "/attempts", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
            rows = Array.isArray(rows) ? rows : [];
            if (!rows.length) { body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#5B6B62;">No attempts yet.</td></tr>'; return; }
            body.innerHTML = rows.map(function (a) {
                var pct = a.total ? Math.round(a.score / a.total * 100) : 0;
                return "<tr><td><b>" + esc(a.student_name || a.student_id) + "</b></td><td>" + a.score + "/" + a.total + " (" + pct + "%)</td><td>" + String(a.created_at).slice(0,16).replace("T"," ") + "</td></tr>";
            }).join("");
        })
        .catch(function () { body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#B3261E;">Could not load attempts.</td></tr>'; });
}

function qzCloseAttempts() {
    document.getElementById("qzAttemptsOverlay").style.display = "none";
}
