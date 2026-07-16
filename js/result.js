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

            fetch("/signatures")
                .then(response => response.json())
                .then(signatures => {
                    const classTeacherImg = document.getElementById("classTeacherSignature");
                    const principalImg = document.getElementById("principalSignature");

                    const classTeacherSig = signatures.find(s => s.role === "class_teacher");
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
                            <td>${firstTotal}</td>
                            <td>${secondTotal}</td>
                            <td>${thirdTotal}</td>
                            <td>${cumulativeAvg !== null && cumulativeAvg !== undefined ? cumulativeAvg : "-"}</td>
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
                            <td>${result.ca_score}</td>
                            <td>${result.exam_score}</td>
                            <td>${result.total}</td>
                            <td>${result.grade}</td>
                        </tr>
                    `;
                    totalScore += Number(result.total);
                });

                average = data.length > 0 ? Number((totalScore / data.length).toFixed(2)) : 0;
            }

            document.getElementById("totalSubjects").textContent = data.length;
            document.getElementById("grandTotal").textContent = totalScore;

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
                    <td><strong>${average}</strong></td>
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