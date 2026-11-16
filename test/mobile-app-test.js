/* ==========================================================================
   test/mobile-app-test.js
   End-to-end verification of the Ameenullah School Android App (Capacitor)
   project, config sync tooling, native WebView bridge, icons/splash assets,
   GitHub Actions APK/AAB workflow, and live server endpoints.
   ========================================================================== */
"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");

if (process.argv[2] === "--serve") return serve();

function serve() {
  const port = Number(process.argv[3]);
  process.env.PORT = String(port);
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "mobile-app-test-secret";
  process.env.DB_PASSWORD = "mobile-app-test-db";
  process.env.ADMIN_DEFAULT_PASSWORD = "testpassword123";

  const fakeDb = {
    query(sql, params, cb) {
      if (typeof params === "function") {
        cb = params;
      }
      if (cb) setImmediate(() => cb(null, []));
    }
  };
  const dbPath = fs.realpathSync(path.join(REPO, "db.js"));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
  require(path.join(REPO, "server.js"));
  setTimeout(() => console.log("READY " + port), 600);
}

let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) {
    passed++;
    console.log("  ok   - " + label);
  } else {
    failed++;
    console.error("  FAIL - " + label + (detail ? " (" + detail + ")" : ""));
  }
}

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = buf.subarray(0, 8).toString("hex");
  if (sig !== "89504e470d0a1a0a") return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

function httpGet(port, urlPath, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: urlPath, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function bootChildServer(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, "--serve", String(port)], {
      cwd: REPO,
      env: Object.assign({}, process.env, extraEnv),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) {
        child.kill();
        reject(new Error("Timed out waiting for server.js on port " + port));
      }
    }, 10000);
    child.stdout.on("data", (chunk) => {
      if (!ready && String(chunk).includes("READY " + port)) {
        ready = true;
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on("exit", (code) => {
      if (!ready) {
        clearTimeout(timer);
        reject(new Error("Child server exited early with code " + code));
      }
    });
  });
}

