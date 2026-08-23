/* ==========================================================================
   REPORT CARD BUILDER  (js/report-card.js)  [NEW FILE - ADDITIVE]
   --------------------------------------------------------------------------
   Reusable renderer that builds the EXACT same report sheet design used
   on the Check Result page, so whole-class downloads (request #5) produce
   "every student's individual report sheet exactly like the current
   design" from one shared piece of code (code quality, request #10).

   IMPORTANT: this file DUPLICATES the display logic of js/result.js on
   purpose and NEVER sends anything to the server. js/result.js itself is
   untouched. All remarks, averages and 3rd-term cumulative views mirror
   js/result.js exactly, using the same server data endpoints.
========================================================================== */

(function () {
    "use strict";

    /* FIX (pack 21 - owner: no more "45.00"): display scores as clean
       whole numbers (49.7 -> 50). Display-only - database values and the
       average used for remarks stay exactly as computed. */
    function amsFmtScore(v) {
        if (v === null || v === undefined || v === "") return "-";
        if (v === "-") return "-";
        const n = Number(v);
        return isFinite(n) ? String(Math.round(n)) : String(v);
    }

    function esc(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /* NEW (owner request): Arabic for the three term names, identical to
       the Check Result page (js/result.js -> amsTermAr). */
    function amsTermAr(term) {
        var t = String(term || "");
        if (t.indexOf("1st") === 0) return "الفترة الأولى";
        if (t.indexOf("2nd") === 0) return "الفترة الثانية";
        if (t.indexOf("3rd") === 0) return "الفترة الثالثة";
        return "";
    }

    /* The third-term Total is the subject's 1st + 2nd + 3rd term score.
       Prefer the API field, with a fallback so an already-open page that
       receives an older response still renders the right total. */
    function cumulativeTotalFor(result, firstTotal, secondTotal, thirdTotal) {
        const supplied = result && result.cumulative_total;
        const suppliedNumber = Number(supplied);
        if (supplied !== null && supplied !== undefined && supplied !== "" && Number.isFinite(suppliedNumber)) {
            return suppliedNumber;
        }
        return [firstTotal, secondTotal, thirdTotal].reduce((sum, value) => {
            const number = Number(value);
            return Number.isFinite(number) ? sum + number : sum;
        }, 0);
    }

    /* Fetch everything one report needs (read-only public endpoints,
       the very same ones the Check Result page uses).
       Pass sharedSignatures (fetched once by the caller) to avoid
       re-downloading them for every student in a class zip. */
    // CHANGED (per-class class teacher signature, owner request):
    // sharedSignatures is now a pack { signatures, classSignatures }.
    // A plain array (older callers) is treated as just the role list.
    window.amsFetchReportPack = function (studentId, term, session, sharedSignatures, className) {
        const enc = encodeURIComponent;
        const sigPromise = sharedSignatures
            ? Promise.resolve(sharedSignatures)
            : Promise.all([
                fetch("/signatures").then(r => r.json()).catch(() => []),
                fetch("/class-signatures").then(r => r.json()).catch(() => [])
            ]).then(([sigs, classSigs]) => ({ signatures: sigs, classSignatures: classSigs }));
        return Promise.all([
            fetch(`/search-result/${enc(studentId)}?term=${enc(term)}&session=${enc(session)}`)
                .then(r => r.json()),
            fetch(`/student/${enc(studentId)}`).then(r => r.json()).catch(() => []),
            sigPromise
        ]).then(([rows, studentArr, sigPack]) => {
            const st = Array.isArray(studentArr) && studentArr.length ? studentArr[0] : null;
            const cls = className || (st && st.class_name) || (Array.isArray(rows) && rows.length && rows[0].class_name) || "";
            const posUrl = cls
                ? `/student-position/${enc(studentId)}?className=${enc(cls)}&term=${enc(term)}&session=${enc(session)}`
                : `/student-position/${enc(studentId)}`;
            return fetch(posUrl)
                .then(r => r.ok ? r.json() : {})
                .catch(() => ({}))
                .then(positionData => ({
                    rows: Array.isArray(rows) ? rows : [],
                    student: st,
                    position: positionData && positionData.position ? positionData.position : null,
                    signatures: Array.isArray(sigPack)
                        ? sigPack
                        : (sigPack.signatures || []),
                    classSignatures: Array.isArray(sigPack)
                        ? []
                        : (sigPack.classSignatures || [])
                }));
        });
    };

    function positionSuffix(position) {
        let suffix = "th";
        if (position == 1) suffix = "st";
        else if (position == 2) suffix = "nd";
        else if (position == 3) suffix = "rd";
        return position + suffix;
    }

    /* Build the report sheet DOM node (same markup/classes as the live
       report on student-result.html, so the same CSS styles it). */
    window.amsBuildReportCard = function (pack, term, session) {
        const data = pack.rows;
        const isThirdTerm = term === "3rd Term";

        const root = document.createElement("div");
        root.className = "report-container";
        root.id = "reportContainer";

        if (!data.length) return root; // empty - caller decides what to do

        const first = data[0];

        // Report level label - identical rules to js/result.js
        let reportLevel;
        if (first.class_name.includes("الثّانويّ")) {
            reportLevel = "STUDENT REPORT SHEET كشف درجات الطّالب (الثّانويّة)";
        } else if (first.class_name.includes("الإعداديّ")) {
            reportLevel = "STUDENT REPORT SHEET كشف درجات الطّالب (الإعداديّة)";
        } else {
            reportLevel = "STUDENT REPORT SHEET كشف درجات الطّالب (الابتدائيّة)";
        }

        const photoSrc = (pack.student && pack.student.photo_path) ? pack.student.photo_path : "images/default.png";
        // CHANGED (per-class signature): the signature assigned to THIS
        // report's class wins; shared Class Teacher signature = fallback.
        const perClassSig = (pack.classSignatures || []).find(c => c.class_name === first.class_name);
        const classTeacherSig = perClassSig || pack.signatures.find(s => s.role === "class_teacher");
        const principalSig = pack.signatures.find(s => s.role === "principal");

        // Scores table - identical columns to js/result.js
        let tableRows = "";
        let totalScore = 0;
        let average = 0;

        if (isThirdTerm) {
            /* Third-term cumulative reports use the requested order:
               Average, Grade, Total, 3rd /100, 2nd /100, 1st /100, Subject.
               CHANGED (owner request): bilingual headers - term names,
               Average (النسبة المئوية), Total (الدرجة الكلية) and Subject
               (المواد الدراسية) carry their Arabic on the second line. */
            tableRows += `<tr><th>Average<br><span lang="ar">النسبة المئوية</span></th><th>Grade<br><span lang="ar">الدرجة</span></th><th>Total<br><span lang="ar">الدرجة الكلية</span></th><th>3rd Term /100<br><span lang="ar">الفترة الثالثة</span></th><th>2nd Term /100<br><span lang="ar">الفترة الثانية</span></th><th>1st Term /100<br><span lang="ar">الفترة الأولى</span></th><th>Subject<br><span lang="ar">المواد الدراسية</span></th></tr>`;
            data.forEach(result => {
                const firstTotal = result.first_term_total !== null && result.first_term_total !== undefined ? result.first_term_total : "-";
                const secondTotal = result.second_term_total !== null && result.second_term_total !== undefined ? result.second_term_total : "-";
                const thirdTotal = result.third_term_total !== null && result.third_term_total !== undefined
                    ? result.third_term_total
                    : result.total;
                const cumulativeAvg = result.cumulative_average;
                const cumulativeTotal = cumulativeTotalFor(result, firstTotal, secondTotal, thirdTotal);
                const grade = result.cumulative_grade || result.grade || "";
                tableRows += `<tr><td>${cumulativeAvg !== null && cumulativeAvg !== undefined ? amsFmtScore(cumulativeAvg) : "-"}</td><td>${esc(grade)}</td><td>${amsFmtScore(cumulativeTotal)}</td><td>${amsFmtScore(thirdTotal)}</td><td>${amsFmtScore(secondTotal)}</td><td>${amsFmtScore(firstTotal)}</td><td>${esc(result.subject)}</td></tr>`;
                // Grand Total = T1 + T2 + T3 across every subject.
                totalScore += (Number(firstTotal) || 0) + (Number(secondTotal) || 0) + (Number(thirdTotal) || 0);
            });
            average = data.length > 0 ? Number((totalScore / (data.length * 3)).toFixed(2)) : 0;
            // Total + the three term columns form the four-cell label span.
            tableRows += `<tr><td><strong>${amsFmtScore(average)}</strong></td><td></td><td colspan="4"><strong>Cumulative Average<br><span lang="ar">المعدل التراكمي</span></strong></td><td></td></tr>`;
        } else {
            /* First and second term order: Average, Grade, Total, Exam, CA, Subject.
               CHANGED (owner request): same bilingual treatment as the 3rd term. */
            tableRows += `<tr><th>Average<br><span lang="ar">النسبة المئوية</span></th><th>Grade<br><span lang="ar">الدرجة</span></th><th>Total<br><span lang="ar">الدرجة الكلية</span></th><th>Exam<br><span lang="ar">الاختبار</span></th><th>CA<br><span lang="ar">التقييم المستمر</span></th><th>Subject<br><span lang="ar">المواد الدراسية</span></th></tr>`;
            // FIX (owner: "the average for 1st term and 2nd term is not
            // displaying"): mirror of the js/result.js fix - each subject
            // row shows its /100 percentage (total) in the Average column.
            data.forEach(result => {
                const subjectPct = (result.total !== null && result.total !== undefined && result.total !== "" && result.total !== "-")
                    ? amsFmtScore(result.total)
                    : "-";
                tableRows += `<tr><td>${subjectPct}</td><td>${esc(result.grade)}</td><td>${amsFmtScore(result.total)}</td><td>${amsFmtScore(result.exam_score)}</td><td>${amsFmtScore(result.ca_score)}</td><td>${esc(result.subject)}</td></tr>`;
                totalScore += Number(result.total) || 0;
            });
            average = data.length > 0 ? Number((totalScore / data.length).toFixed(2)) : 0;
            // CHANGED (owner): summary label reads "Average / النسبة المئوية"
            // (percentage), matching the column header, instead of "المعدل".
            // Total, Exam and CA form the score span; Grade/Subject stay blank.
            tableRows += `<tr><td><strong>${amsFmtScore(average)}</strong></td><td></td><td colspan="3"><strong>Average<br><span lang="ar">النسبة المئوية</span></strong></td><td></td></tr>`;
        }

        // Remarks - identical thresholds and wording to js/result.js
        let teacherRemark;
        if (average >= 70) teacherRemark = "Excellent Performance. Keep it up!";
        else if (average >= 60) teacherRemark = "Very Good Performance.";
        else if (average >= 50) teacherRemark = "Good Performance. Work harder.";
        else if (average >= 40) teacherRemark = "Fair Performance. More effort is needed.";
        else teacherRemark = "Poor Performance. Serious improvement is required.";

        const principalRemark = average >= 50 ? "Promoted" : "Repeat Class";

        const positionText = pack.position ? positionSuffix(pack.position) : "-";

        root.innerHTML = `
    <div class="report-header">
      <img src="images/LOGO.JPG" class="school-logo">
      <div class="school-details">
        <h1 lang="ar">مدرسة أمين اللّه للعلوم العربيّة الإسلاميّة</h1>
        <h1>AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES</h1>
        <p class="address">3, Temidire street, Off Ondo Road, Ijeb-Ode, Ogun State.</p>
        <p class="contact">Tel: 08062445559, 08058306889  |  Email: madrasatuameenillah22@gmail.com</p>
        <p class="motto">MOTTO: KNOWLEDGE AND WORSHIP <span lang="ar">:الشِّعار الْعِلْمُ وَالْعِبَادَة</span></p>
        <h2 class="school-line"> <span id="reportLevel">${esc(reportLevel)}</span></h2>
      </div>
      <img src="${esc(photoSrc)}" class="student-passport"
           onerror="this.onerror=null; this.src='images/default.png';" alt="Student Photo">
    </div>

    <!-- CHANGED (owner request): bilingual labels - Arabic on every field
         of the report, exactly like the live Check Result page. -->
    <h3>Student Information <span class="ar-lbl" lang="ar">معلومات الطالب</span></h3>
    <table class="student-info-table">
      <tr>
        <td><strong>Name:</strong> <span class="ar-lbl" lang="ar">الاسم</span></td><td>${esc(first.student_name)}</td>
        <td><strong>Class:</strong> <span class="ar-lbl" lang="ar">الصف</span></td><td>${esc(first.class_name)}</td>
      </tr>
      <tr>
        <td><strong>Student ID:</strong> <span class="ar-lbl" lang="ar">رقم الطالب</span></td><td>${esc(first.student_id)}</td>
        <td><strong>Term:</strong> <span class="ar-lbl" lang="ar">الفترة</span></td><td>${esc(term)}${amsTermAr(term) ? ' <span class="ar-lbl" lang="ar">(' + amsTermAr(term) + ')</span>' : ''}</td>
      </tr>
      <tr>
        <td><strong>Position:</strong> <span class="ar-lbl" lang="ar">الترتيب</span></td><td>${positionText}</td>
        <td><strong>Session:</strong> <span class="ar-lbl" lang="ar">العام الدراسي</span></td><td>${esc(session)}</td>
      </tr>
    </table>

    <table id="resultTable"${isThirdTerm ? ' class="cumulative-view"' : ''}>${tableRows}</table>

    <div class="bottom-section">
      <h3>Performance Summary <span class="ar-lbl" lang="ar">ملخص الأداء</span></h3>
      <table class="summary-table">
        <tr><td><strong>Total Subjects</strong> <span class="ar-lbl" lang="ar">عدد المواد الدراسية</span></td><td>${data.length}</td></tr>
        <tr><td><strong>Total Score</strong> <span class="ar-lbl" lang="ar">المجموع الكلي</span></td><td>${amsFmtScore(totalScore)}${isThirdTerm && data.length ? " / " + (data.length * 300) : ""}</td></tr>
        <tr><td><strong>Teacher's Remark</strong> <span class="ar-lbl" lang="ar">ملاحظة المعلم</span></td><td>${esc(teacherRemark)}</td></tr>
        <tr><td><strong>Principal's Remark</strong> <span class="ar-lbl" lang="ar">ملاحظة المدير</span></td><td>${esc(principalRemark)}</td></tr>
      </table>

      <div class="signature-section">
        <div class="signature-box">
          <img class="signature-img" alt="" ${classTeacherSig ? `src="${esc(classTeacherSig.signature_path)}"` : 'style="display:none;"'}>
          <p>______________________________</p>
          <p><strong>Class Teacher's Signature</strong> <span class="ar-lbl" lang="ar">توقيع معلم الصف</span></p>
        </div>
        <div class="signature-box">
          <img class="signature-img" alt="" ${principalSig ? `src="${esc(principalSig.signature_path)}"` : 'style="display:none;"'}>
          <p>______________________________</p>
          <p><strong>Principal's Signature</strong> <span class="ar-lbl" lang="ar">توقيع المدير</span></p>
        </div>
      </div>
    </div>`;

        return root;
    };

    /* FIX (pack 30): true when a captured canvas is essentially white
       (phones sometimes return blank captures under memory pressure -
       same guard the exam downloader uses). */
    window.amsCanvasLooksBlank = function (canvas) {
        try {
            const W = 40, H = 40;
            const probe = document.createElement("canvas");
            probe.width = W; probe.height = H;
            const cx = probe.getContext("2d");
            cx.drawImage(canvas, 0, 0, W, H);
            const d = cx.getImageData(0, 0, W, H).data;
            let ink = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) ink++;
            }
            return ink < W * H * 0.004; // <0.4% ink = blank
        } catch (e) { return false; }
    };

    /* Turn one (possibly very long) canvas into a jsPDF A4 portrait doc,
       slicing tall content across pages so NOTHING is scaled down or cut
       (print quality, request #7).
       CHANGED (pack 30): optional 3rd arg `cutGuide` = list of allowed
       vertical cut positions in canvas pixels (row bottoms). A page then
       NEVER splits a table row in half - the cut snaps to the nearest
       allowed edge above the ideal page end. Returns the jsPDF instance.
       CHANGED (one-page report): optional 4th arg `forceSinglePage` makes
       the WHOLE canvas scale down to fit ONE A4 page (never slices) - used
       for per-student report cards so a download/zip PDF is always a single,
       correctly-sized page instead of "longer than one page and very big".
       FIX: when the card fits on one page (≤ 1.1x A4 height), scale it
       down and center on a single page. Otherwise slice across multiple
       pages at full width.
       CHANGED (pack 90): optional 5th arg `options` supports a custom page
       margin. Official report captures pass margin:10 so their 190×277mm
       frame is identical to the browser's real 10mm-margin A4 print. */
    window.amsCanvasToA4Pdf = function (canvas, quality, cutGuide, forceSinglePage, options) {
        options = options || {};
        const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
        const pageWmm = 210;
        const pageHmm = 297;
        const requestedMargin = Number(options.margin);
        const margin = Number.isFinite(requestedMargin) && requestedMargin >= 0 && requestedMargin < 50
            ? requestedMargin
            : 4;
        const contentWmm = pageWmm - 2 * margin;
        const contentHmm = pageHmm - 2 * margin;

        const canvasW = canvas.width;
        const canvasH = canvas.height;
        // Natural size at full A4 width
        const naturalHmm = (canvasH * contentWmm) / canvasW;

        // ONE-page mode: always scale the whole card down to fit a single
        // A4 sheet (no matter how tall the source is). Used for individual
        // student report cards so they never spill onto a 2nd page.
        if (forceSinglePage || naturalHmm <= contentHmm * 1.5) {
            // Fits on one page — scale to fit exactly (never overflow)
            const scale = Math.min(1.0, contentHmm / naturalHmm);
            const wMm = contentWmm * scale;
            const hMm = naturalHmm * scale;
            const xMm = (pageWmm - wMm) / 2;
            const yMm = Math.max(margin, (pageHmm - hMm) / 2);
            pdf.addImage(
                canvas.toDataURL("image/jpeg", quality || 0.96), "JPEG",
                xMm, yMm, wMm, hMm
            );
            return pdf;
        }

        // Tall content: slice across multiple pages at full width
        const pixelsPerMm = canvasW / contentWmm;
        const pagePixels = Math.floor(contentHmm * pixelsPerMm);
        let yOffset = 0;
        let pageNum = 0;

        while (yOffset < canvasH) {
            let sliceEnd = Math.min(yOffset + pagePixels, canvasH);

            // Snap cut to nearest guide above the ideal end (if guides provided)
            if (cutGuide && cutGuide.length && sliceEnd < canvasH) {
                for (let g = cutGuide.length - 1; g >= 0; g--) {
                    if (cutGuide[g] <= sliceEnd && cutGuide[g] > yOffset) {
                        sliceEnd = cutGuide[g];
                        break;
                    }
                }
            }

            const sliceHeight = sliceEnd - yOffset;
            const sliceHmm = sliceHeight / pixelsPerMm;

            // Create a canvas slice
            const sliceCanvas = document.createElement("canvas");
            sliceCanvas.width = canvasW;
            sliceCanvas.height = sliceHeight;
            const ctx = sliceCanvas.getContext("2d");
            ctx.drawImage(canvas, 0, -yOffset);

            if (pageNum > 0) pdf.addPage();
            const xMm = margin;
            const yMm = margin;
            pdf.addImage(
                sliceCanvas.toDataURL("image/jpeg", quality || 0.96), "JPEG",
                xMm, yMm, contentWmm, sliceHmm
            );

            yOffset = sliceEnd;
            pageNum++;
        }

        return pdf;
    };

    /* Wait for every <img> inside a rendered node to finish loading
       (important before html2canvas, request #8 rendering correctness). */
    window.amsWaitForImages = function (root, timeoutMs) {
        const imgs = Array.from(root.querySelectorAll("img"));
        return Promise.all(imgs.map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, timeoutMs || 4000);
            });
        })).then(() => undefined);
    };

    /* ------------------------------------------------------------------
       ONE-PAGE report helpers (student portal download + zip + print).

       The live on-screen report is designed to look good on a phone, so
       html2canvas must render it in a fixed desktop-width staging area.
       Pack 90's .rcpzip skin now mirrors the REAL full A4 print sheet
       instead of making a shortened compact card. The optional fit-only
       class keeps the same print typography while removing the forced A4
       minimum height when JS only needs to measure natural overflow.
       ------------------------------------------------------------------ */

    function amsMakeStage(widthPx, extraClass) {
        const stage = document.createElement("div");
        stage.className = "rcpzip" + (extraClass ? " " + extraClass : "");
        stage.style.cssText =
            "position:fixed; left:-12000px; top:0; width:" + (widthPx || 794) +
            "px; background:#fff; z-index:-1;";
        return stage;
    }

    /* Capture a report-card element to a canvas at a fixed desktop width,
       using the official full-page skin, so ZIP/portal PDFs have the same
       arrangement and proportions as the real printed result.
       Resolves to an HTMLCanvasElement. */
    window.amsCaptureReportToCanvas = function (sourceEl, opts) {
        opts = opts || {};
        const stage = amsMakeStage(opts.width || 794);
        document.body.appendChild(stage);
        const clone = sourceEl.cloneNode(true);
        clone.id = ""; // avoid a duplicate #reportContainer id in the DOM
        stage.appendChild(clone);
        return window.amsWaitForImages(clone, opts.timeout || 4000)
            .then(function () {
                return window.html2canvas(clone, {
                    scale: opts.scale || 2,
                    backgroundColor: "#ffffff",
                    useCORS: true,
                    windowWidth: opts.windowWidth || 1024
                });
            })
            .then(function (canvas) {
                stage.remove();
                return canvas;
            })
            .catch(function (err) {
                stage.remove();
                throw err;
            });
    };

    /* Measure the report's natural print content and return the zoom factor
       that makes the REAL report print on exactly one A4 page (1 = no
       scaling needed). The fit-only stage uses print typography/layout but
       removes the forced A4 minimum height, so only genuine overflow causes
       down-scaling. */
    window.amsFitPrintZoom = function (sourceEl) {
        const stage = amsMakeStage(718, "ams-fit-only"); // 190mm printable width @ 96dpi
        document.body.appendChild(stage);
        const clone = sourceEl.cloneNode(true);
        clone.id = ""; // avoid a duplicate #reportContainer id in the DOM
        stage.appendChild(clone);
        return window.amsWaitForImages(clone, 4000)
            .then(function () {
                const h = clone.getBoundingClientRect().height;
                stage.remove();
                if (!h) return 1;
                // A4 printable height (297mm - 2x10mm margins) ≈ 277mm ≈ 1046px.
                // Leave a tiny safety margin so rounding never pushes a line
                // onto a second sheet.
                const target = 1030;
                if (h <= target) return 1;
                return Math.max(0.35, target / h);
            })
            .catch(function () {
                stage.remove();
                return 1;
            });
    };

    /* ------------------------------------------------------------------
       NEW (one-page fix): SYNCHRONOUS version of the fit measurement.
       The async version above waits for images, which is fine for the
       explicit "Print Result" button - but when the user prints with
       Ctrl+P / the browser menu / the phone print button, no button
       handler runs and the sheet printed at zoom 1 spilled onto a
       second A4 page. beforeprint fires just before the browser takes
       its print snapshot, at which point every image on the page is
       already loaded, so a fully synchronous measure is safe there. */
    window.amsFitPrintZoomSync = function (sourceEl) {
        try {
            const stage = amsMakeStage(718, "ams-fit-only");
            document.body.appendChild(stage);
            const clone = sourceEl.cloneNode(true);
            clone.id = ""; // avoid a duplicate #reportContainer id in the DOM
            stage.appendChild(clone);
            const h = clone.getBoundingClientRect().height;
            stage.remove();
            if (!h) return 1;
            const target = 1030; // A4 printable height, small safety margin
            if (h <= target) return 1;
            return Math.max(0.35, target / h);
        } catch (e) {
            return 1; // never let a measurement error block printing
        }
    };

    /* Find a VISIBLE report sheet on the page (staff Check Result or the
       portal). Offscreen PDF-capture stages are position:fixed, so their
       offsetParent is null and they are skipped - the class-ZIP / portal
       PDF flows are never disturbed. */
    function amsFindVisibleReport() {
        const el = document.getElementById("reportContainer");
        if (el && el.offsetParent !== null) return el;
        const all = document.querySelectorAll(".report-container");
        for (let i = 0; i < all.length; i++) {
            if (all[i].offsetParent !== null) return all[i];
        }
        return null;
    }

    /* NEW (one-page fix): scale-to-fit for EVERY print path - the
       "Print Result" button, Ctrl+P, the browser print menu and phone
       print all go through beforeprint, so the sheet is always zoomed
       to exactly ONE A4 page before the snapshot is taken. */
    window.addEventListener("beforeprint", function () {
        const report = amsFindVisibleReport();
        if (!report || !window.amsFitPrintZoomSync) return;
        const zoom = window.amsFitPrintZoomSync(report);
        document.documentElement.style.setProperty("--ams-print-zoom", String(zoom));
    });
    window.addEventListener("afterprint", function () {
        document.documentElement.style.removeProperty("--ams-print-zoom");
    });

})();
