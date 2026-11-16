#!/usr/bin/env node
"use strict";

/**
 * Generates branded Android launcher icons (standard, round, adaptive foreground)
 * and splash screens across all Android DPI buckets from images/LOGO.JPG.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC_LOGO = path.join(ROOT, "images", "LOGO.JPG");
const RES_DIR = path.join(ROOT, "android", "app", "src", "main", "res");

if (!fs.existsSync(SRC_LOGO)) {
  console.error("Missing images/LOGO.JPG");
  process.exit(1);
}

const MIPMAP_SPECS = [
  { dir: "mipmap-mdpi", legacy: 48, fg: 108 },
  { dir: "mipmap-hdpi", legacy: 72, fg: 162 },
  { dir: "mipmap-xhdpi", legacy: 96, fg: 216 },
  { dir: "mipmap-xxhdpi", legacy: 144, fg: 324 },
  { dir: "mipmap-xxxhdpi", legacy: 192, fg: 432 }
];

for (const spec of MIPMAP_SPECS) {
  const outDir = path.join(RES_DIR, spec.dir);
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Legacy square rounded-corner icon (ic_launcher.png)
  const legacyInner = Math.round(spec.legacy * 0.84);
  execFileSync("convert", [
    SRC_LOGO,
    "-resize", `${legacyInner}x${legacyInner}`,
    "-background", "#FFFFFF",
    "-gravity", "center",
    "-extent", `${spec.legacy}x${spec.legacy}`,
    path.join(outDir, "ic_launcher.png")
  ]);

  // 2. Round launcher icon (ic_launcher_round.png) — circular mask on white medallion with emerald ring
  const rSize = spec.legacy;
  const rHalf = (rSize - 1) / 2;
  const rInner = Math.round(rSize * 0.78);
  execFileSync("convert", [
    "(",
      SRC_LOGO,
      "-resize", `${rInner}x${rInner}`,
      "-background", "#FFFFFF",
      "-gravity", "center",
      "-extent", `${rSize}x${rSize}`,
    ")",
    "(",
      "-size", `${rSize}x${rSize}`,
      "xc:none",
      "-fill", "white",
      "-draw", `circle ${rHalf},${rHalf} ${rHalf},0.5`,
    ")",
    "-alpha", "off",
    "-compose", "CopyOpacity",
    "-composite",
    path.join(outDir, "ic_launcher_round.png")
  ]);

  // 3. Adaptive foreground (ic_launcher_foreground.png) — fits comfortably inside Android's 66/108 safe zone
  const fgInner = Math.round(spec.fg * 0.60);
  execFileSync("convert", [
    SRC_LOGO,
    "-resize", `${fgInner}x${fgInner}`,
    "-background", "#FFFFFF",
    "-gravity", "center",
    "-extent", `${spec.fg}x${spec.fg}`,
    path.join(outDir, "ic_launcher_foreground.png")
  ]);
}

// Splash screens: deep emerald #0B2E22 canvas with centered circular white medallion holding the school crest
const SPLASH_SPECS = [
  { dir: "drawable", w: 480, h: 800, badge: 168 },
  { dir: "drawable-port-mdpi", w: 320, h: 480, badge: 120 },
  { dir: "drawable-port-hdpi", w: 480, h: 800, badge: 168 },
  { dir: "drawable-port-xhdpi", w: 720, h: 1280, badge: 232 },
  { dir: "drawable-port-xxhdpi", w: 960, h: 1600, badge: 300 },
  { dir: "drawable-port-xxxhdpi", w: 1280, h: 1920, badge: 372 },
  { dir: "drawable-land-mdpi", w: 480, h: 320, badge: 112 },
  { dir: "drawable-land-hdpi", w: 800, h: 480, badge: 160 },
  { dir: "drawable-land-xhdpi", w: 1280, h: 720, badge: 220 },
  { dir: "drawable-land-xxhdpi", w: 1600, h: 960, badge: 280 },
  { dir: "drawable-land-xxxhdpi", w: 1920, h: 1280, badge: 340 }
];

for (const s of SPLASH_SPECS) {
  const outDir = path.join(RES_DIR, s.dir);
  fs.mkdirSync(outDir, { recursive: true });
  const c = (s.badge - 1) / 2;
  const logoSize = Math.round(s.badge * 0.82);

  execFileSync("convert", [
    "-size", `${s.w}x${s.h}`,
    "xc:#0B2E22",
    "(",
      "(",
        SRC_LOGO,
        "-resize", `${logoSize}x${logoSize}`,
        "-background", "#FFFFFF",
        "-gravity", "center",
        "-extent", `${s.badge}x${s.badge}`,
      ")",
      "(",
        "-size", `${s.badge}x${s.badge}`,
        "xc:none",
        "-fill", "white",
        "-draw", `circle ${c},${c} ${c},1`,
      ")",
      "-alpha", "off",
      "-compose", "CopyOpacity",
      "-composite",
    ")",
    "-gravity", "center",
    "-compose", "Over",
    "-composite",
    path.join(outDir, "splash.png")
  ]);
}

console.log("[mobile-app] Generated Android launcher icons and splash screens across all densities.");
