/* ==========================================================
   CLASS RESULTS (whole-class PDF)  [NEW FILE - ADDITIVE]
   ----------------------------------------------------------
   Powers class-results.html (request #7):
     - pick Class + Session + Term
     - fetch the RAW saved rows from the read-only /class-results
     - render a broadsheet (students x subjects + totals,
       averages and positions - display-only summaries computed
       in the browser; NOTHING is ever written back and no
       result calculation on the server is changed)
     - download ONE combined A4 PDF (landscape), with the school
       header on every page and one consistent scale across all
       pages (same approach as the exam PDF fix).
   The existing per-student "Download Result" is untouched.
========================================================== */

(function () {
    "use strict";

    var lastSheet = null; /* { className, term, session, subjects[], students[] } */

    function notify(msg, type, ms) {
        if (window.amsToast) window.amsToast(msg, type || "info", ms || 4500);
        else alert(msg);
    }

    /* ---------- class dropdown ---------- */
    function loadClasses() {
        fetch("/classes")
            .then(function (r) { return r.json(); })
            .then(function (classes) {
                var sel = document.getElementById("crClass");
                (classes || []).forEach(function (c) {
                    var opt = document.createElement("option");
                    opt.value = c.class_name;
                    opt.textContent = c.class_name;
                    sel.appendChild(opt);
                });
            })
            .catch(function () { notify("Could not load the class list.", "error"); });
    }

    /* ---------- build the broadsheet from raw rows ---------- */
    function buildSheet(rows, className, term, session) {
        // Unique subject list (first-seen order, since the server orders
        // by student_name, subject - alphabetical per student).
        var subjects = [];
        rows.forEach(function (r) {
            if (subjects.indexOf(r.subject) === -1) subjects.push(r.subject);
        });
        subjects.sort(function (a, b) { return String(a).localeCompare(String(b)); });

        // Group scores per student (keyed by student_id).
        var byId = {};
        rows.forEach(function (r) {
            if (!byId[r.student_id]) {
                byId[r.student_id] = {
                    id: r.student_id,
                    name: r.student_name,
                    scores: {} // subject -> total
                };
            }
            byId[r.student_id].scores[r.subject] = Number(r.total);
        });

        var students = Object.keys(byId).map(function (k) {
            var s = byId[k];
            var total = 0;
            var count = 0;
            subjects.forEach(function (sub) {
                var v = s.scores[sub];
                if (typeof v === "number" && !isNaN(v)) {
                    total += v;
                    count++;
                }
            });
            s.subjectCount = count;
            s.total = total;
            s.average = count > 0 ? Math.round((total / count) * 100) / 100 : 0;
            return s;
        });

        // Positions: highest average = 1st; ties share the position.
        students.sort(function (a, b) { return b.average - a.average; });
        var lastAvg = null;
        var lastPos = 0;
        students.forEach(function (s, i) {
            if (lastAvg === null || s.average < lastAvg) {
                lastPos = i + 1;
                lastAvg = s.average;
            }
            s.position = lastPos;
        });

        return { className: className, term: term, session: session, subjects: subjects, students: students };
    }

    function ordinal(n) {
        if (n === 1) return "1st";
        if (n === 2) return "2nd";
        if (n === 3) return "3rd";
        return n + "th";
    }

    /* ---------- render the table (used on screen AND in the PDF) ---------- */
    function buildTableHTML(sheet, fromIdx, toIdx) {
        var html = '<table class="broadsheet"><thead><tr>' +
            '<th>S/N</th><th>Adm No</th><th style="text-align:left;">Student Name</th>';
        sheet.subjects.forEach(function (sub) {
            html += '<th lang="ar">' + escapeHTML(sub) + "</th>";
        });
        html += "<th>Total</th><th>Average</th><th>Position</th></tr></thead><tbody>";

        for (var i = fromIdx; i < toIdx; i++) {
            var s = sheet.students[i];
            html += "<tr><td>" + (i + 1) + "</td><td>" + escapeHTML(s.id) + "</td>" +
                '<td class="bs-name">' + escapeHTML(s.name) + "</td>";
            sheet.subjects.forEach(function (sub) {
                var v = s.scores[sub];
                html += "<td>" + ((typeof v === "number" && !isNaN(v)) ? v : "-") + "</td>";
            });
            html += "<td><b>" + s.total + "</b></td><td>" + s.average + "</td>" +
                "<td>" + ordinal(s.position) + "</td></tr>";
        }
        html += "</tbody></table>";
        return html;
    }

    function escapeHTML(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function pdfHeaderHTML(sheet, pageLabel) {
        return '<div class="bs-head-doc">' +
            '<div class="bs-ar" lang="ar">مَدْرَسَةُ أَمِينِ اللهِ لِلْعُلُومِ الْعَرَبِيَّةِ الْإِسْلَامِيَّةِ</div>' +
            '<div class="bs-en">AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES</div>' +
            '<div class="bs-meta"><b>Class Results Broadsheet</b> &nbsp;\u2022&nbsp; ' +
            escapeHTML(sheet.className) + " \u2022 " + escapeHTML(sheet.term) + " \u2022 " +
            escapeHTML(sheet.session) +
            (pageLabel ? " \u2022 " + pageLabel : "") +
            "</div></div>";
    }

    /* ---------- generate on screen ---------- */
    window.crGenerate = function () {
        var className = document.getElementById("crClass").value;
        var term = document.getElementById("crTerm").value;
        var session = document.getElementById("crSession").value;
        var statusLine = document.getElementById("crStatusLine");

        if (!className || !term || !session) {
            notify("Please select Class, Session and Term first.", "error");
            return;
        }

        statusLine.textContent = "Loading results\u2026";
        document.getElementById("crGenerateBtn").disabled = true;

        fetch("/class-results?class=" + encodeURIComponent(className) +
              "&term=" + encodeURIComponent(term) +
              "&session=" + encodeURIComponent(session))
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (out) {
                document.getElementById("crGenerateBtn").disabled = false;
                if (!out.ok) {
                    statusLine.textContent = "";
                    notify(out.j.message || "Could not load class results.", "error");
                    return;
                }

                var rows = out.j || [];
                if (!rows.length) {
                    lastSheet = null;
                    statusLine.textContent = "No results found for " + className + " (" + term + ", " + session + ") yet.";
                    document.getElementById("crSheetCard").style.display = "none";
                    document.getElementById("crPdfBtn").disabled = true;
                    document.getElementById("crPrintBtn").disabled = true;
                    notify("No results found for that combination yet.", "info");
                    return;
                }

                lastSheet = buildSheet(rows, className, term, session);

                document.getElementById("crSheetWrap").innerHTML =
                    pdfHeaderHTML(lastSheet, "") +
                    buildTableHTML(lastSheet, 0, lastSheet.students.length);
                document.getElementById("crSheetCard").style.display = "block";

                statusLine.textContent = lastSheet.students.length + " student(s) \u2022 " +
                    lastSheet.subjects.length + " subject(s) - ready to download as ONE PDF.";

                document.getElementById("crPdfBtn").disabled = false;
                document.getElementById("crPrintBtn").disabled = false;
            })
            .catch(function () {
                document.getElementById("crGenerateBtn").disabled = false;
                statusLine.textContent = "";
                notify("Network error while loading results.", "error");
            });
    };

    /* ---------- download ONE combined PDF ---------- */
    window.crDownloadPDF = function () {
        if (!lastSheet) {
            notify("Generate the broadsheet first.", "info");
            return;
        }
        if (!window.jspdf || !window.html2canvas) {
            notify("PDF generator is still loading - try again in a moment.", "info");
            return;
        }

        notify("Building class PDF\u2026 please wait.", "info", 2600);

        // Hidden staging area: fixed-width so every chunk renders the same.
        var stage = document.createElement("div");
        stage.style.cssText =
            "position:fixed; left:-12000px; top:0; width:1240px; background:#fff; z-index:-1;";
        document.body.appendChild(stage);

        // Split the student list into page-sized chunks.
        var ROWS_PER_PAGE = 14;
        var chunks = [];
        for (var i = 0; i < lastSheet.students.length; i += ROWS_PER_PAGE) {
            chunks.push([i, Math.min(i + ROWS_PER_PAGE, lastSheet.students.length)]);
        }

        var canvases = [];
        var c = 0;

        function captureNext() {
            if (c >= chunks.length) {
                finish();
                return;
            }
            var range = chunks[c];
            var pageLabel = chunks.length > 1 ? "Page " + (c + 1) + " of " + chunks.length : "";
            stage.innerHTML =
                '<div style="background:#fff; padding:26px 26px 18px; box-sizing:border-box;">' +
                pdfHeaderHTML(lastSheet, pageLabel) +
                buildTableHTML(lastSheet, range[0], range[1]) +
                '<div style="text-align:center; font-size:11px; color:#555; margin-top:10px; font-family:Cairo,sans-serif;">' +
                "Generated " + new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
                " \u2022 Ameenullah School Result System</div>" +
                "</div>";

            // Let the browser paint before measuring/capturing.
            setTimeout(function () {
                html2canvas(stage.firstChild, { scale: 2, backgroundColor: "#ffffff", useCORS: true })
                    .then(function (cv) { canvases.push(cv); c++; captureNext(); })
                    .catch(function () { c++; captureNext(); });
            }, 60);
        }

        function finish() {
            document.body.removeChild(stage);

            if (!canvases.length) {
                notify("Could not build the PDF - please try again.", "error");
                return;
            }

            // A4 landscape is 297 x 210 mm. ONE global fit keeps every
            // page at the same scale (consistent formatting).
            var fits = canvases.map(function (cv) {
                var hMm = (cv.height * 297) / cv.width;
                return hMm > 210 ? 210 / hMm : 1;
            });
            var globalFit = Math.min.apply(null, fits.concat([1]));

            var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
            canvases.forEach(function (cv, idx) {
                var hMm = (cv.height * 297) / cv.width;
                var finalW = 297 * globalFit;
                var finalH = Math.min(hMm * globalFit, 210);
                if (idx > 0) pdf.addPage();
                pdf.addImage(cv.toDataURL("image/jpeg", 0.95), "JPEG", (297 - finalW) / 2, 0, finalW, finalH);
            });

            var safeName = (lastSheet.className + "-" + lastSheet.term + "-" + lastSheet.session)
                .replace(/[\\/:*?"<>|]+/g, "_");
            pdf.save("class-results-" + safeName + ".pdf");

            notify("Class PDF downloaded \u2713 " + lastSheet.students.length +
                " students in ONE document.", "success", 6000);
        }

        captureNext();
    };

    document.addEventListener("DOMContentLoaded", loadClasses);
})();
