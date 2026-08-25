/* ================================================================
   Complete shared navigation for administrators and teachers.
   ----------------------------------------------------------------
   Every staff page loads this through js/ui.js. The signed-in role is
   checked before anything is shown. Existing app-shell sidebars are
   upgraded in place; older standalone pages receive the same menu as a
   drawer. This keeps one source of truth for all staff sections.
   ================================================================ */
(function () {
  "use strict";

  var page = (location.pathname.split("/").pop() || "").toLowerCase();
  if (/^(login\.html|portal-login\.html|portal\.html|student-ai-tutor\.html|index\.html|offline\.html|)$/.test(page) || document.body.classList.contains("pt-body")) return;

  var ICONS = {
    dashboard:'<rect x="3" y="3" width="7" height="8" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/>',
    chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    bell:'<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M14 21h-4"/>',
    chat:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.2a4 4 0 0 1 0 7.6"/>',
    notice:'<path d="m3 11 18-5v12L3 13z"/><path d="M11.5 16.8a3 3 0 0 1-5.7-1.6"/>',
    clipboard:'<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M9 11h6M9 15h6"/>',
    book:'<path d="M2 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H2zM22 4h-7a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h7z"/>',
    upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    userplus:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.5-4.5"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8"/>',
    calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
    heart:'<path d="M22 12h-4l-3 8-6-17-3 9H2"/>',
    shield:'<path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    check:'<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pen:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    spark:'<path d="m12 2 1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    award:'<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>',
    folder:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    broadcast:'<path d="M3 11v2M7 9v6M11 7v10M15 5v14M19 8v8M22 11v2"/>',
    bus:'<rect x="3" y="3" width="18" height="15" rx="3"/><path d="M7 18v3M17 18v3M3 11h18M7 7h.01M17 7h.01"/>',
    leave:'<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    id:'<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5 16c.8-1.3 1.8-2 3-2s2.2.7 3 2M14 10h5M14 14h5"/>',
    signature:'<path d="M20 12a6 6 0 0 0-8.5-8.5L5 10v9h9zM16 8l-9 9M9 20h12"/>',
    briefcase:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M2 12h20"/>',
    send:'<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    money:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.5 1A7 7 0 0 0 15 6l-.4-2.7h-4L10 6a7 7 0 0 0-1.4.8l-2.5-1-2 3.4L6 10.8a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.5-1A7 7 0 0 0 10 18l.4 2.7h4L15 18a7 7 0 0 0 1.4-.8l2.5 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.3z"/>',
    home:'<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10"/>',
    logout:'<path d="M10 17l5-5-5-5M15 12H3M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>'
  };

  var GROUPS = [
    { label:"Main", items:[
      ["teacher-dashboard.html","Dashboard","dashboard"],
      ["analytics.html","Analytics","chart"],
      ["notifications.html","Notifications","bell","notifications"],
      ["chat.html","Chat","chat","chat"],
      ["staff-chat.html","Staff Chat","users"],
      ["notices.html","Notices","notice"]
    ]},
    { label:"Students & Results", items:[
      ["students.html","Students Directory","users"],
      ["add-student.html","Add Student","userplus"],
      ["scores.html","Student Scores","clipboard"],
      ["gradebook.html","Grade Book","book"],
      ["bulk-results.html","Bulk Result Import","upload"],
      ["student-result.html","Check Result","search"],
      ["class-results.html","Class Results","file"],
      ["third-term-results.html","Third Term Results","file"],
      ["attendance.html","Attendance","calendar"],
      ["tahfeedh.html","Tahfeedh Tracker","book"],
      ["health.html","Student Health","heart"],
      ["remarks.html","Teacher Comments","chat"],
      ["discipline.html","Discipline Records","shield"],
      ["quizzes.html","Online Quizzes","check"],
      ["appointments.html","Appointments","clock"]
    ]},
    { label:"Teaching Tools", items:[
      ["add-subject.html","Classes & Subjects","book"],
      ["manage-classes.html","Class Management","home"],
      ["timetable.html","Timetables","calendar"],
      ["create-exam.html","Create Exam","pen"],
      ["lesson-planner.html","Lesson Planner","book"],
      ["ai-remarks.html","AI Chat","spark"],
      ["ai-image-generator.html","AI Image Generator","image"],
      ["homework.html","Homework Board","file"],
      ["certificates.html","Certificates","award"],
      ["store.html","File Store","folder"],
      ["broadcast.html","School Broadcasts","broadcast"],
      ["gallery.html","School Gallery","image"],
      ["transport.html","Transport","bus"],
      ["library.html","School Library","book"],
      ["leave-requests.html","Leave Requests","leave"],
      ["id-card.html","Create ID Card","id"],
      ["manage-signatures.html","Manage Signatures","signature"],
      ["staff-attendance.html","Staff Tools","briefcase"],
      ["manage-calendars.html","Madrasah Calendar","calendar"]
    ]},
    { label:"Administration", admin:true, items:[
      ["manage-publish.html","Publish Results","send"],
      ["manage-admissions.html","Admissions","award"],
      ["finance.html","Finance","money"],
      ["manage-users.html","Manage Users","shield"],
      ["staff.html","Staff & Payroll","users"],
      ["notify-parents.html","Notify Parents","send"],
      ["school-settings.html","School Settings","settings"]
    ]},
    { label:"Account", items:[
      ["settings.html","My Settings","settings"]
    ]}
  ];

  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.file) + "</svg>";
  }

  function brand() {
    var el = document.createElement("div");
    el.className = "ams-side-brand";
    el.innerHTML = '<img src="images/LOGO.JPG" alt="School Logo"><div><div class="ams-school-name">AMEENULLAH SCHOOL OF ARABIC AND ISLAMIC STUDIES</div><div class="ams-school-sub">Result Management System</div></div>';
    return el;
  }

  function createNav(me) {
    var nav = document.createElement("nav");
    nav.className = "ams-side-nav";
    nav.setAttribute("aria-label", "All staff sections");

    var meta = document.createElement("div");
    meta.className = "ams-shared-nav-meta";
    var who = document.createElement("span");
    who.textContent = me.username || "Staff";
    var role = document.createElement("span");
    role.className = "ams-shared-role";
    role.textContent = me.role || "staff";
    meta.appendChild(who);
    meta.appendChild(role);
    nav.appendChild(meta);

    GROUPS.forEach(function (group) {
      if (group.admin && me.role !== "admin") return;
      var label = document.createElement("div");
      label.className = "ams-nav-label";
      label.textContent = group.label;
      nav.appendChild(label);

      group.items.forEach(function (item) {
        var link = document.createElement("a");
        link.href = item[0];
        link.innerHTML = svg(item[2]);
        var text = document.createElement("span");
        text.className = "ams-shared-link-label";
        text.textContent = item[1];
        link.appendChild(text);
        if (item[0].toLowerCase() === page) {
          link.classList.add("ams-active");
          link.setAttribute("aria-current", "page");
        }
        if (item[3]) {
          var badge = document.createElement("span");
          badge.className = "ams-shared-badge";
          badge.id = item[3] === "chat" ? "amsSideChatBadge" : "amsSideNotifBadge";
          link.appendChild(badge);
        }
        link.addEventListener("click", closeMenus);
        nav.appendChild(link);
      });
    });
    return nav;
  }

  function createFooter() {
    var foot = document.createElement("div");
    foot.className = "ams-side-footer";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ams-shared-logout";
    btn.innerHTML = svg("logout") + " Logout";
    btn.addEventListener("click", function () {
      btn.disabled = true;
      fetch("/logout", { method:"POST", credentials:"same-origin" })
        .catch(function () {})
        .then(function () { location.href = "login.html"; });
    });
    foot.appendChild(btn);
    return foot;
  }

  function fillSidebar(sidebar, me) {
    sidebar.setAttribute("data-shared-navigation", "true");
    var oldBrand = sidebar.querySelector(".ams-side-brand");
    if (!oldBrand) sidebar.insertBefore(brand(), sidebar.firstChild);
    var oldNav = sidebar.querySelector(".ams-side-nav");
    var nav = createNav(me);
    if (oldNav) oldNav.replaceWith(nav);
    else sidebar.appendChild(nav);
    var oldFoot = sidebar.querySelector(".ams-side-footer");
    var foot = createFooter();
    if (oldFoot) oldFoot.replaceWith(foot);
    else sidebar.appendChild(foot);
    return sidebar;
  }

  function closeMenus() {
    document.documentElement.classList.remove("ams-nav-open");
    document.documentElement.classList.remove("ams-global-nav-open");
    document.querySelectorAll(".ams-shared-menu-trigger").forEach(function (b) {
      b.setAttribute("aria-expanded", "false");
    });
  }

  function toggleDrawer() {
    var willOpen = !document.documentElement.classList.contains("ams-global-nav-open");
    closeMenus();
    if (willOpen) document.documentElement.classList.add("ams-global-nav-open");
    document.querySelectorAll(".ams-shared-menu-trigger").forEach(function (b) {
      b.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    if (willOpen) {
      var active = document.querySelector(".ams-shared-drawer .ams-active");
      if (active && typeof active.scrollIntoView === "function") {
        setTimeout(function () { active.scrollIntoView({ block:"center" }); }, 90);
      }
    }
  }

  function menuButton() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ams-shared-menu-trigger";
    btn.setAttribute("aria-label", "Open all sections");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = svg("dashboard") + '<span class="ams-shared-menu-text">Sections</span>';
    btn.addEventListener("click", toggleDrawer);
    return btn;
  }

  function addDrawer(me) {
    var aside = document.createElement("aside");
    aside.className = "ams-sidebar ams-shared-drawer";
    aside.setAttribute("aria-label", "Staff navigation");
    aside.appendChild(brand());
    aside.appendChild(createNav(me));
    aside.appendChild(createFooter());
    aside.setAttribute("data-shared-navigation", "true");
    document.body.appendChild(aside);

    var scrim = document.createElement("div");
    scrim.className = "ams-shared-nav-scrim";
    scrim.addEventListener("click", closeMenus);
    document.body.appendChild(scrim);

    var btn = menuButton();
    var target = document.querySelector(".mng-head, .ch-list-head, .sc-top, .nt-top, .nf-top, .st-top, .tt-top, .aig-top, .ai-top, body > header");
    if (target) target.insertBefore(btn, target.firstChild);
    else {
      btn.classList.add("ams-shared-menu-float");
      document.body.appendChild(btn);
    }
  }

  function createQuickNav(me, hasShellSidebar) {
    document.querySelectorAll(".ams-quicknav, .ams-shared-quicknav").forEach(function (old) { old.remove(); });
    var items = [
      ["teacher-dashboard.html","🏠","Home"],
      ["students.html","👥","Students"],
      ["scores.html","✏️","Scores"],
      ["student-result.html","📊","Results"],
      ["attendance.html","📋","Attendance"],
      ["chat.html","💬","Chat"]
    ];
    if (me.role === "admin") items.push(["finance.html","💵","Finance"]);

    var bar = document.createElement("nav");
    bar.className = "ams-shared-quicknav";
    bar.setAttribute("aria-label", "Staff quick links");
    items.forEach(function (item) {
      var link = document.createElement("a");
      link.className = "ams-shared-qn-item";
      link.href = item[0];
      link.innerHTML = '<span class="ams-shared-qn-ico" aria-hidden="true">' + item[1] + '</span><span class="ams-shared-qn-lbl">' + item[2] + "</span>";
      if (item[0].toLowerCase() === page) link.setAttribute("aria-current", "page");
      bar.appendChild(link);
    });
    var menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ams-shared-qn-item";
    menu.setAttribute("aria-label", "Open all sections");
    menu.innerHTML = '<span class="ams-shared-qn-ico" aria-hidden="true">☰</span><span class="ams-shared-qn-lbl">Menu</span>';
    menu.addEventListener("click", function () {
      if (hasShellSidebar) {
        var willOpen = !document.documentElement.classList.contains("ams-nav-open");
        closeMenus();
        if (willOpen) {
          document.documentElement.classList.add("ams-nav-open");
          var active = document.querySelector(".ams-sidebar:not(.ams-shared-drawer) .ams-active");
          if (active && typeof active.scrollIntoView === "function") {
            setTimeout(function () { active.scrollIntoView({ block:"center" }); }, 90);
          }
        }
      } else toggleDrawer();
    });
    bar.appendChild(menu);
    document.body.appendChild(bar);
  }

  function refreshUnread() {
    fetch("/api/messages/unread", { credentials:"same-origin" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (data) {
        var count = Number(data && data.count) || 0;
        ["amsSideChatBadge", "amsSideNotifBadge"].forEach(function (id) {
          var badge = document.getElementById(id);
          if (!badge) return;
          badge.textContent = count > 9 ? "9+" : String(count);
          badge.style.display = count ? "inline-block" : "none";
        });
      }).catch(function () {});
  }

  function mount(me) {
    if (!me || !me.loggedIn || (me.role !== "admin" && me.role !== "teacher")) return;
    if (document.body.classList.contains("ams-staff-navigation")) return;
    document.body.classList.add("ams-staff-navigation");

    var sidebar = document.querySelector(".ams-sidebar:not(.ams-shared-drawer)");
    var hasShellSidebar = !!sidebar;
    if (sidebar) fillSidebar(sidebar, me);
    else addDrawer(me);
    createQuickNav(me, hasShellSidebar);
    refreshUnread();

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeMenus();
    });
  }

  function init() {
    fetch("/me", { credentials:"same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(mount)
      .catch(function () { /* Page features remain available if nav lookup fails. */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
