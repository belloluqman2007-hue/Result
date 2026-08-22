/* FIX (pack 21 - owner: no more "45.00" / "89.00"): scores DISPLAY as
   clean whole numbers (49.7 -> 50, 67.3 -> 67). Database values and the
   average used for remarks/promotion logic are completely untouched -
   this rounds ONLY what is shown on screen and print. "-" and grades
   pass through unchanged. */
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

/* NEW (owner request): Arabic for the three term names, so the term
   columns and the Term field can be shown bilingually on the report. */
function amsTermAr(term) {
    var t = String(term || "");
    if (t.indexOf("1st") === 0) return "الفترة الأولى";
    if (t.indexOf("2nd") === 0) return "الفترة الثانية";
    if (t.indexOf("3rd") === 0) return "الفترة الثالثة";
    return "";
}

/* The 3rd-term report shows a Total alongside the three /100 term
   scores. Prefer the API's explicit cumulative_total and keep a safe
   client-side fallback for reports returned by an older server. */
function amsCumulativeTotal(result, firstTotal, secondTotal, thirdTotal) {
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

function searchResult() {

    let studentId = document.getElementById("searchId").value;
    let term = document.getElementById("searchTerm").value;
    let session = document.getElementById("searchSession").value;

    if (!studentId || !term || !session) {
        alert("Please enter a Student ID and select both Term and Session.");
        return;
    }

    const isThirdTerm = term === "3rd Term";

    fetch(`/search-result/${studentId}?term=${encodeURIComponent(term)}&session=${encodeURIComponent(session)}`)
        .then(response => response.json())
        .then(data => {

            let table = document.getElementById("resultTable");
            let found = data.length > 0;

            if (isThirdTerm) {
                table.className = "cumulative-view";
                /* Cumulative third-term result: score summary first,
                   the subject name last on the right. */
                /* CHANGED (owner request): term columns + Average / Grade /
                   Total / Subject are now bilingual - Arabic on the 2nd line. */
                table.innerHTML = `
                    <tr>
                        <th>Average<br><span lang="ar">النسبة المئوية</span></th>
                        <th>Grade<br><span lang="ar">الدرجة</span></th>
                        <th>Total<br><span lang="ar">الدرجة الكلية</span></th>
                        <th>3rd Term /100<br><span lang="ar">الفترة الثالثة</span></th>
                        <th>2nd Term /100<br><span lang="ar">الفترة الثانية</span></th>
                        <th>1st Term /100<br><span lang="ar">الفترة الأولى</span></th>
                        <th>Subject<br><span lang="ar">المواد الدراسية</span></th>
                    </tr>
                `;
            } else {
                table.className = "";
                /* CHANGED (owner request): same bilingual treatment for the
                   first/second term layout (Average/Grade/Total/Subject). */
                table.innerHTML = `
                    <tr>
                        <th>Average<br><span lang="ar">النسبة المئوية</span></th>
                        <th>Grade<br><span lang="ar">الدرجة</span></th>
                        <th>Total<br><span lang="ar">الدرجة الكلية</span></th>
                        <th>Exam<br><span lang="ar">الاختبار</span></th>
                        <th>CA<br><span lang="ar">التقييم المستمر</span></th>
                        <th>Subject<br><span lang="ar">المواد الدراسية</span></th>
                    </tr>
                `;
            }

            if (!found) {
                let row = table.insertRow();
                let cell = row.insertCell(0);
                cell.colSpan = isThirdTerm ? 7 : 6;
                cell.innerHTML = "No result found";

                document.getElementById("studentId").textContent = "-";
                document.getElementById("studentName").textContent = "-";
                document.getElementById("studentClass").textContent = "-";
                document.getElementById("studentTerm").textContent = "-";
                document.getElementById("studentSession").textContent = "-";
                document.getElementById("studentPosition").textContent = "-";
                document.getElementById("totalSubjects").textContent = "0";
                document.getElementById("grandTotal").textContent = "0";
                document.getElementById("teacherRemark").textContent = "-";
                document.getElementById("principalRemark").textContent = "-";
                document.getElementById("studentPhoto").src = "images/default.png";
                document.getElementById("classTeacherSignature").style.display = "none";
                document.getElementById("principalSignature").style.display = "none";
                return;
            }

            document.getElementById("studentId").textContent = data[0].student_id;
            document.getElementById("studentName").textContent = data[0].student_name;
            document.getElementById("studentClass").textContent = data[0].class_name;
            /* CHANGED (owner request): the term is shown with its Arabic
               name too - "3rd Term (الفترة الثالثة)". */
            var termAr = amsTermAr(data[0].term);
            document.getElementById("studentTerm").textContent = termAr ? data[0].term + " (" + termAr + ")" : data[0].term;
            document.getElementById("studentSession").textContent = data[0].session;

            const className = data[0].class_name;
            if (className.includes("الثّانويّ")) {
                document.getElementById("reportLevel").textContent = "STUDENT REPORT SHEET كشف درجات الطّالب (الثّانويّة)";
            } else if (className.includes("الإعداديّ")) {
                document.getElementById("reportLevel").textContent = "STUDENT REPORT SHEET كشف درجات الطّالب (الإعداديّة)";
            } else {
                document.getElementById("reportLevel").textContent = "STUDENT REPORT SHEET كشف درجات الطّالب (الابتدائيّة)";
            }

            fetch(`/student-position/${studentId}?className=${encodeURIComponent(data[0].class_name)}&term=${encodeURIComponent(data[0].term)}&session=${encodeURIComponent(data[0].session)}`)
                .then(response => response.json())
                .then(positionData => {
                    let position = positionData.position;

                    let suffix = "th";

                    if (position == 1) suffix = "st";
                    else if (position == 2) suffix = "nd";
                    else if (position == 3) suffix = "rd";

                    document.getElementById("studentPosition").textContent = position + suffix;
                });

            fetch(`/student/${studentId}`)
                .then(response => response.json())
                .then(studentData => {
                    const photo = document.getElementById("studentPhoto");
                    if (studentData.length > 0 && studentData[0].photo_path) {
                        photo.src = studentData[0].photo_path;
                    } else {
                        photo.src = "images/default.png";
                    }
                })
                .catch(error => {
                    console.log(error);
                    document.getElementById("studentPhoto").src = "images/default.png";
                });

            // CHANGED (per-class class teacher signature, owner request):
            // also read the class-assigned signatures and stamp the one tied
            // to THIS student's class; the shared Class Teacher signature
            // stays as the fallback for classes with nothing assigned.
            // Layout/image placement is untouched - only WHICH image shows.
            Promise.all([
                fetch("/signatures").then(r => r.json()),
                fetch("/class-signatures").then(r => r.json()).catch(() => [])
            ])
                .then(([signatures, classSigs]) => {
                    const classTeacherImg = document.getElementById("classTeacherSignature");
                    const principalImg = document.getElementById("principalSignature");

                    const studentClass = (data[0] && data[0].class_name) || "";
                    const perClassSig = Array.isArray(classSigs)
                        ? classSigs.find(c => c.class_name === studentClass)
                        : null;
                    const classTeacherSig = perClassSig || signatures.find(s => s.role === "class_teacher");
                    const principalSig = signatures.find(s => s.role === "principal");

                    if (classTeacherSig) {
                        classTeacherImg.src = classTeacherSig.signature_path;
                        classTeacherImg.style.display = "inline-block";
                    } else {
                        classTeacherImg.style.display = "none";
                    }

                    if (principalSig) {
                        principalImg.src = principalSig.signature_path;
                        principalImg.style.display = "inline-block";
                    } else {
                        principalImg.style.display = "none";
                    }
                })
                .catch(error => console.log(error));

            let average = 0;
            let totalScore = 0;

            if (isThirdTerm) {
                // Cumulative view: show 1st/2nd/3rd term totals per subject
                // plus a per-subject average. Grand Total = T1+T2+T3 across
                // every subject (13 subjects → 3900). Overall average =
                // Grand Total ÷ (subjects × 3) (3900 ÷ 39 = 100). That
                // average is what decides class position.
                //
                // Column order follows the requested cumulative layout:
                // Average, Grade, Total, 3rd /100, 2nd /100, 1st /100, Subject.
                data.forEach(result => {
                    const firstTotal = result.first_term_total !== null && result.first_term_total !== undefined ? result.first_term_total : "-";
                    const secondTotal = result.second_term_total !== null && result.second_term_total !== undefined ? result.second_term_total : "-";
                    const thirdTotal = result.third_term_total !== null && result.third_term_total !== undefined
                        ? result.third_term_total
                        : result.total;
                    const cumulativeAvg = result.cumulative_average;
                    const cumulativeTotal = amsCumulativeTotal(result, firstTotal, secondTotal, thirdTotal);
                    const grade = result.cumulative_grade || result.grade || "";

                    table.innerHTML += `
                        <tr>
                            <td>${cumulativeAvg !== null && cumulativeAvg !== undefined ? amsFmtScore(cumulativeAvg) : "-"}</td>
                            <td>${esc(grade)}</td>
                            <td>${amsFmtScore(cumulativeTotal)}</td>
                            <td>${amsFmtScore(thirdTotal)}</td>
                            <td>${amsFmtScore(secondTotal)}</td>
                            <td>${amsFmtScore(firstTotal)}</td>
                            <td>${esc(result.subject)}</td>
                        </tr>
                    `;

                    totalScore += (Number(firstTotal) || 0) + (Number(secondTotal) || 0) + (Number(thirdTotal) || 0);
                });

                average = data.length > 0 ? Number((totalScore / (data.length * 3)).toFixed(2)) : 0;

            } else {
                data.forEach(result => {
                    table.innerHTML += `
                        <tr>
                            <td>-</td>
                            <td>${esc(result.grade)}</td>
                            <td>${amsFmtScore(result.total)}</td>
                            <td>${amsFmtScore(result.exam_score)}</td>
                            <td>${amsFmtScore(result.ca_score)}</td>
                            <td>${esc(result.subject)}</td>
                        </tr>
                    `;
                    totalScore += Number(result.total);
                });

                average = data.length > 0 ? Number((totalScore / data.length).toFixed(2)) : 0;
            }

            document.getElementById("totalSubjects").textContent = data.length;
            document.getElementById("grandTotal").textContent = isThirdTerm && data.length
                ? amsFmtScore(totalScore) + " / " + (data.length * 300)
                : amsFmtScore(totalScore); // 3rd Term: 13 subjects → 3900 / 3900

            let teacherRemark = "";

            if (average >= 70) {
                teacherRemark = "Excellent Performance. Keep it up!";
            }
            else if (average >= 60) {
                teacherRemark = "Very Good Performance.";
            }
            else if (average >= 50) {
                teacherRemark = "Good Performance. Work harder.";
            }
            else if (average >= 40) {
                teacherRemark = "Fair Performance. More effort is needed.";
            }
            else {
                teacherRemark = "Poor Performance. Serious improvement is required.";
            }

            document.getElementById("teacherRemark").textContent = teacherRemark;

            let principalRemark = "";

            if (average >= 50) {
                principalRemark = "Promoted";
            }
            else {
                principalRemark = "Repeat Class";
            }

            document.getElementById("principalRemark").textContent = principalRemark;

            /* Put the overall average in the first (Average) column;
               the label spans the score columns while Grade and Subject
               stay blank, preserving the requested column arrangement. */
            if (isThirdTerm) {
                table.innerHTML += `
                    <tr>
                        <td><strong>${amsFmtScore(average)}</strong></td>
                        <td></td>
                        <td colspan="4"><strong>Cumulative Average<br><span lang="ar">المعدل التراكمي</span></strong></td>
                        <td></td>
                    </tr>
                `;
            } else {
                table.innerHTML += `
                    <tr>
                        <td><strong>${amsFmtScore(average)}</strong></td>
                        <td></td>
                        <td colspan="3"><strong>Average<br><span lang="ar">المعدل</span></strong></td>
                        <td></td>
                    </tr>
                `;
            }
        })
        .catch(error => {
            console.log(error);
            alert("Error fetching result.");
        });
}

/* NEW (one-page print): measures the compact report and scales the print
   sheet down just enough so the result ALWAYS fits ONE A4 page. When the
   shared helper isn't loaded (older cache) it falls back to a normal
   window.print() so nothing breaks. */
function amsPrintWithFit() {
  var report = document.getElementById("reportContainer");
  if (!report || !window.amsFitPrintZoom) {
    window.print();
    return;
  }
  window.amsFitPrintZoom(report).then(function (zoom) {
    document.documentElement.style.setProperty("--ams-print-zoom", String(zoom));
    window.print();
    setTimeout(function () {
      document.documentElement.style.removeProperty("--ams-print-zoom");
    }, 1500);
  }).catch(function () {
    window.print();
  });
}

function printResult() {
  const studentIdCell = document.getElementById("studentId");

  if (!studentIdCell || studentIdCell.textContent.trim() === "" || studentIdCell.textContent.trim() === "-") {
    alert("Please search for a student first before printing.");
    return;
  }

  amsPrintWithFit();
}

function downloadPDF() {
  const studentIdCell = document.getElementById("studentId");

  if (!studentIdCell || studentIdCell.textContent.trim() === "" || studentIdCell.textContent.trim() === "-") {
    alert("Please search for a student first before downloading.");
    return;
  }

  alert('In the dialog that opens, set "Destination" to "Save as PDF" and make sure "Background graphics" is turned on, so the colors and Arabic text come out correctly.');

  amsPrintWithFit();
}
/* ====================================================================
   NEW (staff export by class): shows a small "Export results to Excel"
   panel on the Check Result page, but ONLY when a staff member is
   logged in. The public never sees it. Downloads come from the
   read-only /export-all-results route. Nothing about result display,
   calculation or printing is touched.
   ==================================================================== */
(function () {
    "use strict";

    fetch("/me")
        .then(function (r) { return r.json(); })
        .then(function (session) {
            if (!session || !session.loggedIn) return; // public visitor - stay hidden

            var panel = document.getElementById("staffExport");
            if (!panel) return;
            panel.style.display = "block";

            // Fill the class dropdown from the school's real class list.
            fetch("/classes")
                .then(function (r) { return r.ok ? r.json() : []; })
                .then(function (classes) {
                    var sel = document.getElementById("exportClass");
                    (classes || []).forEach(function (c) {
                        var name = c.class_name || c;
                        var opt = document.createElement("option");
                        opt.value = name;
                        opt.textContent = name;
                        sel.appendChild(opt);
                    });
                })
                .catch(function () { /* dropdown keeps just "All classes" */ });

            document.getElementById("exportBtn").addEventListener("click", function () {
                var cls = document.getElementById("exportClass").value;
                var url = "/export-all-results" + (cls ? "?class=" + encodeURIComponent(cls) : "");
                window.location.assign(url); // browser downloads the .xlsx
            });
        })
        .catch(function () { /* not logged in - panel stays hidden */ });
})();
