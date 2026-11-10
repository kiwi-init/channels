import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DESKTOP = resolve(import.meta.dir, "..");
const BUILD = join(DESKTOP, "build");
const ICON = join(BUILD, "channels.icon");
const ICTOOL = process.env.ICTOOL ?? "/Applications/Icon Composer.app/Contents/Executables/ictool";
const MAC_BODY = 824 / 1024;
const BREEZE_DARK_SIZES = [16, 22, 32, 256];

if (process.platform !== "darwin") throw new Error("icons.ts runs on a Mac: Icon Composer's ictool renders build/channels.icon, iconutil and actool pack it");
if (!existsSync(ICTOOL)) throw new Error(`no ictool at ${ICTOOL}: install Icon Composer, or point ICTOOL at its Contents/Executables/ictool`);

const work = mkdtempSync(join(tmpdir(), "kiwi-icon-"));
const rendition = (name: "Default" | "Dark"): string => {
  const file = join(work, `${name}.png`);
  execFileSync(ICTOOL, [ICON, "--export-image", "--output-file", file, "--platform", "macOS", "--rendition", name, "--width", "1024", "--height", "1024", "--scale", "1"], { stdio: "inherit" });
  return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
};
const composed = rendition("Default");
const composedDark = rendition("Dark");

const browser = await chromium.launch();
const page = await browser.newPage();
async function shot(size: number, html: string): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent;width:${size}px;height:${size}px;display:grid;place-items:center}svg,img{display:block}</style>${html}`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  return page.screenshot({ omitBackground: true, type: "png" });
}
const app = (size: number, source = composed) => {
  const body = Math.round(size * MAC_BODY);
  return shot(size, `<img src="${source}" width="${body}" height="${body}">`);
};
async function mark(size: number, file: string): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${readFileSync(join(BUILD, file), "utf8")}`);
  return page.screenshot({ omitBackground: true, type: "png" });
}

mkdirSync(join(BUILD, "icons"), { recursive: true });
for (const n of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(join(BUILD, "icons", `${n}x${n}.png`), await app(n));
mkdirSync(join(BUILD, "icons-dark"), { recursive: true });
for (const n of BREEZE_DARK_SIZES) writeFileSync(join(BUILD, "icons-dark", `${n}x${n}.png`), await app(n, composedDark));
copyFileSync(join(BUILD, "tray.svg"), join(DESKTOP, "assets", "channels-tray-symbolic.svg"));
writeFileSync(join(DESKTOP, "assets", "trayTemplate@2x.png"), await mark(32, "tray.svg"));
writeFileSync(join(DESKTOP, "assets", "trayUnreadTemplate@2x.png"), await mark(32, "tray-unread.svg"));

const iconset = join(work, "icon.iconset");
mkdirSync(iconset);
for (const n of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${n}x${n}.png`), await app(n));
  writeFileSync(join(iconset, `icon_${n}x${n}@2x.png`), await app(n * 2));
}
await browser.close();
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(BUILD, "icon.icns")]);

const car = join(work, "car");
mkdirSync(car);
execFileSync(
  "xcrun",
  [
    "actool",
    ICON,
    "--compile",
    car,
    "--app-icon",
    "channels",
    "--include-all-app-icons",
    "--platform",
    "macosx",
    "--target-device",
    "mac",
    "--minimum-deployment-target",
    "12.0",
    "--output-partial-info-plist",
    join(car, "partial.plist"),
  ],
  { stdio: "inherit" },
);
copyFileSync(join(car, "Assets.car"), join(BUILD, "Assets.car"));
rmSync(work, { recursive: true, force: true });
console.log("icons.ts: build/icons/NxN.png, build/icons-dark/NxN.png, build/icon.icns, build/Assets.car and the tray marks are made from build/channels.icon");
