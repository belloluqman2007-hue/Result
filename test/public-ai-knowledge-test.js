"use strict";

const assert = require("assert");
const { DEFAULTS, publicSchoolKnowledge } = require("../public-school-knowledge");

const base = publicSchoolKnowledge({}, [], []);
assert(base.includes(DEFAULTS.schoolName), "default school name is present");
assert(base.includes("Ijebu-Ode, Ogun State, Nigeria"), "correct location is present");
assert(!/Lagos/i.test(base), "the old incorrect Lagos location is gone");
assert(base.includes(DEFAULTS.phone1) && base.includes(DEFAULTS.phone2), "both public phones are present");
assert(base.includes("Preparatory (Tahdiri"), "Tahdiri is known");
assert(base.includes("Foundation (Ibtida'i"), "Ibtida'i is known");
assert(base.includes("Middle (I'dadi"), "I'dadi is known");
assert(base.includes("Advanced (Thanawi"), "Thanawi is known");
assert(base.includes("Thursday, Friday and Saturday from 4:00 PM until sunset"), "Tahfeedh schedule is known");
assert(base.includes("three public steps"), "admission steps are known");
assert(base.includes("Student ID and surname"), "portal login instructions are known");
assert(base.includes("Honour Roll"), "public Honour Roll is known");
assert(base.includes("no current public announcements"), "empty notice board is represented honestly");

const live = publicSchoolKnowledge({
    school_name: "Test Academy",
    school_name_ar: "مدرسة الاختبار",
    motto: "Learn Well",
    address: "10 Test Road, Ijebu-Ode",
    phone1: "111",
    phone2: "222",
    email: "office@example.test",
    current_term: "2nd Term",
    term_ends: "2026-12-12T00:00:00.000Z"
}, [{
    title: "Parents Meeting\u0000",
    body: "Please arrive by 10 AM.\nThank you.",
    created_at: "2026-09-15 08:00:00"
}], [{
    title: "Open Day",
    event_date: "2026-10-04",
    description: "Meet the teachers."
}]);

[
    "Test Academy", "مدرسة الاختبار", "Learn Well", "10 Test Road, Ijebu-Ode",
    "Contact phones: 111, 222", "office@example.test", "Current term saved by management: 2nd Term",
    "Published term ending date: 2026-12-12", "Parents Meeting (posted 2026-09-15)",
    "Please arrive by 10 AM. Thank you.", "Open Day on 2026-10-04: Meet the teachers."
].forEach(function (text) {
    assert(live.includes(text), "dynamic public knowledge includes: " + text);
});
assert(!live.includes("\u0000"), "control characters are stripped from public content");

console.log("PASS public AI has complete, accurate, public-only school knowledge");
