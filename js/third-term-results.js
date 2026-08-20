/* ==========================================================================
   js/third-term-results.js  (NEW FILE - ADDITIVE)
   --------------------------------------------------------------------------
   Powers third-term-results.html (the "Third Term Results" feature):

     1. POST /third-term-upload  - send the school's internal grade
        workbook (.xlsx, one sheet per class). The server PARSES it and
        returns every class with subjects + student scores (CA /40,
        Exam /60, Total /100, ف3) - nothing is written to the database.
     2. The admin picks one or all classes; this file computes Grand
        Total, Overall Percentage and class Position, and renders a
        sortable result table per class.
     3. "Download PDF" builds ONE official A4 PDF per class (one page
        per student) with jsPDF + html2canvas (same approach as
        js/class-results.js).
     4. "Download Excel" posts the parsed classes back to
        /third-term-export-excel which returns one consolidated .xlsx
        with a Summary tab + one tab per class.

   Bilingual labels: Arabic on the right, English on the left.
   ========================================================================== */
(function () {
    "use strict";

    var state = {
        fileName: "",
        classes: [],    // parsed classes straight from the server
        results: [],    // computed per class: { className, teacher, subjects, warnings, students(with grandTotal/pct/position) }
        errors: []      // { sheet, reason }
    };

    var sortState = {}; // classIndex -> { key, dir }

    /* ----------------------------------------------------------------
       helpers
       ---------------------------------------------------------------- */
    function notify(msg, type, ms) {
        if (window.amsToast) window.amsToast(msg, type || "info", ms || 5000);
        else alert(msg);
    }

    function esc(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function fmt(v) {
        if (v === null || v === undefined) return "";
        const n = Number(v);
        return isFinite(n) ? String(Math.round(n * 100) / 100) : String(v);
    }

    /* Bilingual label: Arabic on the right, English on the left. */
    function bi(ar, en) {
        return '<span class="bi-lbl"><span class="bi-en">' + esc(en) +
            '</span><span class="bi-ar" dir="rtl" lang="ar">' + esc(ar) + "</span></span>";
    }

    function ordinal(n) {
        const p = Number(n) || 0;
        if (p === 1) return "1st";
        if (p === 2) return "2nd";
        if (p === 3) return "3rd";
        return p + "th";
    }

    function safeFileName(s) {
        return String(s || "class").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "-");
    }

    function setBtn(btn, disabled, label) {
        if (!btn) return;
        btn.disabled = disabled;
        if (label) btn.innerHTML = label;
    }

    /* ----------------------------------------------------------------
       1. Upload + parse
       ---------------------------------------------------------------- */
    window.ttrUpload = function () {
        var input = document.getElementById("ttrFile");
        var btn = document.getElementById("ttrUploadBtn");
        var status = document.getElementById("ttrUploadStatus");

        if (!input.files || !input.files[0]) {
            notify("Choose the grade workbook (.xlsx) first.", "error");
            return;
        }
        var file = input.files[0];
        if (!/\.(xlsx|xls)$/i.test(file.name)) {
            notify("Please choose an .xlsx (or .xls) workbook.", "error");
            return;
        }

        var fd = new FormData();
        fd.append("file", file);

        status.innerHTML = "Parsing <b>" + esc(file.name) + "</b>…";
        setBtn(btn, true, "Parsing…");

        fetch("/third-term-upload", { method: "POST", credentials: "same-origin", body: fd })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                setBtn(btn, false, "&#128230; Upload &amp; Parse");
                if (!res.ok) {
                    status.innerHTML = "";
                    notify(res.d.message || "Could not parse the workbook.", "error", 7000);
                    return;
                }
                var d = res.d;
                state.fileName = d.fileName || file.name;
                state.classes = Array.isArray(d.classes) ? d.classes : [];
                state.errors = Array.isArray(d.errors) ? d.errors : [];

                if (!state.classes.length && !state.errors.length) {
                    status.innerHTML = "";
                    notify("No sheets were found in that workbook.", "error");
                    return;
                }

                /* Compute totals / percentages / positions for EVERY
                   parsed class up-front (cheap), so the Excel export can
                   include classes that were not opened on screen. */
                state.results = state.classes.map(computeClassResult);

                renderErrors();
                renderClassPicker();
                renderExportBar();

                status.innerHTML = "<b>" + esc(state.fileName) + "</b>: " +
                    state.classes.length + " class sheet(s) parsed" +
                    (state.errors.length ? ", " + state.errors.length + " failed sheet(s) — see below." : ".") +
                    " Now pick the classes and press <b>Generate Results</b>.";
                notify("Workbook parsed: " + state.classes.length + " class sheet(s) found.", "success");
            })
            .catch(function () {
                setBtn(btn, false, "&#128230; Upload &amp; Parse");
                status.innerHTML = "";
                notify("Network error while parsing the workbook.", "error");
            });
    };

    /* ----------------------------------------------------------------
       2. Per-class computation (Grand Total, %, Position)
       ---------------------------------------------------------------- */
    function computeClassResult(cls) {
        var subjects = cls.subjects || [];
        var students = (cls.students || []).map(function (st) {
            var grandTotal = 0;
            (st.scores || []).forEach(function (sc) {
                if (sc.total !== null && sc.total !== undefined) grandTotal += Number(sc.total);
            });
            var pct = subjects.length
                ? Math.round((grandTotal / (subjects.length * 100)) * 10000) / 100
                : 0;
            return {
                sn: st.sn,
                adm: st.adm,
                name: st.name,
                scores: st.scores || [],
                missingSubjects: st.missingSubjects || [],
                incomplete: !!st.incomplete,
                grandTotal: grandTotal,
                pct: pct,
                position: 0
            };
        });

        /* Position: highest total = 1st; ties share the position. */
        var sorted = students.slice().sort(function (a, b) { return b.grandTotal - a.grandTotal; });
        var lastTotal = null;
        var lastPos = 0;
        sorted.forEach(function (s, i) {
            if (lastTotal === null || s.grandTotal < lastTotal) {
                lastPos = i + 1;
                lastTotal = s.grandTotal;
            }
            s.position = lastPos;
        });

        var incompleteCount = students.filter(function (s) { return s.incomplete; }).length;

        return {
            sheet: cls.sheet,
            className: cls.className,
            teacher: cls.teacher,
            subjects: subjects,
            warnings: cls.warnings || [],
            students: students,
            incompleteCount: incompleteCount
        };
    }

    /* ----------------------------------------------------------------
       3. Errors + class picker
       ---------------------------------------------------------------- */
    function renderErrors() {
        var card = document.getElementById("ttrErrorsCard");
        var list = document.getElementById("ttrErrorsList");
        if (!state.errors.length) {
            card.style.display = "none";
            list.innerHTML = "";
            return;
        }
        list.innerHTML = state.errors.map(function (e) {
            return '<div class="ttr-err-item">&#9888;&#65039; <b>' + esc(e.sheet) + "</b> — " + esc(e.reason) + "</div>";
        }).join("");
        card.style.display = "block";
    }

    function renderClassPicker() {
        var card = document.getElementById("ttrClassesCard");
        var list = document.getElementById("ttrClassesList");
        var count = document.getElementById("ttrClassesCount");

        if (!state.classes.length) {
            card.style.display = "none";
            return;
        }

        count.textContent = "— " + state.classes.length + " class(es) detected / عدد الفصول المكتشفة: " + state.classes.length;
        list.innerHTML = state.classes.map(function (c, i) {
            var inc = state.results[i] ? state.results[i].incompleteCount : 0;
            var warnHtml = (c.warnings && c.warnings.length)
                ? '<div class="ttr-warn">&#9888;&#65039; ' + c.warnings.map(esc).join(" • ") + "</div>"
                : "";
            return '<label class="ttr-class-check" for="ttrCls' + i + '">' +
                '<input type="checkbox" id="ttrCls' + i + '" value="' + i + '" checked>' +
                "<div>" +
                "<b>" + esc(c.className || c.sheet) + "</b>" +
                '<div class="ttr-sub" lang="ar" dir="rtl" style="text-align:right;">' + esc(c.sheet) + "</div>" +
                '<div class="ttr-sub">' + bi("الأستاذ", "Teacher") + ": " + esc(c.teacher || "—") +
                " &nbsp;•&nbsp; " + (c.students || []).length + " student(s)" +
                (inc ? ' &nbsp;•&nbsp; <span class="ttr-warn">' + inc + ' incomplete</span>' : "") +
                "</div>" + warnHtml +
                "</div></label>";
        }).join("");
        card.style.display = "block";
    }

    window.ttrSelectAll = function (on) {
        var boxes = document.querySelectorAll("#ttrClassesList input[type=checkbox]");
        boxes.forEach(function (b) { b.checked = !!on; });
        updateClassCheckStyles();
    };

    function renderExportBar() {
        document.getElementById("ttrExportBar").style.display =
            state.results.length ? "block" : "none";
    }

    function updateClassCheckStyles() {
        document.querySelectorAll("#ttrClassesList .ttr-class-check").forEach(function (el, i) {
            var box = el.querySelector("input");
            el.classList.toggle("ttr-on", box.checked);
        });
    }

    document.addEventListener("change", function (e) {
        if (e.target && e.target.id && e.target.id.indexOf("ttrCls") === 0) updateClassCheckStyles();
    });

    /* ----------------------------------------------------------------
       4. Generate: show one result card per selected class
       ---------------------------------------------------------------- */
    window.ttrGenerate = function () {
        var wrap = document.getElementById("ttrResults");
        var any = false;
        wrap.innerHTML = "";

        state.results.forEach(function (res, idx) {
            var box = document.getElementById("ttrCls" + idx);
            if (box && !box.checked) return;
            any = true;
            sortState[idx] = { key: "grandTotal", dir: -1 }; // default: best first
            wrap.appendChild(buildClassCard(res, idx));
        });

        if (!any) {
            notify("Select at least one class first.", "info");
            return;
        }
        document.getElementById("ttrExportBar").style.display = "block";
        notify("Results generated.", "success");
    };

    function buildClassCard(res, idx) {
        var card = document.createElement("div");
        card.className = "mng-card";
        card.style.marginBottom = "20px";
        card.id = "ttrCard" + idx;

        var head = document.createElement("div");
        head.className = "ttr-card-head";
        head.innerHTML =
            "<div>" +
            "<h3>" + esc(res.className) + ' <span lang="ar" dir="rtl" style="font-size:13px; color:#5B6B62;">' + esc(res.sheet || "") + "</span></h3>" +
            '<div class="ttr-meta">' +
            bi("الأستاذ", "Teacher") + ": " + esc(res.teacher || "—") +
            " &nbsp;•&nbsp; " + res.subjects.length + " subject(s) / " + res.students.length + " student(s)" +
            (res.incompleteCount ? ' &nbsp;•&nbsp; <span style="color:#B7791F; font-weight:800;">' + res.incompleteCount + " with incomplete data</span>" : "") +
            (res.warnings && res.warnings.length ? ' &nbsp;•&nbsp; <span style="color:#B7791F;">' + res.warnings.map(esc).join(" • ") + "</span>" : "") +
            "</div></div>" +
            '<button type="button" class="mng-btn mng-btn-sm" onclick="ttrDownloadPdf(' + idx + ')">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="vertical-align:-2px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>' +
            "&nbsp; Download Results (PDF)</button>";

        var wrap = document.createElement("div");
        wrap.className = "ttr-table-wrap";
        wrap.innerHTML = buildTableHTML(res, idx, sortState[idx]);

        card.appendChild(head);
        card.appendChild(wrap);
        return card;
    }

    /* Sortable table: two header bands (subject names + CA/Exam/Total/ف3). */
    function buildTableHTML(res, idx, sort) {
        var subjects = res.subjects;
        var students = res.students.slice();

        if (sort && sort.key) {
            var dir = sort.dir;
            students.sort(function (a, b) {
                var va, vb;
                if (sort.key === "name") {
                    va = String(a.name).toLowerCase();
                    vb = String(b.name).toLowerCase();
                    return va < vb ? -dir : va > vb ? dir : 0;
                }
                va = Number(a[sort.key]) || 0;
                vb = Number(b[sort.key]) || 0;
                return (va - vb) * dir;
            });
        }

        var arrow = function (key) {
            if (!sort || sort.key !== key) return '<span class="ttr-sort-arrow">↕</span>';
            return '<span class="ttr-sort-arrow">' + (sort.dir === -1 ? "▼" : "▲") + "</span>";
        };

        var html = '<table class="ttr-table"><thead><tr>';
        html += '<th rowspan="2">S/N</th>';
        html += '<th rowspan="2">Adm No</th>';
        html += '<th rowspan="2" class="ttr-sortable" onclick="ttrSort(' + idx + ',&#39;name&#39;)">' +
            bi("اسم الطالب", "Student Name") + " " + arrow("name") + "</th>";
        subjects.forEach(function (sub) {
            html += '<th colspan="4" lang="ar" dir="rtl">' + esc(sub.name) + "</th>";
        });
        html += '<th rowspan="2" class="ttr-sortable" onclick="ttrSort(' + idx + ',&#39;grandTotal&#39;)">' +
            bi("المجموع الكلي", "Grand Total") + " " + arrow("grandTotal") + "</th>";
        html += '<th rowspan="2" class="ttr-sortable" onclick="ttrSort(' + idx + ',&#39;pct&#39;)">' +
            bi("النسبة المئوية", "%") + " " + arrow("pct") + "</th>";
        html += "<th rowspan=\"2\">" + bi("الترتيب", "Position") + "</th>";
        html += "<th rowspan=\"2\">" + bi("الحالة", "Status") + "</th>";
        html += '</tr><tr class="ttr-band2">';
        subjects.forEach(function () {
            html += "<th>CA /40</th><th>Exam /60</th><th>Total /100</th><th>ف3</th>";
        });
        html += "</tr></thead><tbody>";

        students.forEach(function (st) {
            html += '<tr class="' + (st.incomplete ? "ttr-incomplete" : "") + '">';
            html += "<td>" + esc(st.sn) + "</td><td>" + esc(st.adm) + "</td>";
            html += '<td class="ttr-name">' + esc(st.name) + "</td>";
            st.scores.forEach(function (sc) {
                var cells = [sc.ca, sc.exam, sc.total, sc.t3];
                cells.forEach(function (v) {
                    html += "<td" + (v === null || v === undefined ? ' class="ttr-empty-cell"' : "") + ">" +
                        (v === null || v === undefined ? "—" : fmt(v)) + "</td>";
                });
            });
            html += '<td class="ttr-grand">' + fmt(st.grandTotal) + "</td>";
            html += '<td class="ttr-pct">' + fmt(st.pct) + "%</td>";
            html += '<td class="ttr-pos">' + ordinal(st.position) + "</td>";
            html += st.incomplete
                ? '<td class="ttr-status" title="' + esc(st.missingSubjects.join(", ")) + '">&#9888;&#65039; ' + bi("بيانات ناقصة", "Incomplete Data") + "</td>"
                : "<td>—</td>";
            html += "</tr>";
        });

        html += "</tbody></table>";
        return html;
    }

    window.ttrSort = function (idx, key) {
        var cur = sortState[idx] || { key: "grandTotal", dir: -1 };
        if (cur.key === key) {
            cur.dir = cur.dir === -1 ? 1 : -1; // toggle direction
        } else {
            cur.key = key;
            cur.dir = key === "name" ? 1 : -1; // names A→Z, scores best first
        }
        sortState[idx] = cur;
        var wrap = document.querySelector("#ttrCard" + idx + " .ttr-table-wrap");
        if (wrap) wrap.innerHTML = buildTableHTML(state.results[idx], idx, cur);
    };

    /* ----------------------------------------------------------------
       5. PDF per class (one A4 page per student)
       ---------------------------------------------------------------- */
    function studentPageHTML(res, st, pageNo) {
        var subjects = res.subjects;
        var rows = "";
        st.scores.forEach(function (sc, i) {
            var sub = subjects[i] ? esc(subjects[i].name) : "";
            rows += "<tr>" +
                "<td class=\"ttr-p-subj\" lang=\"ar\" dir=\"rtl\">" + sub + "</td>" +
                "<td>" + (sc.ca === null ? "—" : fmt(sc.ca)) + "</td>" +
                "<td>" + (sc.exam === null ? "—" : fmt(sc.exam)) + "</td>" +
                "<td>" + (sc.total === null ? "—" : fmt(sc.total)) + "</td>" +
                "<td>" + (sc.t3 === null ? "—" : fmt(sc.t3)) + "</td>" +
                "</tr>";
        });

        var warn = st.incomplete
            ? '<div class="ttr-p-warn">&#9888;&#65039; ' +
              bi("بيانات ناقصة", "Incomplete Data") + " — " + esc(st.missingSubjects.join("، ")) +
              " / Missing: " + esc(st.missingSubjects.join(", ")) + "</div>"
            : "";

        return '<div class="ttr-page">' +
            '<div class="ttr-p-head">' +
            '<img class="ttr-p-logo" src="images/LOGO.JPG" alt="">' +
            '<div class="ttr-p-school">' +
            '<div class="ttr-p-en">AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES</div>' +
            '<div class="ttr-p-ar">مَدْرَسَةُ أَمِينِ اللهِ لِلْعُلُومِ الْعَرَبِيَّةِ الْإِسْلَامِيَّةِ</div>' +
            '<div class="ttr-p-motto">MOTTO: KNOWLEDGE AND WORSHIP &nbsp;|&nbsp; الْعِلْمُ وَالْعِبَادَةُ</div>' +
            "</div></div>" +
            '<div class="ttr-p-title">' + bi("نتائج الفصل الثالث — كشف درجات", "THIRD TERM RESULT SHEET") + "</div>" +
            '<div class="ttr-p-info">' +
            '<div class="ttr-p-box">' +
            '<div class="ttr-p-line"><span>' + bi("الصف", "Class") + "</span><span class=\"ttr-p-val\">" + esc(res.className) + "</span></div>" +
            '<div class="ttr-p-line"><span>' + bi("الأستاذ", "Teacher") + "</span><span class=\"ttr-p-val\">" + esc(res.teacher || "—") + "</span></div>" +
            "</div>" +
            '<div class="ttr-p-box">' +
            '<div class="ttr-p-line"><span>' + bi("اسم الطالب", "Student Name") + "</span><span class=\"ttr-p-val\">" + esc(st.name) + "</span></div>" +
            '<div class="ttr-p-line"><span>' + bi("رقم القيد", "Adm No") + "</span><span class=\"ttr-p-val\">" + esc(st.adm || "—") + "</span></div>" +
            "</div>" +
            "</div>" +
            '<table class="ttr-p-table">' +
            "<thead><tr>" +
            "<th>" + bi("المادة", "Subject") + "</th>" +
            "<th>" + bi("التقويم المستمر /40", "CA /40") + "</th>" +
            "<th>" + bi("الامتحان /60", "Exam /60") + "</th>" +
            "<th>" + bi("المجموع /100", "Total /100") + "</th>" +
            "<th>ف3</th>" +
            "</tr></thead><tbody>" + rows + "</tbody></table>" +
            '<div class="ttr-p-sum">' +
            '<div class="ttr-p-cell"><div class="ttr-p-k">' + bi("المجموع الكلي", "GRAND TOTAL") + '</div><div class="ttr-p-v">' + fmt(st.grandTotal) + " / " + (res.subjects.length * 100) + "</div></div>" +
            '<div class="ttr-p-cell"><div class="ttr-p-k">' + bi("النسبة المئوية", "OVERALL PERCENTAGE") + '</div><div class="ttr-p-v">' + fmt(st.pct) + "%</div></div>" +
            '<div class="ttr-p-cell"><div class="ttr-p-k">' + bi("الترتيب في الفصل", "CLASS POSITION") + '</div><div class="ttr-p-v">' + ordinal(st.position) + "</div></div>" +
            "</div>" + warn +
            '<div class="ttr-p-sigs">' +
            '<div class="ttr-p-sig"><div>' + bi("توقيع معلم الفصل", "Class Teacher&apos;s Signature") + "</div></div>" +
            '<div class="ttr-p-sig"><div>' + bi("توقيع المدير", "Principal&apos;s Signature") + "</div></div>" +
            "</div>" +
            '<div class="ttr-p-foot">Generated ' +
            new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
            " • Ameenullah School Result System • " + bi("صفحة", "Page") + " " + pageNo + "</div>" +
            "</div>";
    }

    var pdfRunning = false;

    window.ttrDownloadPdf = function (idx) {
        var res = state.results[idx];
        if (!res) return;
        if (pdfRunning) {
            notify("A PDF is already being built — please wait.", "info");
            return;
        }
        if (!window.jspdf || !window.html2canvas) {
            notify("PDF generator is still loading — try again in a moment.", "info");
            return;
        }
        if (!res.students.length) {
            notify("This class has no students.", "info");
            return;
        }

        pdfRunning = true;
        var btn = document.querySelector('#ttrCard' + idx + ' .mng-btn');
        if (btn) { btn.disabled = true; btn.textContent = "Building PDF…"; }
        notify("Building " + res.students.length + " A4 page(s)…", "info", 3000);

        var stage = document.createElement("div");
        stage.style.cssText = "position:fixed; left:-12000px; top:0; width:794px; background:#fff; z-index:-1;";
        document.body.appendChild(stage);

        var canvases = [];
        var i = 0;

        function captureNext() {
            if (i >= res.students.length) { finish(); return; }
            stage.innerHTML = studentPageHTML(res, res.students[i], i + 1);
            setTimeout(function () {
                html2canvas(stage.firstChild, { scale: 2, backgroundColor: "#ffffff", useCORS: true })
                    .then(function (cv) { canvases.push(cv); i++; captureNext(); })
                    .catch(function () { i++; captureNext(); });
            }, 50);
        }

        function finish() {
            document.body.removeChild(stage);
            pdfRunning = false;
            if (btn) { btn.disabled = false; btn.textContent = "Download Results (PDF)"; }

            if (!canvases.length) {
                notify("Could not build the PDF — please try again.", "error");
                return;
            }

            var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
            var fits = canvases.map(function (cv) {
                var hMm = (cv.height * 210) / cv.width;
                return hMm > 297 ? 297 / hMm : 1;
            });
            var globalFit = Math.min.apply(null, fits.concat([1]));

            canvases.forEach(function (cv, k) {
                var hMm = (cv.height * 210) / cv.width;
                var w = 210 * globalFit;
                var h = Math.min(hMm * globalFit, 297);
                if (k > 0) pdf.addPage();
                pdf.addImage(cv.toDataURL("image/jpeg", 0.95), "JPEG", (210 - w) / 2, 0, w, h);
            });

            pdf.save("third-term-results-" + safeFileName(res.className) + ".pdf");
            notify("PDF downloaded: " + canvases.length + " page(s) — one A4 per student.", "success", 6000);
        }

        captureNext();
    };

    /* ----------------------------------------------------------------
       6. Consolidated Excel export (all classes, one tab each)
       ---------------------------------------------------------------- */
    window.ttrDownloadExcel = function () {
        if (!state.results.length) {
            notify("Parse the workbook first.", "info");
            return;
        }
        var btn = document.getElementById("ttrExcelBtn");
        var status = document.getElementById("ttrExcelStatus");
        setBtn(btn, true, "Building Excel…");
        status.innerHTML = "Building the workbook (" + state.results.length + " class tab(s))…";

        fetch("/third-term-export-excel", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ classes: state.results })
        })
            .then(function (r) {
                if (!r.ok) {
                    return r.json().then(function (d) {
                        throw new Error(d.message || "Export failed.");
                    });
                }
                return r.blob();
            })
            .then(function (blob) {
                var a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "third-term-results-" + new Date().toISOString().slice(0, 10) + ".xlsx";
                document.body.appendChild(a);
                a.click();
                setTimeout(function () {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                }, 150);
                setBtn(btn, false, "Download Excel (All Classes)");
                status.innerHTML = "Excel workbook downloaded — every class is on its own tab.";
                notify("Excel export downloaded.", "success");
            })
            .catch(function (err) {
                setBtn(btn, false, "Download Excel (All Classes)");
                status.innerHTML = "";
                notify(err.message || "Network error while exporting.", "error");
            });
    };

    /* Reset when a new file is picked. */
    document.addEventListener("change", function (e) {
        if (e.target && e.target.id === "ttrFile") {
            state.classes = [];
            state.results = [];
            state.errors = [];
            document.getElementById("ttrResults").innerHTML = "";
            document.getElementById("ttrExportBar").style.display = "none";
            document.getElementById("ttrClassesCard").style.display = "none";
            document.getElementById("ttrErrorsCard").style.display = "none";
            document.getElementById("ttrUploadStatus").innerHTML = "";
        }
    });
})();
