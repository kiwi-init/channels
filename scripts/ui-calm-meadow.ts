#!/usr/bin/env bun
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";

if (process.argv.includes("--help")) {
  console.log(`The Calm meadow (#5411), the idle screen's scene, in a bare page. It checks that the meadow draws and moves, that its
light follows the clock (noon is bright, 2 am is dark), that it stops drawing while the window is hidden and draws again
when shown, that reduced motion gets one still frame and no animation, and that closing and opening it again reuses the
same renderer instead of a new one per open. A machine that can't hold 24 fps gets one still frame instead of the
animation. An engine with neither WebGPU nor WebGL 2 must leave no page errors.

  bun scripts/ui-calm-meadow.ts [--chromium] [--shot=meadow.png]`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const ENGINE = process.argv.includes("--chromium") ? "chromium" : "webkit";
const SHOT = process.argv.find((a) => a.startsWith("--shot="))?.slice(7);

const dir = mkdtempSync(join(tmpdir(), "kiwi-calm-meadow-"));
const out = join(dir, "out");
const built = await Bun.build({
  entrypoints: [join(ROOT, "ui/src/start/meadow.page.ts")],
  outdir: out,
  minify: true,
  target: "browser",
  publicPath: "/",
});
if (!built.success) throw new Error(built.logs.join("\n"));
const script = built.outputs.find((o) => o.kind === "entry-point")!.path.slice(out.length + 1);
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#6f8256}#box{position:fixed;inset:0}</style><div id="box"></div><script type="module" src="/${script}"></script>`;
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (req) => {
    const path = new URL(req.url).pathname;
    return path === "/" ? new Response(html, { headers: { "content-type": "text/html" } }) : new Response(Bun.file(join(out, path)));
  },
});

interface MeadowPage {
  start(still: boolean): Promise<boolean>;
  stop(): void;
  hide(hidden: boolean): void;
}
declare const meadow: MeadowPage;

const failures: string[] = [];
const check = (ok: boolean, said: string): void => {
  console.log(`${ok ? "✓" : "✗"} ${said}`);
  if (!ok) failures.push(said);
};

const mode = (page: Page): Promise<string> => page.evaluate(() => document.querySelector("canvas")?.dataset.meadow ?? "none");
const frame = (page: Page): Promise<Buffer> => page.screenshot({ clip: { x: 0, y: 0, width: 640, height: 400 } });
const same = (a: Buffer, b: Buffer): boolean => a.equals(b);

const brightness = (page: Page, png: Buffer): Promise<{ sky: number; spread: number }> =>
  page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, Math.floor(c.height * 0.3)).data;
    let sum = 0;
    let sq = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
      sum += l;
      sq += l * l;
    }
    const mean = sum / n;
    return { sky: mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  }, png.toString("base64"));

const open = async (browser: Browser, at: string, still: boolean, errors: string[]): Promise<{ page: Page; drew: boolean }> => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, timezoneId: "UTC", reducedMotion: still ? "reduce" : "no-preference" });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(at));
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForFunction(() => "meadow" in window);
  const drew = await page.evaluate((s) => meadow.start(s), still);
  if (drew) await page.waitForTimeout(2500);
  return { page, drew };
};

const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const errors: string[] = [];
try {
  const { page: noon, drew } = await open(browser, "2026-06-21T12:00:00Z", false, errors);
  if (!drew) {
    check(true, `${ENGINE} has neither WebGPU nor WebGL 2 here: the haze stays behind the panel`);
  } else {
    const a = await frame(noon);
    if (SHOT) await noon.screenshot({ path: SHOT });
    const day = await brightness(noon, a);
    check(day.spread > 2, `the meadow isn't a blank fill (spread ${day.spread.toFixed(1)})`);
    const how = await mode(noon);
    if (how === "slow") {
      await noon.waitForTimeout(700);
      check(same(a, await frame(noon)), `${ENGINE} here can't hold 24 fps, so the meadow holds one still frame instead of loading the machine`);
    } else {
      await noon.waitForTimeout(300);
      check(how === "moving" && !same(a, await frame(noon)), `${ENGINE} draws the meadow and it moves (${how})`);
      await noon.evaluate(() => meadow.hide(true));
      await noon.waitForTimeout(300);
      const h1 = await frame(noon);
      await noon.waitForTimeout(700);
      const h2 = await frame(noon);
      await noon.evaluate(() => meadow.hide(false));
      await noon.waitForTimeout(400);
      const h3 = await frame(noon);
      check(same(h1, h2) && !same(h2, h3), `hidden, it stops drawing${same(h1, h2) ? "" : " (it didn't)"}, and draws again when shown${same(h2, h3) ? " (it didn't)" : ""}`);
    }

    const canvas = await noon.evaluate(() => {
      const c = document.querySelector("canvas");
      Object.assign(window, { firstCanvas: c });
      return c !== null;
    });
    await noon.evaluate(() => meadow.stop());
    const gone = await noon.evaluate(() => document.querySelector("canvas") === null);
    await noon.evaluate(() => meadow.start(false));
    const reused = await noon.evaluate(() => document.querySelector("canvas") === (window as unknown as { firstCanvas: HTMLCanvasElement }).firstCanvas);
    check(canvas && gone && reused, `closed, it leaves no canvas behind${gone ? "" : " (it did)"}; opened again, it reuses the same renderer${reused ? "" : " (it made a new one)"}`);

    const { page: night } = await open(browser, "2026-06-21T02:00:00Z", false, errors);
    const dark = await brightness(night, await frame(night));
    check(dark.sky < day.sky * 0.6, `the light follows the clock: the sky at 2 am (${dark.sky.toFixed(0)}) is far darker than at noon (${day.sky.toFixed(0)})`);
    await night.close();

    const { page: still } = await open(browser, "2026-06-21T12:00:00Z", true, errors);
    const s1 = await frame(still);
    await still.waitForTimeout(800);
    const s2 = await frame(still);
    const s = await brightness(still, s1);
    const stillHow = await mode(still);
    check(
      stillHow !== "moving" && same(s1, s2) && s.spread > 2,
      `reduced motion: one still frame of the meadow (${stillHow})${same(s1, s2) ? "" : ", but it kept moving"}${s.spread > 2 ? "" : ", but it's blank"}`,
    );
    await still.close();
  }
  await noon.close();
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} finally {
  await browser.close();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`the Calm meadow failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("the Calm meadow draws and moves, follows the clock, rests while hidden, holds still for reduced motion and reuses its renderer");
