/* Focused regressions for linked children, signed receipts and teacher/admin
   boundaries. This is intentionally database-free: it executes the browser
   family and PDF components with small fakes, and verifies that server route
   contracts retain their authorization middleware. */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
let passed = 0;
let failed = 0;
function check(condition, label, detail) {
  if (condition) { passed++; console.log("  ok   - " + label); }
  else { failed++; console.error("  FAIL - " + label + (detail ? " [" + detail + "]" : "")); }
}
function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(data)
  };
}
function tick() { return new Promise((resolve) => setTimeout(resolve, 10)); }

function element(tag) {
  return {
    tagName: String(tag || "div").toUpperCase(), children: [], style: {},
    value: "", textContent: "", innerHTML: "", disabled: false, selected: false,
    className: "", title: "", src: "", listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    reset() { this.resetCalled = true; },
    set innerHTML(value) { this._html = String(value); this.children = []; },
    get innerHTML() { return this._html || ""; }
  };
}

async function familyBrowserTests() {
  console.log("\nParent portal family switcher");
  const portalJs = read("js/portal.js");
  const start = portalJs.indexOf("var ptFamilyWired = false;");
  const end = portalJs.indexOf("/* pack 21: fetch helper", start);
  check(start >= 0 && end > start, "linked-child browser module is present");

  const ids = {
    ptFamilyNote: element(), ptFamilyList: element(), ptChildSelect: element("select"),
    ptFamilySwitch: element(), ptLinkChildForm: element("form"),
    ptLinkStudentId: element("input"), ptLinkPassword: element("input"),
    ptLinkChildBtn: element("button")
  };
  const calls = [];
  let reloads = 0;
  const childrenPayload = {
    active_student_id: "AMS001",
    children: [
      { student_id: "AMS001", full_name: "Aisha Bello", class_name: "JSS 1" },
      { student_id: "AMS002", full_name: "Bilal Bello", class_name: "Primary 5" },
      { student_id: "AMS003", full_name: "Maryam Bello", class_name: "Primary 2" }
    ]
  };
  function fetchFake(url, options) {
    calls.push({ url: String(url), options: options || {} });
    if (url === "/portal/children") return Promise.resolve(response(200, childrenPayload));
    if (url === "/portal/children/switch") return Promise.resolve(response(200, { message: "Switched" }));
    if (url === "/portal/children/link") return Promise.resolve(response(200, { message: "Child linked." }));
    return Promise.resolve(response(404, { message: "Unexpected URL" }));
  }
  const ctx = vm.createContext({
    console, Promise, String, Array, Object, JSON, Error,
    document: {
      getElementById: (id) => ids[id] || null,
      createElement: (tag) => element(tag)
    },
    window: { location: { reload: () => { reloads++; } } },
    fetch: fetchFake,
    esc: (s) => String(s)
  });
  vm.runInContext(portalJs.slice(start, end), ctx, { filename: "portal-family-module.js" });

  ctx.loadPortalChildren();
  await tick();
  check(ids.ptFamilyList.children.length === 3, "all three children render (not capped at two)");
  check(ids.ptChildSelect.children.length === 3, "top switcher lists all linked children");
  check(ids.ptFamilySwitch.style.display === "flex", "switcher appears when siblings are linked");
  check(ids.ptFamilyList.children[0].disabled === true && /active/.test(ids.ptFamilyList.children[0].className),
    "currently active child is identified and cannot be redundantly switched");

  ids.ptChildSelect.value = "AMS003";
  ids.ptChildSelect.onchange();
  await tick();
  const switchCall = calls.find((c) => c.url === "/portal/children/switch");
  check(switchCall && JSON.parse(switchCall.options.body).student_id === "AMS003",
    "choosing a sibling asks the server to change the active child");
  check(reloads === 1, "successful switch reloads every child-specific portal view");

  ids.ptLinkStudentId.value = "AMS004";
  ids.ptLinkPassword.value = "bello";
  ids.ptLinkChildForm.listeners.submit({ preventDefault() {} });
  await tick(); await tick();
  const linkCall = calls.find((c) => c.url === "/portal/children/link");
  const linkBody = linkCall && JSON.parse(linkCall.options.body);
  check(linkBody && linkBody.student_id === "AMS004" && linkBody.password === "bello",
    "link form sends the other child's own credentials for verification");
  check(ids.ptLinkChildForm.resetCalled === true && /linked/i.test(ids.ptFamilyNote.textContent),
    "successful link clears the credentials and confirms the family link");
}

