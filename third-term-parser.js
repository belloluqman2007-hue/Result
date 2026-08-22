/* ==========================================================================
   third-term-parser.js  (NEW FILE - ADDITIVE)
   --------------------------------------------------------------------------
   Server-side parsing + Excel building for the "Third Term Results" feature.

   The school's internal grade-tracking workbook has ONE SHEET PER CLASS.
   Each sheet looks like this:

     Row 1-3 (header area): teacher name (أُسْتَاذُ الْفَصْلِ) and class name
                            (الصَّفُّ), school/session lines, etc.
     Subject header band : subjects numbered 1, 2, 3 ... ; every subject
                           spans the same block of columns:
                             F | S | N | A   (CA sub-scores, each /10)
                             40               (CA total column)
                             60               (exam column)
                             ف1 | ف2 | ف3    (term-1/2/3 historical scores)
     Student rows        : S/N | Adm/Num | Student Name | scores...

   This module ONLY parses / builds files. It never touches the database.
   XLSX (SheetJS) is lazy-loaded so server.js keeps its low-RAM boot
   (same trick server.js itself uses for the xlsx dependency).
   ========================================================================== */
"use strict";

let _XLSX = null;
function X() {
    if (!_XLSX) _XLSX = require("xlsx");
    return _XLSX;
}

/* FIX: school grade workbooks often carry a huge Excel used-range
   (!ref spanning tens of thousands of empty formatted cells). Feeding
   that whole range to sheet_to_json() with defval:"" allocated hundreds
   of MB, OOMed the process and dropped the socket — the page then
   showed "Network error while parsing the workbook." Cap the scan to
   a generous class-sheet size and skip styles/HTML so parse stays lean. */
const MAX_PARSE_ROWS = 400;
const MAX_PARSE_COLS = 280;

const LEAN_READ = {
    cellStyles: false,
    cellHTML: false,
    cellNF: false,
    sheetStubs: false
};

function readWorkbook(buffer) {
    const XLSX = X();
    try {
        return XLSX.read(buffer, Object.assign({ type: "buffer" }, LEAN_READ));
    } catch (e1) {
        try {
            return XLSX.read(buffer, Object.assign({ type: "array" }, LEAN_READ));
        } catch (e2) {
            const bin = Buffer.isBuffer(buffer)
                ? buffer.toString("binary")
                : String(buffer || "");
            return XLSX.read(bin, Object.assign({ type: "binary" }, LEAN_READ));
        }
    }
}

function decodeSafeRange(sheet) {
    const XLSX = X();
    let range = null;
    if (sheet && sheet["!ref"]) {
        try { range = XLSX.utils.decode_range(sheet["!ref"]); } catch (e) { range = null; }
    }
    if (!range) {
        let maxR = 0, maxC = 0, found = false;
        Object.keys(sheet || {}).forEach((k) => {
            if (!k || k.charAt(0) === "!") return;
            let addr;
            try { addr = XLSX.utils.decode_cell(k); } catch (e) { return; }
            if (addr.r > maxR) maxR = addr.r;
            if (addr.c > maxC) maxC = addr.c;
            found = true;
        });
        if (!found) return null;
        range = { s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } };
    }
    if (range.e.r - range.s.r > MAX_PARSE_ROWS) range.e.r = range.s.r + MAX_PARSE_ROWS;
    if (range.e.c - range.s.c > MAX_PARSE_COLS) range.e.c = range.s.c + MAX_PARSE_COLS;
    return range;
}

function sheetToGrid(sheet) {
    const range = decodeSafeRange(sheet);
    if (!range) return [];
    return X().utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: true,
        blankrows: false,
        range: range
    });
}

/* ------------------------------------------------------------------
   Tiny text helpers
   ------------------------------------------------------------------ */
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function cellText(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
}

/* Normalised Arabic: strip tashkeel/tatweel, fold alef/teh/yeh variants,
   collapse whitespace. Used ONLY for matching labels - display text keeps
   its original spelling (with tashkeel). */
