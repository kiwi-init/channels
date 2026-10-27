import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

if (process.argv.includes("--help")) {
  console.log(`Frame times while the new UI's conversation scrolls: the long-feed demo shot (1500 messages in #general) at 1440x900@2x,
scrolled up and down by script every frame (a trackpad pace, then a fling), PERF_RUNS times (3). Reports the frame interval and the
main-thread work per frame (p50/p95/max), frames over 25 ms, content that jumped on screen while scrolling, long tasks where the
engine has them, how long the feed takes to show, and the frames after sending a message at the bottom and while scrolled up.

  bun scripts/ui-scroll-fps.ts [--browser webkit|chromium] [--dist ui/dist] [--theme dark|light] [--css try.css] [--json out.json] [--check]

Without --dist it builds ui/ into a temporary folder first. --css adds a stylesheet before measuring, to try a change without
a rebuild. --check fails when the page throws, renders the whole history at once, or the content jumps while scrolling; it
never fails on timings. WebKit is the engine of the Mac and Linux apps: bunx playwright-core install webkit.`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const theme = flag("--theme") ?? "dark";
const out = flag("--json");
const css = flag("--css");
const check = process.argv.includes("--check");

const scratch = mkdtempSync(join(tmpdir(), "kiwi-ui-scroll-"));
let dist = flag("--dist") ? resolve(flag("--dist") ?? "") : "";
if (!dist) {
  dist = join(scratch, "dist");
  const built = spawnSync("bunx", ["vite", "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "warn"], { cwd: join(ROOT, "ui"), stdio: "inherit" });
  if (built.status !== 0) throw new Error("vite build failed");
}
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}`);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

interface Frames {
  intervals: number[];
  work: number[];
  long: number[];
  jumps: number[];
}

interface Stats {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  fps: number;
  slow: number;
  workP50: number;
  workP95: number;
  workMax: number;
  longTasks: number | null;
  longTaskMs: number | null;
}

const VSYNC = 1000 / 60;
const pct = (list: number[], p: number): number => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};
const round = (n: number): number => Math.round(n * 10) / 10;

function stats(all: Frames[], longSupported: boolean): Stats {
  const intervals = all.flatMap((f) => f.intervals);
  const work = all.flatMap((f) => f.work);
  const long = all.flatMap((f) => f.long);
  return {
    frames: intervals.length,
    p50: round(pct(intervals, 50)),
    p95: round(pct(intervals, 95)),
    max: round(Math.max(0, ...intervals)),
    fps: round(
      (1000 * intervals.length) /
        Math.max(
          1,
          intervals.reduce((a, b) => a + b, 0),
        ),
    ),
    slow: intervals.filter((d) => d > VSYNC * 1.5).length,
    workP50: round(pct(work, 50)),
    workP95: round(pct(work, 95)),
    workMax: round(Math.max(0, ...work)),
    longTasks: longSupported ? long.length : null,
    longTaskMs: longSupported ? round(long.reduce((a, b) => a + b, 0)) : null,
  };
}

async function arm(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __longOn: boolean };
    w.__long = [];
    w.__longOn = PerformanceObserver.supportedEntryTypes.includes("longtask");
    if (w.__longOn) new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: "longtask", buffered: false });
    return w.__longOn;
  });
}

async function scroll(page: Page, phases: { dy: number; frames: number }[], jumpy = false): Promise<Frames> {
  return page.evaluate(
    async ({ steps, jumpy }) => {
      const w = window as unknown as { __long: number[] };
      const feed = document.querySelector<HTMLElement>(".main .feed");
      const list = feed?.querySelector(".feed-list");
      if (!feed || !list) throw new Error("no feed on screen");
      w.__long.length = 0;
      const intervals: number[] = [];
      const work: number[] = [];
      const jumps: number[] = [];
      const channel = new MessageChannel();
      let started = 0;
      channel.port1.onmessage = () => work.push(performance.now() - started);
      const box = feed.getBoundingClientRect();
      const probe = document.body.appendChild(document.createElement("div"));
      probe.style.cssText = "position:fixed;top:0;left:0;height:1px;width:1px;pointer-events:none";
      let watched: { el: Element; top: number } | null = null;
      let applied = 0;
      const painted = new ResizeObserver(() => {
        if (watched?.el.isConnected) {
          const drift = Math.abs(watched.el.getBoundingClientRect().top - watched.top + applied);
          if (drift > 1) jumps.push(drift);
        }
        const rows = list.children;
        const line = box.top + box.height / 3;
        let lo = 0;
        let hi = rows.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if ((rows[mid]?.getBoundingClientRect().bottom ?? 0) > line) hi = mid;
          else lo = mid + 1;
        }
        const el = rows[lo];
        watched = el ? { el, top: el.getBoundingClientRect().top } : null;
      });
      if (jumpy) painted.observe(probe);
      await new Promise<void>((done) => {
        let phase = 0;
        let left = steps[0]?.frames ?? 0;
        let last = 0;
        const frame = (t: number) => {
          started = performance.now();
          if (last) intervals.push(t - last);
          last = t;
          const step = steps[phase];
          if (!step) return done();
          const before = feed.scrollTop;
          feed.scrollTop += step.dy;
          applied = feed.scrollTop - before;
          probe.style.width = probe.style.width === "1px" ? "2px" : "1px";
          channel.port2.postMessage(0);
          if (--left <= 0) {
            phase++;
            left = steps[phase]?.frames ?? 0;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      painted.disconnect();
      probe.remove();
      await new Promise((r) => setTimeout(r, 50));
      return { intervals, work, jumps, long: [...w.__long] };
    },
    { steps: phases, jumpy },
  );
}

async function watch(page: Page, ms: number, act: () => Promise<void>): Promise<Frames> {
  await page.evaluate((span) => {
    const w = window as unknown as { __long: number[]; __watch: Promise<{ intervals: number[]; work: number[] }> };
    w.__long.length = 0;
    w.__watch = new Promise((done) => {
      const intervals: number[] = [];
      const work: number[] = [];
      const channel = new MessageChannel();
      let started = 0;
      channel.port1.onmessage = () => work.push(performance.now() - started);
      const until = performance.now() + span;
      let last = 0;
      const frame = (t: number) => {
        started = performance.now();
        if (last) intervals.push(t - last);
        last = t;
        if (t > until) return done({ intervals, work });
        channel.port2.postMessage(0);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, ms);
  await act();
  return page.evaluate(async () => {
    const w = window as unknown as { __long: number[]; __watch: Promise<{ intervals: number[]; work: number[] }> };
    const f = await w.__watch;
    return { ...f, jumps: [], long: [...w.__long] };
  });
}

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const report: Record<string, Stats | number> = {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme === "light" ? "light" : "dark" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=long-feed&theme=${theme}`);
  await page.waitForFunction(() => document.querySelectorAll(".main .feed article").length > 0 && !document.querySelector(".main .feed .md-plain"), undefined, { timeout: 120_000, polling: "raf" });
  report.readyMs = Math.round(await page.evaluate(() => performance.now()));
  report.rows = await page.evaluate(() => document.querySelectorAll(".main .feed [data-seq]").length);
  report.nodes = await page.evaluate(() => document.querySelectorAll(".main .feed *").length);
  if (css) await page.addStyleTag({ path: resolve(css) });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const longOn = await arm(page);

  const trackpad = [
    { dy: -30, frames: 180 },
    { dy: 30, frames: 180 },
  ];
  const fling = [
    { dy: -120, frames: 90 },
    { dy: 120, frames: 90 },
  ];
  const runs: Frames[] = [];
  const flings: Frames[] = [];
  for (let i = 0; i < RUNS; i++) {
    runs.push(await scroll(page, trackpad));
    flings.push(await scroll(page, fling));
    await page.waitForTimeout(300);
  }
  const jumps = [await scroll(page, trackpad, true), await scroll(page, fling, true)];
  report.trackpad = stats(runs, longOn);
  report.fling = stats(flings, longOn);
  report.jumps = jumps.flatMap((f) => f.jumps).length;
  report.jumpMax = round(Math.max(0, ...jumps.flatMap((f) => f.jumps)));

  const composer = page.getByRole("textbox", { name: /^Message/ });
  const sends: Frames[] = [];
  const sendsUp: Frames[] = [];
  for (let i = 0; i < RUNS; i++) {
    await page.evaluate(() => document.querySelector(".main .feed")?.scrollTo({ top: 1e9 }));
    await page.waitForTimeout(200);
    await composer.fill(`perf send ${i}`);
    sends.push(await watch(page, 1200, () => composer.press("Enter")));
    await page.evaluate(() => document.querySelector(".main .feed")?.scrollBy({ top: -3000 }));
    await page.waitForTimeout(200);
    await composer.fill(`perf send up ${i}`);
    sendsUp.push(await watch(page, 1200, () => composer.press("Enter")));
  }
  report.sendAtBottom = stats(sends, longOn);
  report.sendScrolledUp = stats(sendsUp, longOn);
  if (errors.length) throw new Error(`the page threw:\n${errors.join("\n")}`);
} finally {
  await browser.close();
  await server.stop(true);
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`${engine}, 1440x900@2x, ${theme}: ${report.rows} rows, ${report.nodes} nodes, feed ready in ${report.readyMs} ms`);
const line = (name: string, s: Stats) =>
  console.log(
    `${name.padEnd(16)} frames ${String(s.frames).padStart(4)}  interval p50 ${s.p50} p95 ${s.p95} max ${s.max} ms  ${s.fps} fps  over 25 ms ${s.slow}  work p50 ${s.workP50} p95 ${s.workP95} max ${s.workMax} ms${s.longTasks === null ? "" : `  long tasks ${s.longTasks} (${s.longTaskMs} ms)`}`,
  );
for (const key of ["trackpad", "fling", "sendAtBottom", "sendScrolledUp"]) {
  const s = report[key];
  if (typeof s === "object") line(key, s);
}
console.log(report.jumps ? `content jumped ${report.jumps} times while scrolling, up to ${report.jumpMax} px` : "content never jumped while scrolling");
if (out) writeFileSync(out, JSON.stringify({ engine, theme, ...report }, null, 2));
if (check) {
  const failed = [
    ...(typeof report.rows === "number" && report.rows < 1000 ? [] : [`the feed rendered ${report.rows} rows at once: it should render the latest ones and add older ones on the way up`]),
    ...(report.jumpMax === 0 ? [] : [`the content jumped ${report.jumps} times while scrolling, up to ${report.jumpMax} px`]),
  ];
  if (failed.length) {
    console.error(failed.join("\n"));
    process.exit(1);
  }
  console.log("ok: the feed stays put while it scrolls");
}
