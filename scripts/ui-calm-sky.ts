#!/usr/bin/env bun
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

if (process.argv.includes("--help")) {
  console.log(`The Calm sky (T4204) in a bare page: it checks the clouds draw with contrast, drift, hold still for reduced motion,
pause while the window is hidden, change nothing in the DOM per frame, and free their GL context on stop. Then it prints
frame times: the rAF interval and each frame's GPU cost (draw + gl.finish), p50 and p99, at a MacBook Pro 14" size, 2x.
The times are printed, never gated (Jow #850).

  bun scripts/ui-calm-sky.ts [--chromium] [--seconds=6] [--width=1512] [--height=982] [--shot=sky.png]`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const ENGINE = process.argv.includes("--chromium") ? "chromium" : "webkit";
const arg = (name: string, fallback: number): number => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback);
const SECONDS = arg("seconds", 6);
const WIDTH = arg("width", 1512);
const HEIGHT = arg("height", 982);
const SHOT = process.argv.find((a) => a.startsWith("--shot="))?.slice(7);

const dir = mkdtempSync(join(tmpdir(), "kiwi-calm-sky-"));
const entry = join(dir, "entry.ts");
writeFileSync(
  entry,
  `import { startClouds, type Clouds } from ${JSON.stringify(join(ROOT, "ui/src/calm/clouds.ts"))}
let canvas = document.querySelector("canvas")!
const copy = document.createElement("canvas")
let clouds: Clouds | null = null
const state = { frames: 0, costs: [] as number[], sample: null as number[] | null, want: false }
const grab = () => {
  copy.width = 96
  copy.height = 64
  const ctx = copy.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(canvas, 0, 0, 96, 64)
  const px = ctx.getImageData(0, 0, 96, 64).data
  const out: number[] = []
  for (let i = 0; i < px.length; i += 4) out.push(px[i]!)
  return out
}
Object.assign(window, {
  sky: {
    state,
    start(still: boolean, timed: boolean) {
      clouds?.stop()
      const fresh = document.createElement("canvas")
      canvas.replaceWith(fresh)
      canvas = fresh
      state.frames = 0
      state.costs = []
      clouds = startClouds(canvas, {
        still,
        seed: 1200,
        measure(ms) {
          state.frames++
          if (timed) state.costs.push(ms)
          if (state.want) {
            state.sample = grab()
            state.want = false
          }
        },
      })
      return !!clouds
    },
    stop() {
      clouds?.stop()
      clouds = null
    },
    lost() {
      return (canvas.getContext("webgl2") as WebGL2RenderingContext | null)?.isContextLost() ?? true
    },
    hide(hidden: boolean) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
      document.dispatchEvent(new Event("visibilitychange"))
    },
  },
})
`,
);
const built = await Bun.build({ entrypoints: [entry], minify: true, target: "browser" });
if (!built.success) throw new Error(built.logs.join("\n"));
const script = await built.outputs[0]!.text();
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}canvas{position:fixed;inset:0;width:100%;height:100%;display:block}</style><canvas></canvas><script type="module">${script.replaceAll("</script", "<\\/script")}</script>`;
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(html, { headers: { "content-type": "text/html" } }) });

interface Sky {
  state: { frames: number; costs: number[]; sample: number[] | null; want: boolean };
  start(still: boolean, timed: boolean): boolean;
  stop(): void;
  lost(): boolean;
  hide(hidden: boolean): void;
}
declare const sky: Sky;

const sample = async (page: Page): Promise<number[]> => {
  await page.evaluate(() => {
    sky.state.sample = null;
    sky.state.want = true;
  });
  await page.waitForFunction(() => sky.state.sample !== null, null, { timeout: 5000 });
  return page.evaluate(() => sky.state.sample ?? []);
};
const frames = (page: Page): Promise<number> => page.evaluate(() => sky.state.frames);
const spread = (px: number[]): { low: number; high: number; sd: number } => {
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  const sorted = [...px].sort((a, b) => a - b);
  return { low: sorted[Math.floor(px.length * 0.02)]!, high: sorted[Math.floor(px.length * 0.98)]!, sd: Math.sqrt(px.reduce((a, b) => a + (b - mean) ** 2, 0) / px.length) };
};
const moved = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + Math.abs(v - (b[i] ?? 0)), 0) / a.length;
const pct = (xs: number[], p: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN;
};

const failures: string[] = [];
const check = (ok: boolean, said: string): void => {
  console.log(`${ok ? "✓" : "✗"} ${said}`);
  if (!ok) failures.push(said);
};

const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForFunction(() => "sky" in window);

  const started = await page.evaluate(() => sky.start(false, false));
  check(started, `${ENGINE}: WebGL2 sky starts`);
  if (!started) throw new Error("no WebGL2");
  const first = await sample(page);
  const look = spread(first);
  check(look.high - look.low >= 40 && look.sd >= 8 && look.high <= 245, `clouds draw with contrast: 2–98% luminance ${look.low}–${look.high}, sd ${look.sd.toFixed(1)}`);
  await page.waitForTimeout(1500);
  const drift = moved(first, await sample(page));
  check(drift > 0.05, `the sky drifts: ${drift.toFixed(2)} mean change in 1.5 s`);

  const mutations = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        let n = 0;
        const watch = new MutationObserver((list) => (n += list.length));
        watch.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        setTimeout(() => {
          watch.disconnect();
          done(n);
        }, 1000);
      }),
  );
  check(mutations === 0, `nothing in the DOM changes per frame: ${mutations} mutations in 1 s`);

  await page.evaluate(() => sky.hide(true));
  const hiddenAt = await frames(page);
  await page.waitForTimeout(600);
  const whileHidden = (await frames(page)) - hiddenAt;
  await page.evaluate(() => sky.hide(false));
  await page.waitForTimeout(400);
  const back = (await frames(page)) - hiddenAt - whileHidden;
  check(whileHidden === 0 && back > 3, `hidden, it draws nothing (${whileHidden} frames in 600 ms) and resumes when shown (${back} frames)`);

  await page.evaluate(() => sky.stop());
  const stoppedAt = await frames(page);
  await page.waitForTimeout(400);
  const after = (await frames(page)) - stoppedAt;
  check(after === 0 && (await page.evaluate(() => sky.lost())), `stopped, it draws no more frames (${after}) and lets go of its GL context`);

  await page.close();
  const still = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await still.goto(`http://127.0.0.1:${server.port}/`);
  await still.waitForFunction(() => "sky" in window);
  await still.evaluate(() => sky.start(true, false));
  await still.waitForTimeout(300);
  const stillAt = await frames(still);
  await still.waitForTimeout(1000);
  const stillFrames = (await frames(still)) - stillAt;
  check(stillFrames === 0, `reduced motion: a still sky, ${stillFrames} frames drawn in 1 s`);
  await still.evaluate(() => sky.stop());
  await still.close();

  const timed = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
  await timed.goto(`http://127.0.0.1:${server.port}/`);
  await timed.waitForFunction(() => "sky" in window);
  const gaps = await timed.evaluate(
    (ms) =>
      new Promise<number[]>((done) => {
        sky.start(false, false);
        const out: number[] = [];
        let last = 0;
        const end = performance.now() + ms;
        const step = (now: number) => {
          if (last) out.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(step);
          else done(out);
        };
        requestAnimationFrame(step);
      }),
    (SECONDS * 1000) / 2,
  );
  await timed.evaluate(() => sky.start(false, true));
  await timed.waitForTimeout((SECONDS * 1000) / 2);
  const costs = await timed.evaluate(() => sky.state.costs.slice(5));
  const size = await timed.evaluate(() => {
    const c = document.querySelector("canvas")!;
    return `${c.width}x${c.height}`;
  });
  if (SHOT) await timed.screenshot({ path: SHOT });
  await timed.evaluate(() => sky.stop());
  console.log(`  ${ENGINE} ${WIDTH}x${HEIGHT}@2x, drawn at ${size}: rAF interval p50 ${pct(gaps, 0.5).toFixed(2)} ms, p99 ${pct(gaps, 0.99).toFixed(2)} ms (${gaps.length} frames)`);
  console.log(`  frame cost (draw + gl.finish) p50 ${pct(costs, 0.5).toFixed(2)} ms, p99 ${pct(costs, 0.99).toFixed(2)} ms (${costs.length} frames); 120 Hz needs ≤ 8.3 ms`);
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
console.log("the Calm sky draws, drifts, holds still for reduced motion, pauses while hidden and frees its context");
