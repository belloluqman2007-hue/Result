/* ==========================================================================
   NEW FILE (pack 13) - js/admissions.js
   Lists website admission enquiries and lets ADMIN update their status
   (new / contacted / admitted). Admission activation = adding the child
   via the existing Add Student page (management decision).
   ========================================================================== */
"use strict";

function admNotify(text, ok) {
  var msg = document.getElementById("admMsg");
  msg.textContent = text;
  msg.className = "mg-msg " + (ok ? "ok" : "err");
  setTimeout(function () { msg.className = "mg-msg"; }, 4000);
}

function fmtWhen(v) {
  if (!v) return "-";
  var d = new Date(v);
  return isNaN(d) ? String(v).slice(0, 10) : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function loadAdmissions() {
  var tbody = document.querySelector("#admTable tbody");
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#5B6B62;">Loading...</td></tr>';

  fetch("/admission-enquiries")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#5B6B62;">No enquiries yet. Share the website link so parents can apply.</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      rows.forEach(function (row) {
        var tr = document.createElement("tr");

        function td(text) {
          var cell = document.createElement("td");
          cell.textContent = text || "-";
          return cell;
        }

        tr.appendChild(td(fmtWhen(row.created_at)));
        var nameCell = td("");
        var b = document.createElement("b");
        b.textContent = row.child_name || "-";
        nameCell.appendChild(b);
        tr.appendChild(nameCell);
        tr.appendChild(td(row.parent_name));
        var phoneCell = td("");
        var link = document.createElement("a");
        link.href = "tel:" + (row.phone || "");
        link.textContent = row.phone || "-";
        phoneCell.appendChild(link);
        tr.appendChild(phoneCell);
        tr.appendChild(td(row.class_applied));
        tr.appendChild(td(row.message));

        // status selector
        var statusCell = document.createElement("td");
        var sel = document.createElement("select");
        ["new", "contacted", "admitted"].forEach(function (st) {
          var opt = document.createElement("option");
          opt.value = st;
          opt.textContent = st.charAt(0).toUpperCase() + st.slice(1);
          if (row.status === st) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener("change", function () {
          fetch("/admission-enquiry/" + row.id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: sel.value })
          })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
              if (res.ok) admNotify("Status updated: " + (row.child_name || "") + " -> " + sel.value, true);
              else admNotify(res.d.message || "Could not update (admin account required).", false);
            })
            .catch(function () { admNotify("Network error - status NOT saved.", false); });
        });
        statusCell.appendChild(sel);
        tr.appendChild(statusCell);

        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#B3261E;">Could not load enquiries. Please refresh.</td></tr>';
    });
}
