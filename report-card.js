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
            tableRows += `<tr><th>Average</th><th>Grade</th><th>1st Term</th><th>2nd Term</th><th>3rd Term</th><th>Subject</th></tr>`;
            let averagesSum = 0, averagesCount = 0;
            data.forEach(result => {
                const firstTotal = result.first_term_total !== null && result.first_term_total !== undefined ? result.first_term_total : "-";
                const secondTotal = result.second_term_total !== null && result.second_term_total !== undefined ? result.second_term_total : "-";
                const thirdTotal = result.third_term_total;
                const cumulativeAvg = result.cumulative_average;
                const grade = result.cumulative_grade || result.grade || "";
                tableRows += `<tr><td>${cumulativeAvg !== null && cumulativeAvg !== undefined ? amsFmtScore(cumulativeAvg) : "-"}</td><td>${esc(grade)}</td><td>${amsFmtScore(firstTotal)}</td><td>${amsFmtScore(secondTotal)}</td><td>${amsFmtScore(thirdTotal)}</td><td>${esc(result.subject)}</td></tr>`;
                if (cumulativeAvg !== null && cumulativeAvg !== undefined) {
                    averagesSum += Number(cumulativeAvg);
                    averagesCount++;
                }
                // Total Score = ALL three term scores combined
                totalScore += (Number(firstTotal) || 0) + (Number(secondTotal) || 0) + (Number(thirdTotal) || 0);
            });
            average = averagesCount > 0 ? Number((averagesSum / averagesCount).toFixed(2)) : 0;
            tableRows += `<tr><td><strong>${amsFmtScore(average)}</strong></td><td></td><td colspan="3"><strong>Cumulative Average</strong></td><td></td></tr>`;
        } else {
            tableRows += `<tr><th>Average</th><th>Grade</th><th>CA</th><th>Exam</th><th>Total</th><th>Subject</th></tr>`;
            data.forEach(result => {
                tableRows += `<tr><td>-</td><td>${esc(result.grade)}</td><td>${amsFmtScore(result.ca_score)}</td><td>${amsFmtScore(result.exam_score)}</td><td>${amsFmtScore(result.total)}</td><td>${esc(result.subject)}</td></tr>`;
                totalScore += Number(result.total);
            });
            average = data.length > 0 ? Number((totalScore / data.length).toFixed(2)) : 0;
            // FIX (exact-original parity): the original average row has
            // NO trailing empty cell on 1st/2nd term reports.
            tableRows += `<tr><td><strong>${amsFmtScore(average)}</strong></td><td></td><td colspan="3"><strong>Average</strong></td><td></td></tr>`;
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
        <p class="motto">MOTTO: KNOWLEDGE AND WORSHIP <span lang="ar">شعارنا: العلم والعبادة</span></p>
        <h2 class="school-line"> <span id="reportLevel">${esc(reportLevel)}</span></h2>
      </div>
      <img src="${esc(photoSrc)}" class="student-passport"
           onerror="this.onerror=null; this.src='images/default.png';" alt="Student Photo">
    </div>

    <h3>Student Information</h3>
    <table class="student-info-table">
      <tr>
        <td><strong>Name:</strong></td><td>${esc(first.student_name)}</td>
        <td><strong>Class:</strong></td><td>${esc(first.class_name)}</td>
      </tr>
      <tr>
        <td><strong>Student ID:</strong></td><td>${esc(first.student_id)}</td>
        <td><strong>Term:</strong></td><td>${esc(term)}</td>
      </tr>
      <tr>
        <td><strong>Position:</strong></td><td>${positionText}</td>
        <td><strong>Session:</strong></td><td>${esc(session)}</td>
      </tr>
    </table>

    <table id="resultTable"${isThirdTerm ? ' class="cumulative-view"' : ''}>${tableRows}</table>

    <div class="bottom-section">
      <h3>Performance Summary</h3>
      <table class="summary-table">
        <tr><td><strong>Total Subjects</strong></td><td>${data.length}</td></tr>
        <tr><td><strong>Total Score</strong></td><td>${amsFmtScore(totalScore)}</td></tr>
        <tr><td><strong>Teacher's Remark</strong></td><td>${esc(teacherRemark)}</td></tr>
        <tr><td><strong>Principal's Remark</strong></td><td>${esc(principalRemark)}</td></tr>
      </table>

      <div class="signature-section">
        <div class="signature-box">
          <img class="signature-img" alt="" ${classTeacherSig ? `src="${esc(classTeacherSig.signature_path)}"` : 'style="display:none;"'}>
          <p>______________________________</p>
          <p><strong>Class Teacher's Signature</strong></p>
        </div>
        <div class="signature-box">
          <img class="signature-img" alt="" ${principalSig ? `src="${esc(principalSig.signature_path)}"` : 'style="display:none;"'}>
          <p>______________________________</p>
          <p><strong>Principal's Signature</strong></p>
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
       FIX: when the card fits on one page (≤ 1.1x A4 height), scale it
       down and center on a single page. Otherwise slice across multiple
       pages at full width. */
    window.amsCanvasToA4Pdf = function (canvas, quality, cutGuide) {
        const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
        const pageWmm = 210;
        const pageHmm = 297;
        const margin = 4;
        const contentWmm = pageWmm - 2 * margin;
        const contentHmm = pageHmm - 2 * margin;

        const canvasW = canvas.width;
        const canvasH = canvas.height;
        // Natural size at full A4 width
        const naturalHmm = (canvasH * contentWmm) / canvasW;

        if (naturalHmm <= contentHmm * 1.5) {
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

})();