function normAr(s) {
    return String(s || "")
        .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
        .replace(/[أإآٱ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/[ىي]/g, "ي")
        .replace(/\s+/g, " ")
        .trim();
}

/* Key form for set lookups: normalised, lowercased, no spaces. */
function normKey(v) {
    return normAr(v).toLowerCase().replace(/\s+/g, "");
}

/* Cell -> number (accepts Arabic-Indic & Persian digits, decimals, and
   numeric strings). Returns null when the cell is blank / not a number. */
function toNum(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/[,%]/g, "");
    if (!s) return null;
    s = s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
    s = s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------
   Bilingual name splitting
   ------------------------------------------------------------------
   The workbook's "Student Name" cell usually carries BOTH spellings in
   one cell (e.g. "احمد علي Ahmed Ali" or "Ahmed Ali / احمد علي").
   The result sheet must split them: the English name at the top line
   and the Arabic name at the bottom line - never the same combined
   name twice. This function separates the Latin and Arabic parts.
   ------------------------------------------------------------------ */
const ARABIC_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_CHAR_RE = /[A-Za-z0-9'’.]/;

function splitBilingualName(raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) return { nameEn: "", nameAr: "" };

    // Pure Latin (no Arabic characters): one spelling only.
    if (!ARABIC_CHAR_RE.test(s)) return { nameEn: s, nameAr: "" };
    // Pure Arabic (no Latin letters): one spelling only.
    if (!/[A-Za-z]/.test(s)) return { nameEn: "", nameAr: s };

    /* Mixed: walk the string, grouping consecutive characters of the
       same script. Spaces attach to the current group; anything else
       (slashes, dashes, brackets) just ends the group. */
    let en = "", ar = "", buf = "", bufType = "";
    const flush = () => {
        const piece = buf.replace(/\s+/g, " ").trim();
        const type = bufType;
        buf = "";
        bufType = "";
        if (!piece) return;
        if (type === "ar") ar += (ar ? " " : "") + piece;
        else en += (en ? " " : "") + piece;
    };
    for (const ch of s) {
        if (ARABIC_CHAR_RE.test(ch)) {
            if (bufType === "en") flush();
            bufType = "ar";
            buf += ch;
        } else if (LATIN_CHAR_RE.test(ch)) {
            if (bufType === "ar") flush();
            bufType = "en";
            buf += ch;
        } else if (/\s/.test(ch)) {
            buf += " "; // space keeps the current group together
        } else {
            flush();    // punctuation / separators end the group
        }
    }
    flush();

    return { nameEn: en, nameAr: ar };
}

/* ------------------------------------------------------------------
   Subject-block header markers (F / S / N / A / 40 / 60 / ف1 / ف2 / ف3)
   ------------------------------------------------------------------ */
function markerType(v) {
    const s = normAr(v).toLowerCase();
    if (!s) return null;
    if (s === "f" || s === "ف") return "F";
    if (s === "s" || s === "س") return "S";
    if (s === "n" || s === "ن") return "N";
    if (s === "a" || s === "أ" || s === "ا") return "A";
    if (s === "40" || s === "٤٠" || s === "المجموع" || s === "مجموع") return "CA";
    if (s === "60" || s === "٦٠" || s === "الامتحان" || s === "امتحان") return "EXAM";
    const t = s.replace(/[\s:_\-–—]/g, "");
    if (t === "ف1" || t === "ف١" || t === "1ف" || t === "١ف" || t === "term1" || t === "t1") return "T1";
    if (t === "ف2" || t === "ف٢" || t === "2ف" || t === "٢ف" || t === "term2" || t === "t2") return "T2";
    if (t === "ف3" || t === "ف٣" || t === "3ف" || t === "٣ف" || t === "term3" || t === "t3") return "T3";
    return null;
}

/* Header cells that are NOT subject names (student columns, class/teacher
   labels, page titles). A subject-name scan skips these. */
function isStudentOrLabelHeader(v) {
    const k = normKey(v);
    if (!k) return false;
    if (k === "sn" || k === "s/n" || k === "sno" || k === "no" || k === "no." || k === "#" ||
        k === "الرقم" || k === "الترتيب" || k === "المسلسل" || k === "م" || k === "ت") return true;
    if (k === "adm" || k === "admno" || k === "adm/no" || k === "admission" ||
        k === "admissionno" || k === "admissionnumber" || k === "رقمالقيد" ||
        k === "رقمالقبول" || k === "رقمالطالب" || k === "رقمالادميشن" ||
        k === "القيد" || k === "القبول") return true;
    if (k === "name" || k === "names" || k === "studentname" || k === "fullname" ||
        k === "الاسم" || k === "اسمالطالب" || k === "اسمالتلميذ" ||
        k === "الاسمالكامل" || k === "الطلاب" || k === "التلميذ" || k === "الطالب") return true;
    if (k === "الصف" || k === "الفصل" || k === "الاستاذ" || k === "المعلم" ||
        k === "المعلمة" || k === "الاستاذه" || k === "الفصلالاول" ||
        k === "الفصلالثاني" || k === "الفصلالثالث" || k === "الفترهالدرسيه" ||
        k === "الفترةالدراسية" || k === "الفترهالاولي" || k === "الفترةالاولى" ||
        k === "الفترهالثانيه" || k === "الفترةالثانية" ||
        k === "الفترهالثالثه" || k === "الفترةالثالثة" ||
        k === "الترمالاول" ||
        k === "الترمالثاني" || k === "الترمالثالث" || k === "العامالدراسي" ||
        k === "الدراسة" || k === "البيان" || k === "كشفالدرجات" || k === "بيانالدرجات" ||
        k === "نتائجالامتحانات" || k === "الدرجات" || k === "العلامات" || k === "سجل") return true;
    if (k.startsWith("adm") || k.startsWith("sn") || k.startsWith("رقم") ||
        k.startsWith("name") || k.includes("student") || k.includes("اسم")) return true;
    return false;
}

/* ------------------------------------------------------------------
   Sheet parsing
   ------------------------------------------------------------------ */

/* The sub-header row is the row that carries F S N A (+ a 40 or 60
   column). Scan a generous number of top rows (some workbooks stack a
   school banner + session lines first). */
const MAX_HEADER_SCAN_ROWS = 15;

function findHeaderRow(grid) {
    const maxRow = Math.min(grid.length, MAX_HEADER_SCAN_ROWS);
    for (let r = 0; r < maxRow; r++) {
        const types = (grid[r] || []).map((c) => markerType(c));
        const has = (t) => types.indexOf(t) !== -1;
        if (has("F") && has("S") && has("N") && has("A") && (has("CA") || has("EXAM"))) return r;
    }
    return -1;
}

/* Split the header row into subject blocks. Every "F" column starts a
   block; the block ends at the next "F" column (or the row end). */
function extractBlocks(headerRowCells) {
    const types = headerRowCells.map((c) => markerType(c));
    const blocks = [];
    let i = 0;
    while (i < types.length) {
        if (types[i] === "F") {
            const start = i;
            let end = types.length;
            for (let j = i + 1; j < types.length; j++) {
                if (types[j] === "F") { end = j; break; }
            }
            const cols = {};
            for (let j = start; j < end; j++) {
                if (types[j] && !(types[j] in cols)) cols[types[j]] = j;
            }
            blocks.push({ start, end, cols });
            i = end;
        } else {
            i++;
        }
    }
    return blocks;
}

/* Subject number: a small integer (1-30) sitting inside the block's
   column range in the header row (or the row above). 40/60 are excluded
   because they are the CA/exam column headers, not subject numbers. */
function findSubjectNumber(grid, headerRow, block) {
    const rowsToScan = [headerRow, headerRow - 1];
    for (let ri = 0; ri < rowsToScan.length; ri++) {
        const r = rowsToScan[ri];
        if (r < 0 || r >= grid.length) continue;
        const row = grid[r] || [];
        const from = ri === 0 ? Math.max(0, block.start - 2) : block.start;
        const to = Math.min(block.end, row.length);
        for (let c = from; c < to; c++) {
            if (markerType(row[c])) continue;
            const n = toNum(row[c]);
            if (n !== null && Number.isInteger(n) && n >= 1 && n <= 30) return n;
        }
    }
    return null;
}

/* Subject name: the first plausible text found in the block's column
   range, looking at the header row itself (name may sit left of the F
   column) and up to three rows above it (name row / numbering row). */
function findSubjectName(grid, headerRow, block) {
    const scanRows = [];
    for (let r = headerRow; r >= Math.max(0, headerRow - 3); r--) scanRows.push(r);
    for (let ri = 0; ri < scanRows.length; ri++) {
        const r = scanRows[ri];
        const row = grid[r] || [];
        const from = ri === 0 ? Math.max(0, block.start - 2) : block.start;
        const to = Math.min(block.end, row.length);
        for (let c = from; c < to; c++) {
            const raw = cellText(row[c]);
            if (!raw) continue;
            if (markerType(raw)) continue;
            if (toNum(raw) !== null) continue; // pure number (subject no.)
            if (isStudentOrLabelHeader(raw)) continue;
            return cleanSubjectName(raw);
        }
    }
    return "";
}

/* Strip a leading subject number from a name cell ("١: الْقُرْآنُ" or
   "2- Mathematics" -> "الْقُرْآنُ" / "Mathematics"). */
function cleanSubjectName(raw) {
    const s = String(raw || "").trim();
    const m = s.match(/^(\d+|[٠-٩]+)\s*[:：.\-–—]+\s*(.*)$/);
    if (m && m[2]) return m[2].trim();
    return s;
}

/* Find "label: value" or "label | value" pairs in the top rows, e.g.
   أُسْتَاذُ الْفَصْلِ: عَبْدُ اللهِ  or  الصَّفُّ: الأوّل التّحضيريّ. */
function findLabeledValue(grid, keys, excludeKeys) {
    const maxRow = Math.min(grid.length, 8);
    for (let r = 0; r < maxRow; r++) {
        const row = grid[r] || [];
        for (let c = 0; c < row.length; c++) {
            const raw = cellText(row[c]);
            const norm = normAr(raw).toLowerCase();
            if (!norm) continue;
            if (!keys.some((k) => norm.includes(k))) continue;
            if (excludeKeys && excludeKeys.some((k) => norm.includes(k))) continue;
            // "label: value" in the same cell (ASCII / Arabic / fullwidth colon)
            const m = raw.match(/[:：]([\s\S]*)$/);
            if (m) {
                const val = m[1].trim();
                if (val) return val;
            }
            // value in the next non-empty cell of the same row
            for (let j = c + 1; j < row.length; j++) {
                const nxt = cellText(row[j]);
                if (!nxt) continue;
                if (markerType(nxt)) continue;
                const nk = normKey(nxt);
                if (nk === ":" || nk === "：" || isStudentOrLabelHeader(nxt)) continue;
                return nxt;
            }
            return "";
        }
    }
    return "";
}

/* Footer / summary rows (averages, totals, notes) that must not be read
   as students. */
const FOOTER_KEYS = [
    "المجموع", "المعدل", "المتوسط", "average", "total", "ملاحظ",
    "note", "الترتيب", "المرتبة", "النسبه", "النسبة", "الدرجةالنهائية",
    "النهائية", "توقيع", "signature"
];

function isFooterRow(admKey, nameKey, rowKey) {
    if (!rowKey) return false;
    return FOOTER_KEYS.some((k) => rowKey.includes(k) ||
        admKey.includes(k) || nameKey.includes(k));
}

/* ------------------------------------------------------------------
   Main entry: parse one workbook buffer -> { classes, errors }
   ------------------------------------------------------------------ */
function parseWorkbook(buffer) {
    const workbook = readWorkbook(buffer);
    const classes = [];
    const errors = [];

    (workbook.SheetNames || []).forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        let grid;
        try {
            grid = sheetToGrid(sheet);
        } catch (e) {
            errors.push({ sheet: sheetName, reason: "Could not read this sheet's cells." });
            return;
        }
        if (!grid || !grid.length) {
            errors.push({ sheet: sheetName, reason: "The sheet is empty." });
            return;
        }

        const headerRow = findHeaderRow(grid);
        if (headerRow === -1) {
            errors.push({
                sheet: sheetName,
                reason: "No subject header row found. Expected the F, S, N, A (CA sub-score) columns with 40 / 60 / ف1 / ف2 / ف3 headers for every subject."
            });
            return;
        }

        const blocks = extractBlocks(grid[headerRow] || []);
        if (!blocks.length) {
            errors.push({ sheet: sheetName, reason: "No numbered subject blocks were found under the header row." });
            return;
        }

        const warnings = [];
        const subjects = blocks.map((b, idx) => {
            const num = findSubjectNumber(grid, headerRow, b);
            const name = findSubjectName(grid, headerRow, b) || ("Subject " + (num || idx + 1));
            if (!b.cols.T3) warnings.push(name + ": no ف3 (third term) column found - third-term scores will be blank.");
            if (!b.cols.EXAM) warnings.push(name + ": no 60 (exam) column found - exam scores will be blank.");
            if (!b.cols.CA) warnings.push(name + ": no 40 (CA total) column found - CA is computed from F+S+N+A.");
            return { num: num || idx + 1, name, cols: b.cols };
        });

        /* Locate the Adm / Name columns from the header area; fall back to
           the documented order S/N | Adm/Num | Student Name (cols 0,1,2). */
        let admCol = -1;
        let nameCol = -1;
        /* Optional second name column holding the Arabic spelling of the
           student's name (اسم الطلاب / الاسم بالعربية). When present it is
           printed on the Arabic line of the result sheet's name band. */
        let nameArCol = -1;
        /* Scan through AND including the header row - some workbooks put
           the S/N | Adm | Student Name | Arabic Name column titles on
           the subject-band row itself. */
        for (let r = 0; r <= headerRow; r++) {
            const row = grid[r] || [];
            for (let c = 0; c < row.length; c++) {
                const k = normKey(cellText(row[c]));
                if (!k) continue;
                if (admCol === -1 && (k === "adm" || k === "admno" || k === "adm/no" ||
                    k === "admission" || k === "admissionno" || k === "admissionnumber" ||
                    k === "رقمالقيد" || k === "رقمالقبول" || k === "رقمالطالب" || k.startsWith("adm"))) admCol = c;
                else if (nameArCol === -1 && (k === "arabicname" || k === "namearabic" ||
                    k === "studentnamearabic" || k === "nameinarabic" ||
                    k === "namearab" || k === "arabic" || k === "اسمالطلاب" ||
                    k === "الاسمبالعربية" || k === "الاسمبالعربي" ||
                    k === "الاسمالعربي" || k === "الاسمالعربيه" ||
                    k === "الاسمالعربى" || k === "الاسمبالعربيه" ||
                    k === "اسمالطالببالعربية" || k === "اسمالتلميذبالعربية")) nameArCol = c;
                else if (nameCol === -1 && (k === "name" || k === "names" || k === "studentname" ||
                    k === "fullname" || k === "الاسم" || k === "اسمالطالب" ||
                    k === "اسمالتلميذ" || k === "الاسمالكامل")) nameCol = c;
            }
        }
        if (admCol === -1) admCol = 1;
        if (nameCol === -1) nameCol = 2;

        const students = [];
        for (let r = headerRow + 1; r < grid.length; r++) {
            const row = grid[r] || [];
            if (!row.some((c) => cellText(c) !== "")) continue;

            const adm = cellText(admCol < row.length ? row[admCol] : "");
            const name = cellText(nameCol < row.length ? row[nameCol] : "");
            const nameAr = nameArCol !== -1 && nameArCol < row.length ? cellText(row[nameArCol]) : "";
            if (!adm && !name) continue;

            /* Split the combined name cell into its English and Arabic
               parts. When the workbook has a separate Arabic-name column,
               that column wins for the Arabic line and only the Latin part
               of the main column is used for the English line. */
            const splitMain = splitBilingualName(name);
            let nameEn = splitMain.nameEn;
            let finalNameAr = splitMain.nameAr;
            if (nameAr) {
                const splitAr = splitBilingualName(nameAr);
                /* Dedicated Arabic column: use its Arabic part (or the
                   whole cell when it holds no Latin text at all). */
                finalNameAr = splitAr.nameAr || nameAr;
                if (!nameEn) nameEn = splitAr.nameEn; // main column was Arabic-only
            }

            const admKey = normKey(adm);
            const nameKey = normKey(name);
            const rowKey = normKey(row.join(" "));
            if (isFooterRow(admKey, nameKey, rowKey)) continue;
            if (isStudentOrLabelHeader(adm) && isStudentOrLabelHeader(name)) continue; // stray header row

            const scores = subjects.map((sub, si) => {
                const b = blocks[si];
                const get = (t) => (b.cols[t] !== undefined && row[b.cols[t]] !== undefined ? row[b.cols[t]] : null);
                const f = toNum(get("F"));
                const s = toNum(get("S"));
                const n = toNum(get("N"));
                const a = toNum(get("A"));
                const exam = toNum(get("EXAM"));
                const t1 = toNum(get("T1"));
                const t2 = toNum(get("T2"));
                const t3 = toNum(get("T3"));
                const ca40 = toNum(get("CA"));

                let ca = null;
                if (f !== null || s !== null || n !== null || a !== null) {
                    ca = (f || 0) + (s || 0) + (n || 0) + (a || 0);
                } else if (ca40 !== null) {
                    ca = ca40; // no sub-scores: trust the sheet's own CA total
                }

                const total = (ca !== null || exam !== null) ? (ca || 0) + (exam || 0) : null;
                const values = [f, s, n, a, exam, t1, t2, t3];
                const allBlank = values.every((v) => v === null);
                const allZero = !allBlank && values.every((v) => v === 0);
                /* Incomplete = nothing entered at all, an entirely zeroed
                   block, or the exam / third-term columns left blank. */
                const missing = allBlank || allZero || exam === null || t3 === null;
                return { f, s, n, a, ca, exam, t1, t2, t3, total, missing };
            });

            const missingSubjects = [];
            subjects.forEach((sub, si) => { if (scores[si].missing) missingSubjects.push(sub.name); });

            students.push({
                sn: cellText(row[0]),
                adm,
                name,
                nameEn,
                nameAr: finalNameAr,
                scores,
                missingSubjects,
                incomplete: missingSubjects.length > 0
            });
        }

        if (!students.length) {
            warnings.push("No student rows found under the header row.");
        }

        const teacher = findLabeledValue(grid, ["استاذ", "معلم", "teacher"], null);
        let className = findLabeledValue(grid, ["الصف", "class"], ["استاذ", "معلم", "teacher"]);
        if (!className) className = sheetName; // sheet name = class name per spec

        classes.push({ sheet: sheetName, className, teacher, subjects, warnings, students });
    });

    return { classes, errors };
}

