// The app's icons, every size, from build/icon.svg: build/icon.icns for the Mac (iconutil, so on a Mac),
// build/icons/NxN.png for Linux (scripts/package-linux.ts installs them under hicolor, named after the app), and
// assets/icon.png for the window itself. Run it after changing the SVG, and commit what it makes:
//
//   bun desktop/scripts/icons.ts
//
// Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DESKTOP = resolve(import.meta.dir, "..");
const svg = readFileSync(join(DESKTOP, "build", "icon.svg"), "utf8");

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  return page.screenshot({ omitBackground: true, type: "png" });
}

// Linux: the sizes hicolor has, and the window's own.
mkdirSync(join(DESKTOP, "build", "icons"), { recursive: true });
for (const n of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(join(DESKTOP, "build", "icons", `${n}x${n}.png`), await png(n));
writeFileSync(join(DESKTOP, "assets", "icon.png"), await png(512));

// The Mac: an iconset (each size and its @2x), packed by iconutil.
if (process.platform === "darwin") {
  const dir = join(mkdtempSync(join(tmpdir(), "kiwi-icon-")), "icon.iconset");
  mkdirSync(dir);
  for (const n of [16, 32, 128, 256, 512]) {
    writeFileSync(join(dir, `icon_${n}x${n}.png`), await png(n));
    writeFileSync(join(dir, `icon_${n}x${n}@2x.png`), await png(n * 2));
  }
  execFileSync("iconutil", ["-c", "icns", dir, "-o", join(DESKTOP, "build", "icon.icns")]);
  rmSync(resolve(dir, ".."), { recursive: true, force: true });
} else console.warn("not a Mac: build/icon.icns left as it was (iconutil makes it)");

await browser.close();
