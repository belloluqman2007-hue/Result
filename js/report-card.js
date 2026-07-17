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

    function esc(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /* Fetch everything one report needs (read-only public endpoints,
       the very same ones the Check Result page uses).
       Pass sharedSignatures (fetched once by the caller) to avoid
       re-downloading them for every student in a class zip. */
    window.amsFetchReportPack = function (studentId, term, session, sharedSignatures) {
        const enc = encodeURIComponent;
        const sigPromise = sharedSignatures
            ? Promise.resolve(sharedSignatures)
            : fetch("/signatures").then(r => r.json()).catch(() => []);
        return Promise.all([
            fetch(`/search-result/${enc(studentId)}?term=${enc(term)}&session=${enc(session)}`)
                .then(r => r.json()),
            fetch(`/student/${enc(studentId)}`).then(r => r.json()).catch(() => []),
            fetch(`/student-position/${enc(studentId)}`).then(r => r.json()).catch(() => ({})),
            sigPromise
        ]).then(([rows, studentArr, positionData, signatures]) => ({
            rows: Array.isArray(rows) ? rows : [],
            student: Array.isArray(studentArr) && studentArr.length ? studentArr[0] : null,
            position: positionData && positionData.position ? positionData.position : null,
            signatures: Array.isArray(signatures) ? signatures : []
        }));
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
        const classTeacherSig = pack.signatures.find(s => s.role === "class_teacher");
        const principalSig = pack.signatures.find(s => s.role === "principal");

        // Scores table - identical columns to js/result.js
        let tableRows = "";
        let totalScore = 0;
        let average = 0;

        if (isThirdTerm) {
            tableRows += `<tr><th>Subject</th><th>1st Term</th><th>2nd Term</th><th>3rd Term</th><th>Average</th><th>Grade</th></tr>`;
            let averagesSum = 0, averagesCount = 0;
            data.forEach(result => {
                const firstTotal = result.first_term_total !== null && result.first_term_total !== undefined ? result.first_term_total : "-";
                const secondTotal = result.second_term_total !== null && result.second_term_total !== undefined ? result.second_term_total : "-";
                const thirdTotal = result.third_term_total;
                const cumulativeAvg = result.cumulative_average;
                tableRows += `<tr><td>${esc(result.subject)}</td><td>${firstTotal}</td><td>${secondTotal}</td><td>${thirdTotal}</td><td>${cumulativeAvg !== null && cumulativeAvg !== undefined ? cumulativeAvg : "-"}</td><td>${esc(result.grade)}</td></tr>`;
                if (cumulativeAvg !== null && cumulativeAvg !== undefined) {
                    averagesSum += Number(cumulativeAvg);
                    averagesCount++;
                }
                totalScore += Number(thirdTotal);
            });
            average = averagesCount > 0 ? Number((averagesSum / averagesCount).toFixed(2)) : 0;
            tableRows += `<tr><td colspan="4"><strong>Cumulative Average</strong></td><td><strong>${average}</strong></td><td></td></tr>`;
        } else {
            tableRows += `<tr><th>Subject</th><th>CA</th><th>Exam</th><th>Total</th><th>Grade</th></tr>`;
            data.forEach(result => {
                tableRows += `<tr><td>${esc(result.subject)}</td><td>${result.ca_score}</td><td>${result.exam_score}</td><td>${result.total}</td><td>${esc(result.grade)}</td></tr>`;
                totalScore += Number(result.total);
            });
            average = data.length > 0 ? Number((totalScore / data.length).toFixed(2)) : 0;
            tableRows += `<tr><td colspan="3"><strong>Average</strong></td><td><strong>${average}</strong></td><td></td></tr>`;
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
           onerror="this.onerror=null; this.src='images/default.png';" loading="lazy" alt="Student Photo">
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

    <table id="resultTable">${tableRows}</table>

    <div class="bottom-section">
      <h3>Performance Summary</h3>
      <table class="summary-table">
        <tr><td><strong>Total Subjects</strong></td><td>${data.length}</td></tr>
        <tr><td><strong>Total Score</strong></td><td>${totalScore}</td></tr>
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

    /* Turn one (possibly very long) canvas into a jsPDF A4 portrait doc,
       slicing tall content across pages so NOTHING is scaled down or cut
       (print quality, request #7). Returns the jsPDF instance. */
    window.amsCanvasToA4Pdf = function (canvas, quality) {
        const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
        const pageHeightPx = Math.ceil((297 / 210) * canvas.width); // px per A4 page at canvas scale
        let done = 0;
        let pageIndex = 0;

        while (done < canvas.height) {
            const sliceHeight = Math.min(pageHeightPx, canvas.height - done);
            const slice = document.createElement("canvas");
            slice.width = canvas.width;
            slice.height = sliceHeight;
            slice.getContext("2d").drawImage(
                canvas, 0, done, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight
            );
            const hMm = (sliceHeight * 210) / canvas.width;
            if (pageIndex > 0) pdf.addPage();
            pdf.addImage(slice.toDataURL("image/jpeg", quality || 0.95), "JPEG", 0, 0, 210, hMm);
            done += sliceHeight;
            pageIndex++;
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
