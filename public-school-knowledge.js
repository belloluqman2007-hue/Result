"use strict";

/*
 * Canonical, public-only knowledge for the assistant on index.html.
 * Keep this in one place so the bot describes exactly what visitors can see
 * without receiving private student, staff, result, fee or bank records.
 */
const DEFAULTS = Object.freeze({
    schoolName: "Ameenullah School of Arabic and Islamic Studies",
    schoolNameAr: "مدرسة أمين اللّه للعلوم العربيّة الإسلاميّة",
    motto: "Knowledge and Worship",
    mottoAr: "العلم والعبادة",
    address: "3, Temidire Street, Off Ondo Road, Ijebu-Ode, Ogun State, Nigeria",
    phone1: "08062445559",
    phone2: "08058306889",
    email: "madrasatuameenillah22@gmail.com"
});

function clean(value, maxLength) {
    return String(value == null ? "" : value)
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength || 500);
}

function valueOr(value, fallback, maxLength) {
    return clean(value, maxLength) || fallback;
}

function isoDate(value) {
    if (!value) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const match = clean(value, 40).match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
}

function publicSchoolKnowledge(settings, announcements, events) {
    const st = settings || {};
    const schoolName = valueOr(st.school_name, DEFAULTS.schoolName, 255);
    const schoolNameAr = valueOr(st.school_name_ar, DEFAULTS.schoolNameAr, 255);
    const motto = valueOr(st.motto, DEFAULTS.motto, 255);
    const mottoAr = valueOr(st.motto_ar, DEFAULTS.mottoAr, 255);
    const address = valueOr(st.address, DEFAULTS.address, 500);
    // The real schema uses phone1/phone2. `phone` is retained only as a
    // compatibility fallback for a very old installation.
    const phone1 = valueOr(st.phone1 || st.phone, DEFAULTS.phone1, 60);
    const phone2 = valueOr(st.phone2, DEFAULTS.phone2, 60);
    const email = valueOr(st.email, DEFAULTS.email, 150);

    const lines = [
        "PUBLIC SCHOOL PROFILE",
        "Official name: " + schoolName + ".",
        "Short name: AMSAIS.",
        "Arabic name: " + schoolNameAr + ".",
        "Location: Ijebu-Ode, Ogun State, Nigeria.",
        "Address: " + address + ".",
        "Motto: " + motto + " (Arabic: " + mottoAr + ").",
        "Contact phones: " + phone1 + (phone2 && phone2 !== phone1 ? ", " + phone2 : "") + ".",
        "Email: " + email + ".",
        "The school balances Arabic and Islamic knowledge with worship, discipline, good character and caring teaching.",
        "It offers a structured Arabic curriculum, Qur'an memorisation, Tajweed, daily attendance, term calendars and parent communication.",
        "",
        "PROGRAMMES SHOWN ON THE PUBLIC WEBSITE",
        "1. Preparatory (Tahdiri / التحضيري): Arabic letters and sounds, short surahs, duas and good manners.",
        "2. Foundation (Ibtida'i / الابتدائي): Arabic reading and writing, memorisation, morals, and Friday general revision.",
        "3. Middle (I'dadi / الإعدادي): deeper grammar, fiqh and Tajweed, guided memorisation and weekly lectures.",
        "4. Advanced (Thanawi / الثانوي): advanced texts, research habits and preparation for higher Islamic learning.",
        "5. Tahfeedhul-Qur'an (تحفيظ القرآن الكريم): evening Qur'an memorisation on Thursday, Friday and Saturday from 4:00 PM until sunset.",
        "Do not invent ages, programme duration, tuition, admission fees, vacancies, transport arrangements or ordinary school opening hours; the public website does not state them.",
        "",
        "ADMISSION",
        "Admission has three public steps: (1) send the enquiry form or call the school, (2) management contacts the family, answers questions and confirms admission, (3) management adds the child to the register and the Student/Parent Portal becomes active.",
        "The enquiry form asks for the child's full name and phone number (required), plus parent/guardian name, class applying for and an optional message.",
        "The form is in the Apply/Admission section of the public homepage. A visitor can also use the contact phones or email above.",
        "Never claim that submitting the form guarantees admission; management confirms it.",
        "",
        "PORTALS AND PUBLIC WEBSITE",
        "Admin and teachers use the Staff login page. Admin tools include results, publishing, finance, attendance and admissions. Teacher tools include score entry, attendance, exams, report sheets and class tools.",
        "Students and parents use the Student/Parent Portal. They log in with the child's Student ID and surname; accounts are activated by school management.",
        "The parent portal can show published results, signed report sheets, fees and balances, calendars, notices, attendance/progress, school chat and payment-evidence upload.",
        "Only published results are available to families. The assistant cannot look up a student's result, balance, password or private record; direct the family to the portal or school office.",
        "The public homepage also has About, Programmes, Notices, Honour Roll, Portal Login and Admission sections.",
        "The public Notice Board displays general announcements and upcoming school events without login.",
        "The Honour Roll, when published, displays the top three students per class from the latest recorded term.",
        "Online result sheets can include class-teacher and principal signatures.",
        "",
        "SAFE ANSWERING RULES FROM THE SCHOOL",
        "For fees, dates, results, policies or any detail not stated here, say that school management must confirm it and give the public contact details. Never expose or guess private records or bank details."
    ];

    const currentTerm = clean(st.current_term, 50);
    if (currentTerm) lines.push("Current term saved by management: " + currentTerm + ".");
    const termBegins = isoDate(st.term_begins);
    const termEnds = isoDate(st.term_ends);
    const nextTerm = isoDate(st.next_term_begins);
    if (termBegins) lines.push("Published term beginning date: " + termBegins + ".");
    if (termEnds) lines.push("Published term ending date: " + termEnds + ".");
    if (nextTerm) lines.push("Published next-term beginning date: " + nextTerm + ".");
    const notice = clean(st.result_notice, 700);
    if (notice) lines.push("Public result notice: " + notice);

    const safeEvents = (Array.isArray(events) ? events : []).slice(0, 10).map(function (event) {
        const title = clean(event && event.title, 180);
        if (!title) return "";
        const date = isoDate(event && event.event_date);
        const description = clean(event && event.description, 500);
        return "- " + title + (date ? " on " + date : "") + (description ? ": " + description : "");
    }).filter(Boolean);
    const safeAnnouncements = (Array.isArray(announcements) ? announcements : []).slice(0, 10).map(function (item) {
        const title = clean(item && item.title, 180);
        if (!title) return "";
        const body = clean(item && item.body, 700);
        const date = isoDate(item && item.created_at);
        return "- " + title + (date ? " (posted " + date + ")" : "") + (body ? ": " + body : "");
    }).filter(Boolean);

    lines.push("", "LIVE PUBLIC NOTICE BOARD");
    if (safeEvents.length) lines.push("Upcoming events:", safeEvents.join("\n"));
    if (safeAnnouncements.length) lines.push("General announcements:", safeAnnouncements.join("\n"));
    if (!safeEvents.length && !safeAnnouncements.length) {
        lines.push("There are no current public announcements or upcoming events. Do not invent one.");
    }

    return lines.join("\n");
}

module.exports = { DEFAULTS, publicSchoolKnowledge };
