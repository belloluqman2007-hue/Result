/* Analytics Dashboard — canvas charts, no extra libraries.
   Reads GET /api/analytics (admin only). */
(function () {
  "use strict";

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v || "").trim() || fallback;
  }

  function prepCanvas(canvas, cssHeight) {
    var dpr = window.devicePixelRatio || 1;
    var width = canvas.clientWidth || canvas.parentElement.clientWidth || 480;
    canvas.width = width * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.height = cssHeight + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: width, h: cssHeight };
  }

  function drawBars(canvas, items, opts) {
    opts = opts || {};
    var c = prepCanvas(canvas, opts.height || 240);
    var ctx = c.ctx;
    ctx.clearRect(0, 0, c.w, c.h);
    if (!items.length) return false;

    var padL = 36, padR = 12, padT = 22, padB = 48;
    var chartH = c.h - padT - padB;
    var chartW = c.w - padL - padR;
    var max = 0;
    items.forEach(function (d) {
      var v = Number(d.value);
      if (v > max) max = v;
      if (d.value2 != null && Number(d.value2) > max) max = Number(d.value2);
    });
    if (!max) max = 1;

    var em = cssVar("--m-emerald-2", "#1C5A42");
    var jade = cssVar("--m-jade", "#2F9E6E");
    var gold = "#C9A227";
    var muted = cssVar("--m-muted", "#5F6E66");
    var grouped = !!opts.grouped;
    var slot = chartW / items.length;
    var barW = Math.min(grouped ? 18 : 42, slot * (grouped ? 0.32 : 0.58));

    ctx.strokeStyle = "rgba(15,61,46,.12)";
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = padT + chartH - (g / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + chartW, gy);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = "10px Cairo, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(String(Math.round((g / 4) * max)), padL - 6, gy + 3);
    }

    items.forEach(function (d, i) {
      var x0 = padL + slot * i + (slot - (grouped ? barW * 2 + 4 : barW)) / 2;
      function bar(val, x, colorA, colorB) {
        var h = Math.max(2, (Number(val) / max) * chartH);
        var y = padT + chartH - h;
        var grad = ctx.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, colorA);
        grad.addColorStop(1, colorB);
        ctx.fillStyle = grad;
        var r = Math.min(5, barW / 2);
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.lineTo(x + barW - r, y);
        ctx.arcTo(x + barW, y, x + barW, y + r, r);
        ctx.lineTo(x + barW, y + h);
        ctx.closePath();
        ctx.fill();
      }
      bar(d.value, x0, jade, em);
      if (grouped) bar(d.value2 || 0, x0 + barW + 4, gold, "#8a6d1d");

      ctx.fillStyle = muted;
      ctx.font = "11px Cairo, sans-serif";
      ctx.textAlign = "center";
      ctx.save();
      ctx.translate(padL + slot * i + slot / 2, c.h - 10);
      var label = String(d.label || "");
      if (label.length > 14) label = label.slice(0, 13) + "…";
      if (slot < 56) {
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = "right";
      }
      ctx.fillText(label, 0, 0, slot < 56 ? 80 : slot + 8);
      ctx.restore();
    });

    if (opts.legend) {
      ctx.font = "11px Cairo, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = jade;
      ctx.fillRect(padL, 4, 10, 10);
      ctx.fillStyle = muted;
      ctx.fillText(opts.legend[0] || "", padL + 14, 13);
      if (opts.legend[1]) {
        ctx.fillStyle = gold;
        ctx.fillRect(padL + 110, 4, 10, 10);
        ctx.fillStyle = muted;
        ctx.fillText(opts.legend[1], padL + 124, 13);
      }
    }
    return true;
  }

  function drawLine(canvas, items) {
    var c = prepCanvas(canvas, 240);
    var ctx = c.ctx;
    ctx.clearRect(0, 0, c.w, c.h);
    if (!items.length) return false;

    var padL = 36, padR = 14, padT = 18, padB = 40;
    var chartH = c.h - padT - padB;
    var chartW = c.w - padL - padR;
    var jade = cssVar("--m-jade", "#2F9E6E");
    var em = cssVar("--m-emerald-2", "#1C5A42");
    var muted = cssVar("--m-muted", "#5F6E66");

    ctx.strokeStyle = "rgba(15,61,46,.12)";
    for (var g = 0; g <= 4; g++) {
      var gy = padT + chartH - (g / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + chartW, gy);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = "10px Cairo, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(String(g * 25) + "%", padL - 6, gy + 3);
    }

    var step = items.length === 1 ? 0 : chartW / (items.length - 1);
    ctx.beginPath();
    items.forEach(function (d, i) {
      var x = padL + i * step;
      var y = padT + chartH - (Math.max(0, Math.min(100, Number(d.value) || 0)) / 100) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = jade;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    items.forEach(function (d, i) {
      var x = padL + i * step;
      var y = padT + chartH - (Math.max(0, Math.min(100, Number(d.value) || 0)) / 100) * chartH;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = em;
      ctx.fill();
      ctx.fillStyle = muted;
      ctx.font = "10px Cairo, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(d.label || ""), x, c.h - 12);
    });
    return true;
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  fetch("/api/analytics")
    .then(function (r) {
      if (r.status === 403) throw new Error("admin");
      if (!r.ok) throw new Error("fail");
      return r.json();
    })
    .then(function (data) {
      var subjects = (data.subjects || []).map(function (s) {
        return { label: s.subject, value: Number(s.avg_score) || 0 };
      });
      var subOk = subjects.length && drawBars(document.getElementById("anSubjectChart"), subjects);
      document.getElementById("anSubjectEmpty").style.display = subOk ? "none" : "block";
      if (!subOk) document.getElementById("anSubjectChart").style.display = "none";

      var weeks = (data.attendance || []).map(function (w) {
        return { label: w.label, value: Number(w.pct) || 0 };
      });
      var attOk = weeks.length && drawLine(document.getElementById("anAttendChart"), weeks);
      document.getElementById("anAttendEmpty").style.display = attOk ? "none" : "block";
      if (!attOk) document.getElementById("anAttendChart").style.display = "none";

      var fees = (data.fees || []).map(function (f) {
        return { label: f.label, value: Number(f.collected) || 0, value2: Number(f.outstanding) || 0 };
      });
      var feeOk = fees.length && drawBars(document.getElementById("anFeeChart"), fees, {
        grouped: true,
        legend: ["Collected", "Outstanding"]
      });
      document.getElementById("anFeeEmpty").style.display = feeOk ? "none" : "block";
      if (!feeOk) document.getElementById("anFeeChart").style.display = "none";

      var tbody = document.querySelector("#anClassTable tbody");
      var classes = data.classes || [];
      if (!classes.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="an-empty">No class results yet.</td></tr>';
      } else {
        tbody.innerHTML = classes.map(function (c) {
          return "<tr><td>" + esc(c.class_name) + "</td><td><b>" +
            (Number(c.avg_score) || 0).toFixed(1) + "</b></td><td>" +
            (c.students || 0) + "</td><td>" + (c.scores || 0) + "</td></tr>";
        }).join("");
      }
    })
    .catch(function (err) {
      if (err && err.message === "admin") {
        window.location.href = "teacher-dashboard.html";
        return;
      }
      document.getElementById("anSubjectEmpty").style.display = "block";
      document.getElementById("anAttendEmpty").style.display = "block";
      document.getElementById("anFeeEmpty").style.display = "block";
      document.querySelector("#anClassTable tbody").innerHTML =
        '<tr><td colspan="4" class="an-empty">Could not load analytics.</td></tr>';
    });
})();