function receiptPdfTests() {
  console.log("\nOfficial payment receipt signatures");
  const ops = [];
  function FakePdf() { this.fontSize = 9; this.fontStyle = "normal"; }
  ["setDrawColor", "setLineWidth", "line", "setFont", "setTextColor", "text",
    "setFillColor", "rect", "addPage"].forEach((name) => {
    FakePdf.prototype[name] = function () {
      ops.push({ name, args: Array.from(arguments) });
      if (name === "setFont") this.fontStyle = arguments[1] || "normal";
    };
  });
  FakePdf.prototype.setFontSize = function (size) { this.fontSize = size; };
  FakePdf.prototype.getFontSize = function () { return this.fontSize; };
  FakePdf.prototype.getFont = function () { return { fontStyle: this.fontStyle }; };
  FakePdf.prototype.splitTextToSize = function (text) { return [String(text)]; };
  FakePdf.prototype.addImage = function () { ops.push({ name: "addImage", args: Array.from(arguments) }); };

  const ctx = vm.createContext({
    console, window: { jspdf: { jsPDF: FakePdf } },
    document: { createElement() { throw new Error("Canvas should not be needed for Latin test data"); } },
    Number, String, Array, Object, Math
  });
  vm.runInContext(read("js/ams-pdf.js"), ctx, { filename: "js/ams-pdf.js" });
  ctx.window.amsReceiptPDF({
    receiptNo: "RCP-00001", date: "2026-09-15", studentName: "Aisha Bello",
    studentId: "AMS001", className: "JSS 1", term: "1st Term", session: "2026/2027",
    amount: 50000, method: "Transfer", receivedBy: "Admin",
    headTeacherSignature: "data:image/png;base64,HEAD", principalSignature: "data:image/png;base64,PRINCIPAL"
  });
  const images = ops.filter((op) => op.name === "addImage");
  const labels = ops.filter((op) => op.name === "text").map((op) => op.args[0]);
  const lines = ops.filter((op) => op.name === "line");
  check(images.length === 2 && images[0].args[0].includes("HEAD") && images[1].args[0].includes("PRINCIPAL"),
    "Head Teacher and Principal signature images are stamped on the receipt");
  check(labels.includes("HEAD TEACHER") && labels.includes("PRINCIPAL"),
    "both official signature areas are clearly labelled");
  check(lines.length >= 5, "manual fallback lines remain available when a signature is missing");

  const finance = read("js/finance.js");
  check(/fetch\("\/signatures"/.test(finance) && /rolePath\("head_teacher"\)/.test(finance) && /rolePath\("principal"\)/.test(finance),
    "finance loads the two saved role signatures from the server");
  check(/headTeacherSignature:\s*signatures\.headTeacherSignature/.test(finance) &&
        /principalSignature:\s*signatures\.principalSignature/.test(finance),
    "receipt download passes both loaded signatures into the PDF builder");
}

function authorizationContractTests() {
  console.log("\nTeacher/admin authorization contracts");
  const server = read("server.js");
  const nav = read("js/staff-navigation.js");
  const portalHtml = read("portal.html");
  const modernCss = read("css/modern-ui.css");

  check(/CREATE TABLE IF NOT EXISTS portal_family_links/.test(server) &&
        /PRIMARY KEY \(student_id, linked_student_id\)/.test(server),
    "family links persist bidirectionally with duplicate protection");
  check(/app\.post\("\/portal\/children\/link", writeRateLimit/.test(server) &&
        /verifyPortalStudentCredentials\(studentId, password/.test(server),
    "the server verifies every newly linked child's credentials");
  check(/app\.post\("\/portal\/children\/switch"/.test(server) &&
        /That child is not linked to this family portal/.test(server),
    "server rejects switching to an unlinked student ID");
  check(/id="ptFamilyList"/.test(portalHtml) && /id="ptChildSelect"/.test(portalHtml),
    "portal contains both family management and one-tap child switching UI");

  const adminPages = ["analytics", "manage-classes", "transport", "leave-requests", "broadcast", "health"];
  adminPages.forEach((name) => check(new RegExp('"' + name + '\\.html"').test(server),
    name + ".html is included in the pre-static admin page gate"));

  const adminRoutes = [
    ["post", "/save-signature"], ["post", "/save-student"], ["post", "/add-class"],
    ["post", "/add-subject"], ["delete", "/api/clear-class-term-results"],
    ["get", "/staff-attendance"], ["get", "/api/health-records"],
    ["get", "/api/transport/routes"], ["get", "/api/leave-requests"],
    ["get", "/api/broadcasts"]
  ];
  adminRoutes.forEach(([method, route]) => {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]+/g, "[^\"]+");
    const re = new RegExp('app\\.' + method + '\\("' + escaped + '"[^\\n]*requireAdmin');
    check(re.test(server), method.toUpperCase() + " " + route + " requires admin authorization");
  });

  const teachingStart = nav.indexOf('{ label:"Teaching Tools"');
  const adminStart = nav.indexOf('{ label:"Administration"');
  const adminEnd = nav.indexOf('{ label:"Account"');
  const teacherVisible = nav.slice(0, adminStart);
  const administration = nav.slice(adminStart, adminEnd);
  ["finance.html", "health.html", "broadcast.html", "manage-signatures.html", "add-student.html"].forEach((page) => {
    check(!teacherVisible.includes(page) && administration.includes(page), page + " appears only in Administration navigation");
  });
  check(teachingStart >= 0 && /ams-role-teacher \[data-admin-only\]/.test(modernCss),
    "declarative admin-only controls stay hidden even when inserted dynamically");
  check(/crClearClassBtn[^>]+data-admin-only/.test(read("class-results.html")) &&
        /bs-del-btn[^>]+data-admin-only/.test(read("js/class-results.js")),
    "destructive class-result controls are hidden from teachers");
}

(async function main() {
  await familyBrowserTests();
  receiptPdfTests();
  authorizationContractTests();
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
