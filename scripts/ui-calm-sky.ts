#!/usr/bin/env bun
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

if (process.argv.includes("--help")) {
  console.log(`The Calm sky (T4204), Jow's loop, in a bare page. It checks that the loop plays and wraps at its end, pauses while the
window is hidden and plays again when shown, shows only its still frame with reduced motion, and leaves nothing behind
when unmounted. An engine that can't play the video must still show the still frame, never a blank.

  bun scripts/ui-calm-sky.ts [--chromium] [--shot=sky.png]`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const ENGINE = process.argv.includes("--chromium") ? "chromium" : "webkit";
const SHOT = process.argv.find((a) => a.startsWith("--shot="))?.slice(7);

const dir = mkdtempSync(join(tmpdir(), "kiwi-calm-sky-"));
const entry = join(ROOT, "ui/src/calm/sky.page.tsx");
const out = join(dir, "out");
const built = await Bun.build({ entrypoints: [entry], outdir: out, minify: true, target: "browser", loader: { ".mp4": "file", ".jpg": "file" }, publicPath: "/" });
if (!built.success) throw new Error(built.logs.join("\n"));
const script = built.outputs.find((o) => o.kind === "entry-point")!.path.slice(out.length + 1);
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}#box{position:fixed;inset:0}</style><div id="box"></div><script type="module" src="/${script}"></script>`;
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (req) => {
    const path = new URL(req.url).pathname;
    return path === "/" ? new Response(html, { headers: { "content-type": "text/html" } }) : new Response(Bun.file(join(out, path)));
  },
});

interface Sky {
  mount(): void;
  unmount(): void;
  hide(hidden: boolean): void;
}
declare const sky: Sky;

const failures: string[] = [];
const check = (ok: boolean, said: string): void => {
  console.log(`${ok ? "✓" : "✗"} ${said}`);
  if (!ok) failures.push(said);
};
const at = (page: Page) => page.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const paused = (page: Page) => page.evaluate(() => document.querySelector("video")?.paused ?? true);

const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForFunction(() => "sky" in window);
  await page.evaluate(() => sky.mount());
  await page.waitForSelector(".calm-sky video");
  const playing = await page
    .waitForFunction(() => (document.querySelector("video")?.currentTime ?? 0) > 0.3, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const still = await page.evaluate(() => getComputedStyle(document.querySelector(".calm-sky")!).backgroundImage.includes("idle-still"));
  check(playing || still, playing ? `${ENGINE} plays the loop` : `${ENGINE} can't play the loop here, and shows its still frame instead of a blank`);
  if (SHOT) await page.screenshot({ path: SHOT });
  if (playing) {
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const v = document.querySelector("video")!;
          const w = window as unknown as { wrapped: boolean };
          w.wrapped = false;
          let last = 0;
          v.addEventListener("timeupdate", () => {
            if (v.currentTime < last - 1) w.wrapped = true;
            last = v.currentTime;
          });
          v.addEventListener("seeked", () => done(), { once: true });
          v.currentTime = Math.max(0, Math.floor((v.duration - 1.5) / 2) * 2);
        }),
    );
    const wrapped = await page
      .waitForFunction(() => (window as unknown as { wrapped: boolean }).wrapped, null, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check(wrapped, `the loop wraps at its end (${(await at(page)).toFixed(2)} s after it)`);
    await page.evaluate(() => sky.hide(true));
    await page.waitForTimeout(300);
    const hiddenAt = await at(page);
    await page.waitForTimeout(700);
    const stood = (await paused(page)) && (await at(page)) === hiddenAt;
    await page.evaluate(() => sky.hide(false));
    const resumed = await page
      .waitForFunction((t) => (document.querySelector("video")?.currentTime ?? 0) > t + 0.2, hiddenAt, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check(stood && resumed, `hidden, it holds still at ${hiddenAt.toFixed(2)} s, and plays again when shown`);
  }
  await page.evaluate(() => sky.unmount());
  check(await page.evaluate(() => !document.querySelector("video") && !document.querySelector(".calm-sky")), "unmounted, it leaves no video behind");
  await page.close();

  const calm = await browser.newPage({ viewport: { width: 1512, height: 982 }, reducedMotion: "reduce" });
  calm.on("pageerror", (e) => errors.push(e.message));
  await calm.goto(`http://127.0.0.1:${server.port}/`);
  await calm.waitForFunction(() => "sky" in window);
  await calm.evaluate(() => sky.mount());
  await calm.waitForSelector(".calm-sky");
  const calmStill = await calm.evaluate(() => !document.querySelector("video") && getComputedStyle(document.querySelector(".calm-sky")!).backgroundImage.includes("idle-still"));
  check(calmStill, "reduced motion: the still frame, no video");
  await calm.close();
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} finally {
  await browser.close();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`the Calm sky failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("the Calm sky plays Jow's loop, pauses while hidden, holds still for reduced motion and cleans up");
