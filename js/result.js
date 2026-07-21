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
                table.innerHTML = `
                    <tr>
                        <th>Subject</th>
                        <th>1st Term</th>
                        <th>2nd Term</th>
                        <th>3rd Term</th>
                        <th>Average</th>
                        <th>Grade</th>
                    </tr>
                `;
            } else {
                table.innerHTML = `
                    <tr>
                        <th>Subject</th>
                        <th>CA</th>
                        <th>Exam</th>
                        <th>Total</th>
                        <th>Grade</th>
                    </tr>
                `;
            }

            if (!found) {
                let row = table.insertRow();
                let cell = row.insertCell(0);
                cell.colSpan = isThirdTerm ? 6 : 5;
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
            document.getElementById("studentTerm").textContent = data[0].term;
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
                // Cumulative view: show 1st/2nd/3rd term totals per subject,
                // plus a cumulative average, and base the overall average on
                // those cumulative subject averages rather than just term 3.
                let averagesSum = 0;
                let averagesCount = 0;

                data.forEach(result => {
                    const firstTotal = result.first_term_total !== null && result.first_term_total !== undefined ? result.first_term_total : "-";
                    const secondTotal = result.second_term_total !== null && result.second_term_total !== undefined ? result.second_term_total : "-";
                    const thirdTotal = result.third_term_total;
                    const cumulativeAvg = result.cumulative_average;

                    table.innerHTML += `
                        <tr>
                            <td>${result.subject}</td>
                            <td>${amsFmtScore(firstTotal)}</td>
                            <td>${amsFmtScore(secondTotal)}</td>
                            <td>${amsFmtScore(thirdTotal)}</td>
                            <td>${cumulativeAvg !== null && cumulativeAvg !== undefined ? amsFmtScore(cumulativeAvg) : "-"}</td>
                            <td>${result.grade}</td>
                        </tr>
                    `;

                    if (cumulativeAvg !== null && cumulativeAvg !== undefined) {
                        averagesSum += Number(cumulativeAvg);
                        averagesCount++;
                    }

                    totalScore += Number(thirdTotal);
                });

                average = averagesCount > 0 ? Number((averagesSum / averagesCount).toFixed(2)) : 0;

            } else {
                data.forEach(result => {
                    table.innerHTML += `
                        <tr>
                            <td>${result.subject}</td>
                            <td>${amsFmtScore(result.ca_score)}</td>
                            <td>${amsFmtScore(result.exam_score)}</td>
                            <td>${amsFmtScore(result.total)}</td>
                            <td>${result.grade}</td>
                        </tr>
                    `;
                    totalScore += Number(result.total);
                });

                average = data.length > 0 ? Number((totalScore / data.length).toFixed(2)) : 0;
            }

            document.getElementById("totalSubjects").textContent = data.length;
            document.getElementById("grandTotal").textContent = amsFmtScore(totalScore); // pack 21: clean whole number

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

            table.innerHTML += `
                <tr>
                    <td colspan="${isThirdTerm ? 4 : 3}"><strong>${isThirdTerm ? "Cumulative Average" : "Average"}</strong></td>
                    <td><strong>${amsFmtScore(average)}</strong></td>
                    ${isThirdTerm ? "<td></td>" : ""}
                </tr>
            `;
        })
        .catch(error => {
            console.log(error);
            alert("Error fetching result.");
        });
}

function printResult() {
  const studentIdCell = document.getElementById("studentId");

  if (!studentIdCell || studentIdCell.textContent.trim() === "" || studentIdCell.textContent.trim() === "-") {
    alert("Please search for a student first before printing.");
    return;
  }

  window.print();
}

function downloadPDF() {
  const studentIdCell = document.getElementById("studentId");

  if (!studentIdCell || studentIdCell.textContent.trim() === "" || studentIdCell.textContent.trim() === "-") {
    alert("Please search for a student first before downloading.");
    return;
  }

  alert('In the dialog that opens, set "Destination" to "Save as PDF" and make sure "Background graphics" is turned on, so the colors and Arabic text come out correctly.');

  window.print();
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