(async function main() {
  console.log("\n[1] Mobile App Config & Capacitor Sync");

  // Run sync-config.js with an env override first, then restore default
  execFileSync(process.execPath, [path.join(REPO, "mobile-app", "scripts", "sync-config.js")], {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      AMS_APP_SERVER_URL: "https://custom.ameenullah.edu.ng/",
      AMS_SKIP_CAP_COPY: "1"
    })
  });
  const overriddenCap = JSON.parse(fs.readFileSync(path.join(REPO, "capacitor.config.json"), "utf8"));
  check(
    "AMS_APP_SERVER_URL override adds custom domain to Capacitor allowNavigation",
    overriddenCap.server.allowNavigation.includes("custom.ameenullah.edu.ng")
  );

  // Restore default sync
  execFileSync("npm", ["run", "app:sync"], { cwd: REPO, stdio: "ignore" });

  const appCfg = JSON.parse(fs.readFileSync(path.join(REPO, "mobile-app", "app-config.json"), "utf8"));
  const capCfg = JSON.parse(fs.readFileSync(path.join(REPO, "capacitor.config.json"), "utf8"));
  const wwwAppCfgJs = fs.readFileSync(path.join(REPO, "mobile-app", "www", "app-config.js"), "utf8");

  check("appId is com.ameenullah.school", appCfg.appId === "com.ameenullah.school" && capCfg.appId === "com.ameenullah.school");
  check("primary serverUrl points to hosted live deployment", appCfg.serverUrl === "https://result-cfn8.onrender.com");
  check("www/app-config.js embeds primary & fallback server URLs", wwwAppCfgJs.includes("result-cfn8.onrender.com") && wwwAppCfgJs.includes("result-production-69ea.up.railway.app"));
  check("www/logo.jpg copied into mobile web bundle", fs.existsSync(path.join(REPO, "mobile-app", "www", "logo.jpg")));

  console.log("\n[2] Android Native Project, Icons, Splash Screens & CI Workflow");

  const manifestXml = fs.readFileSync(path.join(REPO, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  const buildGradle = fs.readFileSync(path.join(REPO, "android", "app", "build.gradle"), "utf8");
  const mainActivity = fs.readFileSync(
    path.join(REPO, "android", "app", "src", "main", "java", "com", "ameenullah", "school", "MainActivity.java"),
    "utf8"
  );
  const shortcutsXml = fs.readFileSync(path.join(REPO, "android", "app", "src", "main", "res", "xml", "shortcuts.xml"), "utf8");
  const workflowYml = fs.readFileSync(path.join(REPO, ".github", "workflows", "android-apk.yml"), "utf8");

  check("AndroidManifest declares INTERNET, CAMERA, FileProvider & app shortcuts",
    manifestXml.includes("android.permission.INTERNET") &&
    manifestXml.includes("android.permission.CAMERA") &&
    manifestXml.includes("androidx.core.content.FileProvider") &&
    manifestXml.includes("@xml/shortcuts")
  );
  check("shortcuts.xml defines Check Result, Parent Portal & Staff Login shortcuts",
    shortcutsXml.includes("/portal-login.html") &&
    shortcutsXml.includes("/portal.html") &&
    shortcutsXml.includes("/login.html")
  );
  check("app/build.gradle sets Java 21 & always signs release APK",
    buildGradle.includes("JavaVersion.VERSION_21") &&
    buildGradle.includes("signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug")
  );
  check("MainActivity implements native blob/PDF downloads, A4 PrintManager & Back navigation",
    mainActivity.includes("saveBase64File") &&
    mainActivity.includes("PrintAttributes.MediaSize.ISO_A4") &&
    mainActivity.includes("getOnBackPressedDispatcher()") &&
    mainActivity.includes("AmeenullahAndroidApp/1.0")
  );
  check("MainActivity flushes the login session cookie on pause AND destroy (stay logged in)",
    mainActivity.includes("CookieManager.getInstance().flush()") &&
    mainActivity.includes("protected void onDestroy()")
  );
  check("MainActivity downloads via MediaStore on Android 10+ (no legacy permission-denied path)",
    mainActivity.includes("setDestinationUri") &&
    mainActivity.includes("MediaStore.Downloads") &&
    mainActivity.includes("IS_PENDING") &&
    mainActivity.includes("ACTION_DOWNLOAD_COMPLETE")
  );

  const mipmaps = [
    ["mipmap-mdpi", 48, 108],
    ["mipmap-hdpi", 72, 162],
    ["mipmap-xhdpi", 96, 216],
    ["mipmap-xxhdpi", 144, 324],
    ["mipmap-xxxhdpi", 192, 432]
  ];
  for (const [dir, legSize, fgSize] of mipmaps) {
    const legDim = readPngDimensions(path.join(REPO, "android", "app", "src", "main", "res", dir, "ic_launcher.png"));
    const rndDim = readPngDimensions(path.join(REPO, "android", "app", "src", "main", "res", dir, "ic_launcher_round.png"));
    const fgDim = readPngDimensions(path.join(REPO, "android", "app", "src", "main", "res", dir, "ic_launcher_foreground.png"));
    check(
      `${dir} launcher icons are valid PNGs (${legSize}px / ${fgSize}px)`,
      legDim && legDim.width === legSize && rndDim && rndDim.width === legSize && fgDim && fgDim.width === fgSize
    );
  }

  const splashDim = readPngDimensions(path.join(REPO, "android", "app", "src", "main", "res", "drawable-port-xhdpi", "splash.png"));
  check("splash screen PNG generated at portrait xhdpi (720x1280)", splashDim && splashDim.width === 720 && splashDim.height === 1280);

  check("GitHub Actions workflow builds APK + Play Store AAB with JDK 21 and publishes release",
    workflowYml.includes("java-version: \"21\"") &&
    workflowYml.includes("./gradlew assembleRelease bundleRelease") &&
    workflowYml.includes("Ameenullah-School.apk") &&
    workflowYml.includes("Ameenullah-School.aab")
  );

  console.log("\n[3] Live Express Server App Endpoints & Website Integration");

  const port = 14890 + Math.floor(Math.random() * 400);
  const child = await bootChildServer(port);
  try {
    const corsPreflight = await httpGet(port, "/api/app-config", {}, "OPTIONS");
    check("OPTIONS /api/app-config answers 204 with CORS allow-origin *",
      corsPreflight.status === 204 && corsPreflight.headers["access-control-allow-origin"] === "*"
    );

    const cfgRes = await httpGet(port, "/api/app-config");
    const cfgJson = JSON.parse(cfgRes.body);
    check("GET /api/app-config answers 200 JSON with appId & apkDownloadUrl",
      cfgRes.status === 200 &&
      cfgRes.headers["access-control-allow-origin"] === "*" &&
      cfgJson.ok === true &&
      cfgJson.appId === "com.ameenullah.school" &&
      cfgJson.apkDownloadUrl === "/download/app.apk"
    );

    const csrfRes = await httpGet(port, "/api/csrf-token");
    const setCookie = csrfRes.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie || "");
    const expiresMatch = /Expires=([^;]+)/i.exec(cookieStr);
    const expiresMs = expiresMatch ? Date.parse(expiresMatch[1]) : NaN;
    const daysOut = Number.isFinite(expiresMs) ? (expiresMs - Date.now()) / (1000 * 60 * 60 * 24) : NaN;
    check("Session cookie lasts 30 days (stay logged in across app restarts)",
      csrfRes.status === 200 &&
      Number.isFinite(daysOut) && daysOut > 29 && daysOut < 31 &&
      /SameSite=Lax/i.test(cookieStr)
    );

    const apkRes = await httpGet(port, "/download/app.apk");
    check("GET /download/app.apk redirects (302) to latest GitHub Release APK",
      apkRes.status === 302 &&
      apkRes.headers.location === "https://github.com/belloluqman2007-hue/Result/releases/latest/download/Ameenullah-School.apk"
    );

    const homeRes = await httpGet(port, "/", { accept: "text/html" });
    check("Home page includes Download Android App CTA button",
      homeRes.status === 200 &&
      homeRes.body.includes('id="wb2DownloadAppBtn"') &&
      homeRes.body.includes('href="/download/app.apk"')
    );

    const browserSecondary = await httpGet(port, "/", {
      host: "result-production-69ea.up.railway.app",
      accept: "text/html",
      "user-agent": "Mozilla/5.0 Chrome/130.0"
    });
    check("Regular browser on secondary host still gets 301 canonical redirect",
      browserSecondary.status === 301 &&
      browserSecondary.headers.location === "https://result-cfn8.onrender.com/"
    );

    const appSecondary = await httpGet(port, "/", {
      host: "result-production-69ea.up.railway.app",
      accept: "text/html",
      "user-agent": "Mozilla/5.0 Android WebView AmeenullahAndroidApp/1.0"
    });
    check("Android app failover to secondary host answers 200 directly without redirect loop",
      appSecondary.status === 200
    );
  } finally {
    child.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
