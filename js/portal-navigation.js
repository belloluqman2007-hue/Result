/* Complete student/parent navigation for portal sub-pages. */
(function () {
  "use strict";

  var views = [
    ["overview","🏠","Overview"],
    ["results","📊","Results"],
    ["fees","💵","Fees & Payments"],
    ["chat","💬","Chat"],
    ["notifications","🔔","Notifications"],
    ["notices","📣","Notices"],
    ["exams","🖊️","Exam Timetable"],
    ["classtt","🗓️","Class Timetable"],
    ["calendar","📅","Calendar"],
    ["attendance","📋","Attendance"],
    ["profile","👤","My Profile"],
    ["progress","📈","Progress Chart"],
    ["position","🏆","Class Position"],
    ["subjects","📚","My Subjects"],
    ["homework","📝","Homework"],
    ["health","🏥","Health Record"],
    ["library","📖","Library"],
    ["remarks","💬","Teacher Comments"],
    ["transport","🚌","Transport"],
    ["gallery","📷","School Gallery"],
    ["leave","📄","Leave Request"],
    ["quiz","📘","Quizzes"],
    ["appointment","📅","Appointments"],
    ["broadcasts","📢","School News"],
    ["prayer","🕌","Prayer Times"],
    ["settings","⚙️","Settings"]
  ];

  function close() {
    document.body.classList.remove("tut-portal-nav-open");
    var trigger = document.getElementById("tutPortalMenu");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function toggle() {
    var open = !document.body.classList.contains("tut-portal-nav-open");
    document.body.classList.toggle("tut-portal-nav-open", open);
    var trigger = document.getElementById("tutPortalMenu");
    if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function portalHref(view) { return "portal.html#" + view; }

  function mount() {
    if (document.body.classList.contains("tut-portal-navigation")) return;
    document.body.classList.add("tut-portal-navigation");

    var header = document.querySelector(".tut-top");
    if (header) {
      var trigger = document.createElement("button");
      trigger.type = "button";
      trigger.id = "tutPortalMenu";
      trigger.className = "tut-portal-menu";
      trigger.setAttribute("aria-label", "Open all portal sections");
      trigger.setAttribute("aria-expanded", "false");
      trigger.textContent = "☰";
      trigger.addEventListener("click", toggle);
      var back = header.querySelector(".tut-back");
      if (back && back.nextSibling) header.insertBefore(trigger, back.nextSibling);
      else header.insertBefore(trigger, header.firstChild);
    }

    var drawer = document.createElement("aside");
    drawer.className = "tut-portal-drawer";
    drawer.setAttribute("aria-label", "All student portal sections");
    drawer.innerHTML = '<div class="tut-portal-brand"><img src="images/LOGO.JPG" alt="School Logo"><div><b>Ameenullah Portal</b><small>Student & Parent</small></div></div>';
    views.forEach(function (item) {
      var link = document.createElement("a");
      link.className = "tut-portal-link";
      link.href = portalHref(item[0]);
      link.innerHTML = '<span class="ico" aria-hidden="true">' + item[1] + "</span>";
      var label = document.createElement("span");
      label.textContent = item[2];
      link.appendChild(label);
      drawer.appendChild(link);
    });
    var tutor = document.createElement("a");
    tutor.className = "tut-portal-link active";
    tutor.href = "student-ai-tutor.html";
    tutor.setAttribute("aria-current", "page");
    tutor.innerHTML = '<span class="ico" aria-hidden="true">🎓</span><span>AI Learning Tutor</span>';
    drawer.appendChild(tutor);

    var sep = document.createElement("div");
    sep.className = "tut-portal-sep";
    drawer.appendChild(sep);
    var website = document.createElement("a");
    website.className = "tut-portal-link";
    website.href = "index.html";
    website.innerHTML = '<span class="ico" aria-hidden="true">🌐</span><span>School Website</span>';
    drawer.appendChild(website);
    var logout = document.createElement("button");
    logout.type = "button";
    logout.className = "tut-portal-link";
    logout.innerHTML = '<span class="ico" aria-hidden="true">🚪</span><span>Logout</span>';
    logout.addEventListener("click", function () {
      logout.disabled = true;
      fetch("/portal/logout", { method:"POST", credentials:"same-origin" })
        .catch(function () {})
        .then(function () { location.href = "portal-login.html"; });
    });
    drawer.appendChild(logout);
    document.body.appendChild(drawer);

    var scrim = document.createElement("div");
    scrim.className = "tut-portal-scrim";
    scrim.addEventListener("click", close);
    document.body.appendChild(scrim);

    var quick = document.createElement("nav");
    quick.className = "tut-portal-quicknav";
    quick.setAttribute("aria-label", "Student portal quick links");
    [
      ["overview","🏠","Home"],
      ["results","📊","Results"],
      ["fees","💵","Fees"],
      ["chat","💬","Chat"],
      ["notifications","🔔","Alerts"]
    ].forEach(function (item) {
      var link = document.createElement("a");
      link.className = "tut-portal-qn";
      link.href = portalHref(item[0]);
      link.innerHTML = '<span class="ico" aria-hidden="true">' + item[1] + "</span><span>" + item[2] + "</span>";
      quick.appendChild(link);
    });
    var current = document.createElement("a");
    current.className = "tut-portal-qn active";
    current.href = "student-ai-tutor.html";
    current.setAttribute("aria-current", "page");
    current.innerHTML = '<span class="ico" aria-hidden="true">🎓</span><span>AI Tutor</span>';
    quick.appendChild(current);
    var menu = document.createElement("button");
    menu.type = "button";
    menu.className = "tut-portal-qn";
    menu.setAttribute("aria-label", "Open all portal sections");
    menu.innerHTML = '<span class="ico" aria-hidden="true">☰</span><span>Menu</span>';
    menu.addEventListener("click", toggle);
    quick.appendChild(menu);
    document.body.appendChild(quick);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