/* ------------------------------------------------------------------
   Excel export builder (one tab per class + a summary tab)
   ------------------------------------------------------------------ */
function safeSheetName(name, used) {
    let s = String(name || "Class")
        .replace(/[\\/?*[\]:]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 31);
    if (!s) s = "Class";
    if (s.charAt(0) === "'" || s.charAt(s.length - 1) === "'") s = s.replace(/'/g, "");
    let candidate = s;
    let i = 2;
    while (used.indexOf(candidate) !== -1) {
        const suffix = " (" + i + ")";
        candidate = s.slice(0, 31 - suffix.length) + suffix;
        i++;
    }
    used.push(candidate);
    return candidate;
}

function ordinalPos(n) {
    const p = Number(n) || 0;
    if (p === 1) return "1st";
    if (p === 2) return "2nd";
    if (p === 3) return "3rd";
    return p + "th";
}

/* Hard-coded school letterhead (spec) - printed at the top of the
   Summary tab and every class tab. */
const SCHOOL_LETTERHEAD = {
    nameEn: "AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES",
    nameAr: "مَدْرَسَةُ أَمِينِ اللهِ لِلْعُلُومِ الْعَرَبِيَّةِ الْإِسْلَامِيَّةِ",
    address: "3, Temidire Street off Ondo Benin Road, Ijebu-Ode, Ogun State, Nigeria",
    tel: "08062445559, 08058306889",
    email: "madrasatuameenillah22@gmail.com"
};

/* AVERAGE /100 = (T1 + T2 + T3) / 3 rounded to 1 decimal. Uses the value
   the page already computed when present, otherwise derives it. */
function subjectAverage(sc) {
    if (sc.average !== null && sc.average !== undefined) return sc.average;
    if (sc.t1 === null || sc.t1 === undefined ||
        sc.t2 === null || sc.t2 === undefined ||
        sc.total === null || sc.total === undefined) return null;
    return Math.round(((Number(sc.t1) + Number(sc.t2) + Number(sc.total)) / 3) * 10) / 10;
}

/* Per-subject Total = T1 + T2 + T3. It is deliberately separate from
   the class-wide Grand Total and from the /100 subject average. */
function subjectTotal(sc) {
    let found = false;
    const sum = [sc && sc.t1, sc && sc.t2, sc && sc.total].reduce((total, raw) => {
        if (raw === null || raw === undefined || raw === "") return total;
        const value = Number(raw);
        if (!isFinite(value)) return total;
        found = true;
        return total + value;
    }, 0);
    return found ? Math.round(sum * 100) / 100 : null;
}

/* Grand Total = T1 + T2 + T3 across every subject (13 subjects → 3900).
   Overall average = Grand Total ÷ (subjects × 3) (3900 ÷ 39 = 100).
   Position is ranked by that average. Applied here so the Excel export
   matches the on-screen / PDF formula even if a stale client posted. */
function applyGrandTotals(cls) {
    const n = (cls.subjects || []).length;
    const slots = n * 3;
    (cls.students || []).forEach((st) => {
        let grand = 0;
        (st.scores || []).forEach((sc) => {
            const t1 = Number(sc.t1);
            const t2 = Number(sc.t2);
            const t3 = Number(sc.total);
            if (isFinite(t1)) grand += t1;
            if (isFinite(t2)) grand += t2;
            if (isFinite(t3)) grand += t3;
        });
        st.grandTotal = Math.round(grand * 10) / 10;
        st.pct = slots ? Math.round((grand / slots) * 10) / 10 : 0;
        st.maxTotal = n * 300;
    });
    const sorted = (cls.students || []).slice().sort((a, b) =>
        (Number(b.pct) - Number(a.pct)) || (Number(b.grandTotal) - Number(a.grandTotal))
    );
    let lastAvg = null;
    let lastPos = 0;
    sorted.forEach((s, i) => {
        if (lastAvg === null || Number(s.pct) < lastAvg) {
            lastPos = i + 1;
            lastAvg = Number(s.pct);
        }
        s.position = lastPos;
    });
}

/* Position rendered as "3rd of 24" so class size is always visible. */
function positionOf(pos, total) {
    const t = Number(total) || 0;
    if (!pos) return t ? "\u2014 of " + t : "";
    return ordinalPos(pos) + (t ? " of " + t : "");
}

/* classes: array of parsed class objects (may already carry computed
   position / percentage / grandTotal fields - used when present).
   meta:    { termEndsOn, newSessionStarts } typed by the admin on the
            Third Term Results page - printed on every sheet. */
function buildThirdTermWorkbook(classes, meta) {
    const m = meta || {};
    const termEndsOn = String(m.termEndsOn || "").trim();
    const newSessionStarts = String(m.newSessionStarts || "").trim();
    const datesLine = "Term Ends On / تنتهي الفترة في: " + (termEndsOn || "\u2014") +
        "   |   New Session Starts / \u064a\u0628\u062f\u0623 \u0627\u0644\u0639\u0627\u0645 \u0627\u0644\u062c\u062f\u064a\u062f \u0641\u064a: " + (newSessionStarts || "\u2014");
    const XLSX = X();
    const wb = XLSX.utils.book_new();
    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const usedNames = [];

    const schoolName = SCHOOL_LETTERHEAD.nameEn;
    const schoolNameAr = SCHOOL_LETTERHEAD.nameAr;
    const contactLine = [SCHOOL_LETTERHEAD.address, "Tel: " + SCHOOL_LETTERHEAD.tel, "Email: " + SCHOOL_LETTERHEAD.email].join("  |  ");

    /* ---------- Summary tab ---------- */
    const summaryRows = [];
    summaryRows.push([schoolName]);
    summaryRows.push([schoolNameAr]);
    if (contactLine) summaryRows.push([contactLine]);
    summaryRows.push(["THIRD TERM RESULTS - Consolidated Export / نتائج الفترة الثالثة - تصدير موحّد"]);
    summaryRows.push([datesLine]);
    const summaryBannerRows = summaryRows.length;
    summaryRows.push([]);
    summaryRows.push(["Class / الصف", "Teacher / الأستاذ", "Students in Class / عدد الطلاب في الفترة", "Subjects / المواد", "Generated / التاريخ"]);
    classes.forEach((c) => {
        summaryRows.push([
            c.className || c.sheet || "",
            c.teacher || "",
            (c.students || []).length,
            (c.subjects || []).length,
            today
        ]);
    });
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    const summaryMerges = [];
    /* Merge only the letterhead / title / dates banner rows (everything
       above the blank spacer row) - never the data rows. */
    for (let r = 0; r < summaryBannerRows; r++) {
        summaryMerges.push({ s: { r, c: 0 }, e: { r, c: 4 } });
    }
    summarySheet["!merges"] = summaryMerges;
    summarySheet["!cols"] = [{ wch: 30 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

    /* ---------- One tab per class ---------- */
    classes.forEach((c) => {
        applyGrandTotals(c);
        const subjects = c.subjects || [];
        const students = c.students || [];
        const n = subjects.length;
        const classSize = c.studentCount || students.length;
        /* Per subject, export Average, Total, T3, T2 and T1. CA /40
           and Exam /60 are deliberately not exported. */
        const width = 4 + n * 5 + 5; // identity + 5 cols/subject + summary columns

        const rows = [];
        rows.push([schoolName]);
        rows.push([schoolNameAr]);
        if (contactLine) rows.push([contactLine]);
        rows.push(["THIRD TERM RESULTS / نتائج الفترة الثالثة"]);
        rows.push(["Class / الصف: " + (c.className || c.sheet || "") + "   |   Teacher / الأستاذ: " + (c.teacher || "") + "   |   Students in Class / عدد الطلاب في الفترة: " + classSize]);
        rows.push(["Term: 3rd Term / الفترة الثالثة   |   Generated: " + today]);
        rows.push([datesLine]);
        rows.push([]);

        /* The name is SPLIT here, like on the result sheet: English name
           in its own column, Arabic name in its own column (the workbook
           usually has both spellings together in one cell). */
        const band = ["S/N", "Adm No", "Student Name (English) / الاسم بالإنجليزية", "Student Name (Arabic) / الاسم بالعربية"];
        const subBand = ["", "", "", ""];
        const bandRow = rows.length;      // subject-name band row index
        const merges = [];
        for (let r = 0; r < rows.length; r++) {
            merges.push({ s: { r, c: 0 }, e: { r, c: width - 1 } });
        }
        subjects.forEach((sub, si) => {
            // Four identity columns precede every five-column subject band.
            const base = 4 + si * 5;
            band.push(sub.name, "", "", "", "");
            subBand.push("AVERAGE /100", "TOTAL", "T3 /100", "T2 /100", "T1 /100");
            merges.push({ s: { r: bandRow, c: base }, e: { r: bandRow, c: base + 4 } });
        });
        band.push("Grand Total / المجموع الكلي", "Average / النسبة المئوية", "Students in Class / عدد الطلاب في الفترة", "Position / الدرجة", "Status / الحالة");
        subBand.push("", "", "", "", "");
        rows.push(band, subBand);

        students.forEach((st) => {
            /* Fall back to splitting when the client did not send the
               split fields (e.g. data parsed by an older build). */
            let nameEn = "", nameAr = "";
            if (st.nameEn !== undefined || st.nameAr !== undefined) {
                nameEn = st.nameEn || "";
                nameAr = st.nameAr || "";
            } else {
                const split = splitBilingualName(st.name);
                nameEn = split.nameEn;
                nameAr = split.nameAr;
            }
            const row = [st.sn, st.adm, nameEn, nameAr];
            (st.scores || []).forEach((sc) => {
                const avg = subjectAverage(sc);
                const total = subjectTotal(sc);
                row.push(
                    avg === null ? "" : avg,
                    total === null ? "" : total,
                    sc.total === null || sc.total === undefined ? "" : sc.total,
                    sc.t2 === null || sc.t2 === undefined ? "" : sc.t2,
                    sc.t1 === null || sc.t1 === undefined ? "" : sc.t1
                );
            });
            const maxTotal = st.maxTotal || (n * 300);
            row.push(
                st.grandTotal === null || st.grandTotal === undefined ? "" : (st.grandTotal + " / " + maxTotal),
                st.pct === null || st.pct === undefined ? "" : st.pct,
                classSize,
                positionOf(st.position, classSize),
                st.incomplete ? "Incomplete Data / بيانات ناقصة" : ""
            );
            rows.push(row);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!merges"] = merges;
        ws["!cols"] = [{ wch: 6 }, { wch: 13 }, { wch: 30 }, { wch: 30 }];
        for (let si = 0; si < n; si++) {
            for (let k = 0; k < 5; k++) ws["!cols"].push({ wch: 11 });
        }
        ws["!cols"].push({ wch: 12 }, { wch: 9 }, { wch: 18 }, { wch: 12 }, { wch: 22 });

        XLSX.utils.book_append_sheet(wb, ws, safeSheetName(c.className || c.sheet || "Class", usedNames));
    });

    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = { parseWorkbook, buildThirdTermWorkbook, splitBilingualName };
