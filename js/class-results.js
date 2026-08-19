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
    var amsSignaturesCache = []; /* NEW (request #6): for PDF footers */
    var amsClassSignaturesCache = null; /* NEW (per-class teacher signatures): class_name -> image, fetched once per zip run */
    var zipCancelled = false;    /* NEW (request #5) */

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
        var isThird = term === "3rd Term";
        var byId = {};
        rows.forEach(function (r) {
            if (!byId[r.student_id]) {
                byId[r.student_id] = {
                    id: r.student_id,
                    name: r.student_name,
                    scores: {} // subject -> score
                };
            }
            // FIX (pack 88): for 3rd Term the report sheet shows each
            // subject's cumulative three-term average, so the broadsheet
            // uses the same number - totals, averages and positions then
            // agree with the printed report cards.
            var v = (isThird && r.cumulative_average !== null && r.cumulative_average !== undefined)
                ? Number(r.cumulative_average)
                : Number(r.total);
            byId[r.student_id].scores[r.subject] = v;
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

        return { className: className, term: term, session: session, subjects: subjects, students: students, cumulative: isThird };
    }

    function ordinal(n) {
        if (n === 1) return "1st";
        if (n === 2) return "2nd";
        if (n === 3) return "3rd";
        return n + "th";
    }

    /* FIX (pack 21 - owner: no more "45.00"): scores show as clean whole
       numbers on the broadsheet too. Display-only; stored values and the
       position math are untouched. */
    function fmtScore(v) {
        var n = Number(v);
        return isFinite(n) ? String(Math.round(n)) : String(v);
    }

    /* ---------- render the table (used on screen AND in the PDF) ---------- */
    function buildTableHTML(sheet, fromIdx, toIdx, showActions) {
        var html = '<table class="broadsheet"><thead><tr>' +
            '<th>S/N</th><th>Adm No</th><th style="text-align:left;">Student Name</th>';
        sheet.subjects.forEach(function (sub) {
            html += '<th lang="ar">' + escapeHTML(sub) + "</th>";
        });
        html += "<th>Total</th><th>Average</th><th>Position</th>";
        if (showActions) {
            html += '<th class="bs-action-col">Action</th>';
        }
        html += "</tr></thead><tbody>";

        for (var i = fromIdx; i < toIdx; i++) {
            var s = sheet.students[i];
            html += "<tr><td>" + (i + 1) + "</td><td>" + escapeHTML(s.id) + "</td>" +
                '<td class="bs-name">' + escapeHTML(s.name) + "</td>";
            sheet.subjects.forEach(function (sub) {
                var v = s.scores[sub];
                html += "<td>" + ((typeof v === "number" && !isNaN(v)) ? fmtScore(v) : "-") + "</td>";
            });
            html += "<td><b>" + fmtScore(s.total) + "</b></td><td>" + fmtScore(s.average) + "</td>" +
                "<td>" + ordinal(s.position) + "</td>";
            if (showActions) {
                var escName = escapeHTML(s.name).replace(/'/g, "\\'");
                html += '<td class="bs-action-col"><button type="button" class="mng-btn-sm mng-btn-ghost bs-del-btn" onclick="crDeleteStudentScores(\'' + escapeHTML(s.id) + '\', \'' + escName + '\')">🗑️ Delete</button></td>';
            }
            html += "</tr>";
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
        // CHANGED (request #6): school logo added to every PDF page.
        return '<div class="bs-head-doc">' +
            '<div style="display:flex; align-items:center; gap:14px; justify-content:center;">' +
            '<img src="images/LOGO.JPG" alt="" style="width:58px; height:58px; object-fit:cover; border-radius:50%; border:2px solid #0F3D2E;">' +
            '<div>' +
            '<div class="bs-ar" lang="ar">مَدْرَسَةُ أَمِينِ اللهِ لِلْعُلُومِ الْعَرَبِيَّةِ الْإِسْلَامِيَّةِ</div>' +
            '<div class="bs-en">AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES</div>' +
            "</div>" +
            "</div>" +
            '<div class="bs-meta"><b>Class Results Broadsheet</b> &nbsp;\u2022&nbsp; ' +
            escapeHTML(sheet.className) + " \u2022 " + escapeHTML(sheet.term) +
            (sheet.cumulative ? " (3-term average)" : "") + " \u2022 " +
            escapeHTML(sheet.session) +
            (pageLabel ? " &nbsp;\u2022&nbsp; <b>" + pageLabel + "</b>" : "") +
            "</div></div>";
    }

    // CHANGED (request #6): signatures footer for the final PDF page.
    function pdfSignaturesHTML() {
        const teacher = amsSignaturesCache.find(s => s.role === "class_teacher");
        const principal = amsSignaturesCache.find(s => s.role === "principal");
        const box = (sig, label) =>
            '<div style="text-align:center; width:220px;">' +
            (sig ? `<img src="${sig.signature_path}" alt="" style="height:46px; object-fit:contain; display:block; margin:0 auto;">` : '<div style="height:46px;"></div>') +
            '<div style="border-top:1.5px solid #333; margin-top:4px; padding-top:4px; font-size:11.5px; font-weight:700;">' + label + "</div>" +
            "</div>";
        return '<div style="display:flex; justify-content:space-between; margin-top:34px; padding:0 30px;">' +
            box(teacher, "Class Teacher's Signature") +
            box(principal, "Principal's Signature") +
            "</div>";
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
                    var ac = document.getElementById("crAnalyticsCard"); if (ac) ac.style.display = "none";
                    var clBtn = document.getElementById("crClearClassBtn"); if (clBtn) clBtn.disabled = true;
                    document.getElementById("crPdfBtn").disabled = true;
                    document.getElementById("crPrintBtn").disabled = true;
                    notify("No results found for that combination yet.", "info");
                    return;
                }

                lastSheet = buildSheet(rows, className, term, session);
                renderAnalytics(lastSheet);

                document.getElementById("crSheetWrap").innerHTML =
                    pdfHeaderHTML(lastSheet, "") +
                    buildTableHTML(lastSheet, 0, lastSheet.students.length, true);
                document.getElementById("crSheetCard").style.display = "block";

                statusLine.textContent = lastSheet.students.length + " student(s) \u2022 " +
                    lastSheet.subjects.length + " subject(s) - ready to download as ONE PDF.";

                document.getElementById("crPdfBtn").disabled = false;
                document.getElementById("crPrintBtn").disabled = false;
                document.getElementById("crZipBtn").disabled = false; /* NEW (request #5) */
                var clBtn2 = document.getElementById("crClearClassBtn"); if (clBtn2) clBtn2.disabled = false;
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
            var isLast = c === chunks.length - 1;
            // CHANGED (request #6): page numbering on EVERY page.
            var pageLabel = "Page " + (c + 1) + " of " + chunks.length;
            stage.innerHTML =
                '<div style="background:#fff; padding:26px 26px 18px; box-sizing:border-box;">' +
                pdfHeaderHTML(lastSheet, pageLabel) +
                buildTableHTML(lastSheet, range[0], range[1], false) +
                // CHANGED (request #6): signatures close the final page.
                (isLast ? pdfSignaturesHTML() : "") +
                '<div style="text-align:center; font-size:11px; color:#555; margin-top:14px; font-family:Cairo,sans-serif;">' +
                "Generated " + new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
                " \u2022 Ameenullah School Result System \u2022 " + pageLabel + "</div>" +
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

    /* ==========================================================
       NEW (request #5): Download All Student Results (ZIP)
       ----------------------------------------------------------
       For every student in the generated broadsheet we render the
       EXACT report sheet used on the Check Result page (shared
       renderer in js/report-card.js), capture it, and add it to
       one zip archive: Student1.pdf, Student2.pdf, ...
       Everything happens on the device - the server only serves
       the normal read-only endpoints it already had.
    ========================================================== */
    var zipRunning = false;

    window.crZipCancel = function () {
        if (zipRunning) {
            zipCancelled = true;
            var t = document.getElementById("crZipText");
            if (t) t.textContent = "Cancelling\u2026";
        }
    };

    function crZipSetProgress(done, total, label) {
        var wrap = document.getElementById("crZipProgress");
        var bar = document.getElementById("crZipBar");
        var text = document.getElementById("crZipText");
        wrap.style.display = "block";
        bar.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
        text.textContent = label || ("Building report " + done + " of " + total + "\u2026");
    }

    function crZipHideProgress() {
        document.getElementById("crZipProgress").style.display = "none";
        document.getElementById("crZipBar").style.width = "0%";
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    /* FIX (pack 30 - owner: "the zip is not displaying well, let it display
       as it is in check results"): collect the vertical positions where an
       A4 page break is SAFE (bottoms of table rows/sections) so the PDF
       slicer never chops a score row in half. Returned in CANVAS pixels. */
    function crCutGuides(card, canvas) {
        var cardRect = card.getBoundingClientRect();
        if (!cardRect.width) return null;
        var k = canvas.width / cardRect.width;
        var out = [];
        card.querySelectorAll("tr").forEach(function (el) {
            var r = el.getBoundingClientRect();
            if (r.height) out.push(Math.round((r.bottom - cardRect.top) * k));
        });
        return out;
    }

    window.crDownloadAllZip = async function () {
        if (!lastSheet) {
            notify("Generate the broadsheet first.", "info");
            return;
        }
        if (zipRunning) return; // already building

        if (!window.JSZip || !window.jspdf || !window.html2canvas ||
            !window.amsBuildReportCard || !window.amsCanvasToA4Pdf) {
            notify("PDF tools are still loading - try again in a moment.", "info");
            return;
        }

        zipRunning = true;
        zipCancelled = false;

        var zip = new window.JSZip();
        var skipped = [];
        var total = lastSheet.students.length;

        // Off-screen staging area with a fixed report width.
        var stage = document.createElement("div");
        // CHANGED (pack 90): .rcpzip now reproduces the REAL full A4 result
        // layout (not the old shortened compact card), including the larger
        // header and a score table that fills the page without blank bands.
        stage.className = "ams-staging rcpzip";
        stage.style.width = "794px";
        document.body.appendChild(stage);

        // Signatures are identical for every report - fetch once (#8 speed).
        var signatures = amsSignaturesCache;
        if (!signatures.length) {
            try {
                signatures = await fetch("/signatures").then(r => r.json());
            } catch (e) { signatures = []; }
        }

        // NEW (per-class teacher signatures): also fetch the class-assigned
        // ones once, so every report in the zip stamps ITS OWN class's
        // teacher signature (fallback to the shared one happens inside
        // amsBuildReportCard).
        if (amsClassSignaturesCache === null) {
            try {
                amsClassSignaturesCache = await fetch("/class-signatures").then(r => r.json());
            } catch (e) { amsClassSignaturesCache = []; }
            if (!Array.isArray(amsClassSignaturesCache)) amsClassSignaturesCache = [];
        }

        try {
            for (var i = 0; i < total; i++) {
                if (zipCancelled) break;

                var stu = lastSheet.students[i];
                crZipSetProgress(i, total, "Building report " + (i + 1) + " of " + total +
                    " \u2014 " + stu.name);

                try {
                    var pack = await window.amsFetchReportPack(
                        stu.id, lastSheet.term, lastSheet.session,
                        { signatures: signatures, classSignatures: amsClassSignaturesCache }
                    );

                    if (!pack.rows.length) {
                        skipped.push(stu.name + " (no results found)");
                        continue;
                    }

                    stage.innerHTML = "";
                    var card = window.amsBuildReportCard(pack, lastSheet.term, lastSheet.session);
                    stage.appendChild(card);

                    await window.amsWaitForImages(card, 4000);

                    /* FIX (pack 37): the zip is built on phones - tell
                       html2canvas to lay the card out as if the window
                       were 1400px wide, so mobile media queries can
                       never stack the header/signatures (the .rcpzip
                       CSS pins the row layout too - belt and braces). */
                    var canvas = await html2canvas(card, {
                        scale: 2,
                        backgroundColor: "#ffffff",
                        useCORS: true,
                        windowWidth: 1024
                    });

                    /* FIX (pack 30): phones under memory pressure sometimes
                       return an all-white capture. Detect it and retry the
                       whole render ONCE at a lighter scale - exactly the
                       same guard the exam downloader got earlier. */
                    if (window.amsCanvasLooksBlank && window.amsCanvasLooksBlank(canvas)) {
                        await sleep(300);
                        stage.innerHTML = "";
                        card = window.amsBuildReportCard(pack, lastSheet.term, lastSheet.session);
                        stage.appendChild(card);
                        await window.amsWaitForImages(card, 4000);
                        canvas = await html2canvas(card, {
                            scale: 1.6,
                            backgroundColor: "#ffffff",
                            useCORS: true,
                            windowWidth: 1024 /* FIX (pack 80): same desktop windowWidth on retry */
                        });
                    }

                    /* CHANGED (pack 90): force one A4 page with the same
                       10mm print margin used by Check Result. The staged card
                       already has the official 190×277mm proportions, so it
                       fills the page like the real result instead of being a
                       short form centred on the sheet. */
                    var pdf = window.amsCanvasToA4Pdf(canvas, 0.95, null, true, { margin: 10 });
                    var blob = pdf.output("blob");

                    var safe = (stu.id + "-" + stu.name).replace(/[\\/:*?"<>|]+/g, "_");
                    zip.file((i + 1) + ". " + safe + ".pdf", blob);
                } catch (err) {
                    console.log("Report failed for", stu.name, err);
                    skipped.push(stu.name + " (error)");
                }

                // Let the phone breathe between students (#8 performance).
                await sleep(60);
            }

            if (zipCancelled) {
                notify("Zip download cancelled.", "info");
                return;
            }

            var builtCount = total - skipped.length;
            if (builtCount === 0) {
                notify("No report could be built for this class.", "error");
                return;
            }

            crZipSetProgress(total, total, "Packing " + builtCount + " PDF(s) into one zip\u2026");
            var zipBlob = await zip.generateAsync({
                type: "blob",
                compression: "STORE" // PDFs are already compressed - faster packing
            });

            var a = document.createElement("a");
            a.href = URL.createObjectURL(zipBlob);
            var safeName = (lastSheet.className + "-" + lastSheet.term + "-" + lastSheet.session)
                .replace(/[\\/:*?"<>|]+/g, "_");
            a.download = "all-results-" + safeName + ".zip";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);

            notify(
                "ZIP downloaded \u2713 " + builtCount + " student report(s) in one file." +
                (skipped.length ? " Skipped: " + skipped.join(", ") : ""),
                skipped.length ? "info" : "success",
                9000
            );
        } finally {
            zipRunning = false;
            zipCancelled = false;
            stage.remove();
            crZipHideProgress();
        }
    };

    /* ---------- NEW (print all classes): broadsheet for EVERY class ----------
       Fills the hidden #crPrintAllArea with one broadsheet per class (for the
       selected session + term) and opens the print dialog. Each class starts
       on its own page; classes with no saved results are skipped. */
    window.crPrintAllClasses = async function () {
        var term = document.getElementById("crTerm").value;
        var session = document.getElementById("crSession").value;
        if (!term || !session) {
            notify("Please select Session and Term first.", "error");
            return;
        }

        var btn = document.getElementById("crPrintAllBtn");
        if (btn) btn.disabled = true;
        notify("Preparing all classes for printing\u2026", "info", 3000);

        var area = document.getElementById("crPrintAllArea");
        area.innerHTML = "";

        var classes = [];
        try {
            classes = await fetch("/classes").then(function (r) { return r.json(); });
        } catch (e) { classes = []; }
        if (!Array.isArray(classes) || !classes.length) {
            notify("No classes found.", "error");
            if (btn) btn.disabled = false;
            return;
        }

        var printed = 0;
        for (var i = 0; i < classes.length; i++) {
            var cname = classes[i].class_name || classes[i];
            try {
                var rows = await fetch("/class-results?class=" + encodeURIComponent(cname) +
                    "&term=" + encodeURIComponent(term) +
                    "&session=" + encodeURIComponent(session)).then(function (r) { return r.json(); });
                if (!rows || !rows.length) continue;
                var sheet = buildSheet(rows, cname, term, session);
                if (!sheet.students.length) continue;
                var page = document.createElement("div");
                page.className = "bs-print-page";
                // No fixed page label - a large class can span more than one
                // printed sheet, so the browser's own pagination is used.
                page.innerHTML = pdfHeaderHTML(sheet, null) +
                    buildTableHTML(sheet, 0, sheet.students.length, false);
                area.appendChild(page);
                printed++;
            } catch (e) {
                console.log("Print-all failed for", cname, e);
            }
        }

        if (!printed) {
            notify("No saved results to print for " + term + " (" + session + ").", "error");
            area.innerHTML = "";
            if (btn) btn.disabled = false;
            return;
        }

        // Give the freshly-added broadsheets a moment to lay out (and the
        // school logo to decode) before the print dialog snapshots them.
        await sleep(200);
        document.body.classList.add("cr-printing-all");
        window.print();
        setTimeout(function () {
            document.body.classList.remove("cr-printing-all");
            area.innerHTML = "";
            if (btn) btn.disabled = false;
        }, 1500);
    };

    /* ---------- NEW (Pack 45): Purge Ghost Scores ---------- */
    window.crCleanOrphans = function () {
        if (!confirm("Scan the database and purge any ghost scores belonging to deleted or non-existent students?")) return;
        var btn = document.getElementById("crCleanOrphanBtn");
        if (btn) btn.disabled = true;
        fetch("/api/clean-orphan-results", { method: "DELETE" })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (btn) btn.disabled = false;
                notify(data.message || "Ghost score cleanup complete.", "success");
                if (lastSheet && typeof window.crGenerate === "function") {
                    window.crGenerate();
                }
            })
            .catch(function () {
                if (btn) btn.disabled = false;
                notify("Error while cleaning ghost scores.", "error");
            });
    };

    /* ---------- NEW (Pack 45): Clear All Scores for Current Class/Term ---------- */
    window.crClearClassScores = function () {
        var className = document.getElementById("crClass").value;
        var term = document.getElementById("crTerm").value;
        var session = document.getElementById("crSession").value;
        if (!className || !term || !session) {
            notify("Please select Class, Session and Term first.", "error");
            return;
        }
        if (!confirm("WARNING: Are you sure you want to delete ALL saved results for " + className + " (" + term + ", " + session + ")? This cannot be undone!")) return;
        var btn = document.getElementById("crClearClassBtn");
        if (btn) btn.disabled = true;
        fetch("/api/clear-class-term-results", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ class_name: className, term: term, session: session })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (btn) btn.disabled = false;
                notify(data.message || "Class scores cleared.", "success");
                window.crGenerate();
            })
            .catch(function () {
                if (btn) btn.disabled = false;
                notify("Error clearing class scores.", "error");
            });
    };

    /* ---------- NEW (Pack 45): One-Click Delete Student Scores from Broadsheet ---------- */
    window.crDeleteStudentScores = function (studentId, studentName) {
        var term = document.getElementById("crTerm").value;
        var session = document.getElementById("crSession").value;
        if (!confirm("Delete all saved scores for " + studentName + " (" + studentId + ") in " + term + " (" + session + ")?")) return;
        fetch("/api/delete-student-term-results", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ student_id: studentId, term: term, session: session })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                notify("Deleted scores for " + studentName + ".", "success");
                window.crGenerate();
            })
            .catch(function () {
                notify("Could not delete scores.", "error");
            });
    };

    /* ---------- NEW (Pack 45 Benefit): Render Analytics (Completeness & Champions) ---------- */
    function renderAnalytics(sheet) {
        var card = document.getElementById("crAnalyticsCard");
        var banner = document.getElementById("crCompletenessBanner");
        var champs = document.getElementById("crChampionsWrap");
        if (!card || !banner || !champs) return;

        // 1. Score completeness
        var totalSubs = sheet.subjects.length;
        var missingStudents = [];
        sheet.students.forEach(function (s) {
            if (s.subjectCount < totalSubs) {
                var missing = [];
                sheet.subjects.forEach(function (sub) {
                    if (typeof s.scores[sub] !== "number" || isNaN(s.scores[sub])) {
                        missing.push(sub);
                    }
                });
                missingStudents.push({ name: s.name, missing: missing });
            }
        });

        if (missingStudents.length === 0) {
            banner.innerHTML =
                '<div class="cr-complete-banner cr-complete-success">' +
                '<span class="cr-badge-icon">✨</span>' +
                '<div>' +
                '<strong>100% Score Completeness</strong>' +
                '<div>All ' + sheet.students.length + ' student(s) have scores recorded across all ' + totalSubs + ' subject(s).</div>' +
                '</div></div>';
        } else {
            var chipsHTML = "";
            missingStudents.forEach(function (ms) {
                chipsHTML += '<span class="cr-missing-chip">' + escapeHTML(ms.name) + ': Missing ' + escapeHTML(ms.missing.join(", ")) + '</span>';
            });
            banner.innerHTML =
                '<div class="cr-complete-banner cr-complete-warning">' +
                '<span class="cr-badge-icon">⚠️</span>' +
                '<div>' +
                '<strong>Incomplete Subject Scores Detected</strong>' +
                '<div>' + missingStudents.length + ' of ' + sheet.students.length + ' student(s) have missing subject scores:</div>' +
                '<div class="cr-missing-list">' + chipsHTML + '</div>' +
                '</div></div>';
        }

        // 2. Subject Champions
        var champListHTML = "";
        sheet.subjects.forEach(function (sub) {
            var topScore = -1;
            var topNames = [];
            sheet.students.forEach(function (s) {
                var v = s.scores[sub];
                if (typeof v === "number" && !isNaN(v)) {
                    if (v > topScore) {
                        topScore = v;
                        topNames = [s.name];
                    } else if (v === topScore) {
                        topNames.push(s.name);
                    }
                }
            });
            if (topScore >= 0) {
                champListHTML +=
                    '<div class="cr-champion-pill">' +
                    '<span class="cr-champ-sub">' + escapeHTML(sub) + ':</span>' +
                    '<span class="cr-champ-name">' + escapeHTML(topNames.join(", ")) + ' (' + fmtScore(topScore) + ')</span>' +
                    '</div>';
            }
        });

        if (champListHTML) {
            champs.innerHTML =
                '<div class="cr-champions-title">🏆 Subject Champions (Honour Roll)</div>' +
                '<div class="cr-champions-list">' + champListHTML + '</div>';
        } else {
            champs.innerHTML = "";
        }

        card.style.display = "block";
    }

    document.addEventListener("DOMContentLoaded", function () {
        loadClasses();
        // NEW (request #6): signatures for the broadsheet PDF footer.
        fetch("/signatures")
            .then(r => r.json())
            .then(sigs => { amsSignaturesCache = Array.isArray(sigs) ? sigs : []; })
            .catch(() => {});
        // NEW (per-class teacher signatures): warm the cache too.
        fetch("/class-signatures")
            .then(r => r.json())
            .then(cs => { amsClassSignaturesCache = Array.isArray(cs) ? cs : []; })
            .catch(() => {});
    });
})();
