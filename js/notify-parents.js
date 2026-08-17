/* ==========================================================================
   js/notify-parents.js
   Bulk parent notification (POST /bulk-notify). Fires a phone push to every
   parent and returns ready-made WhatsApp + SMS deep links for manual
   forwarding (no paid gateway needed). csrf.js patches window.fetch.
   ========================================================================== */
"use strict";

function ntNotify(text, ok) {
    var msg = document.getElementById("ntMsg");
    msg.textContent = text;
    msg.className = "mg-msg " + (ok ? "ok" : "err");
    setTimeout(function () { msg.className = "mg-msg"; }, 5000);
}

function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

function initNotify() {
    fetch("/classes", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (classes) {
            var sel = document.getElementById("ntClass");
            sel.innerHTML = '<option value="">Select Class</option>';
            (Array.isArray(classes) ? classes : []).forEach(function (c) {
                var opt = document.createElement("option");
                opt.value = c.class_name;
                opt.textContent = c.class_name;
                sel.appendChild(opt);
            });
        })
        .catch(function () {});
}

function ntAudienceChanged() {
    var a = document.getElementById("ntAudience").value;
    document.getElementById("ntClassWrap").style.display = a === "class" ? "" : "none";
    document.getElementById("ntTermWrap").style.display = a === "debtors" ? "" : "none";
}

function sendNotify() {
    var audience = document.getElementById("ntAudience").value;
    var message = document.getElementById("ntMessage").value.trim();
    if (!message) { ntNotify("Type a message first.", false); return; }

    var body = { audience: audience, message: message };
    if (audience === "class") body.class_name = document.getElementById("ntClass").value;
    if (audience === "debtors") {
        body.term = document.getElementById("ntTerm").value;
        body.session = document.getElementById("ntSession").value;
        body.class_name = document.getElementById("ntClass").value;
    }

    var box = document.getElementById("ntResult");
    box.innerHTML = '<span style="color:#5B6B62;">Sending...</span>';

    fetch("/bulk-notify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
            if (!res.ok) { box.innerHTML = ""; ntNotify(res.d.message || "Failed.", false); return; }
            var links = res.d.links || [];
            var html = '<div style="background:#E2F4EA; border:1px solid #A5D6A7; border-radius:8px; padding:10px 14px; color:#157347; font-weight:700;">' +
                (res.d.message || "Done") + "</div>";
            if (links.length) {
                html += '<div style="margin-top:10px; font-size:13px;">' +
                    '<b style="color:#14532d;">WhatsApp / SMS links (tap to open, then press Send):</b><br>' +
                    links.map(function (l) {
                        var wa = l.whatsapp ? '<a href="' + l.whatsapp + '" target="_blank" rel="noopener" style="color:#157347;font-weight:700;">WhatsApp</a>' : '<span style="color:#93a19a;">no phone</span>';
                        var sms = l.sms ? '<a href="' + l.sms + '" style="color:#1d4a30;margin-left:8px;">SMS</a>' : "";
                        return '<div style="margin-top:5px;">' + esc(l.full_name) + " · " + esc(l.student_id) + " — " + wa + sms + "</div>";
                    }).join("") +
                '</div>';
            }
            box.innerHTML = html;
            ntNotify(res.d.message || "Done.", true);
        })
        .catch(function () { box.innerHTML = ""; ntNotify("Network error.", false); });
}
