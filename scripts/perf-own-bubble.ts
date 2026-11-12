import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const count = Number(flag("--count") ?? 100);
const sweeps = Number(flag("--sweeps") ?? 4);

const LINES = [
  "Yes. It flickers sometimes while I type the name, and the command box under it jumps",
  "Then go through the issues I opened and put every one of them on the board",
  "The lead should handle all of this, and the other roles should do one thing each. Just build, just review, and the lead keeps the rest together.",
  "The tabs come after that",
  "Yes, the tools should show only when the pointer is over the message itself, not the whole line",
  "I want to see how the tasks are going and talk to the lead and the rooms. A question with buttons is fine, but thirty of them in one day is far too many.",
  "Approved. Ship it once CI is green",
  "Can you post a shot of the light theme too? The dark one looks right to me now",
];

interface Cost {
  on: boolean;
  fits: { ms: number; rows: number }[];
  frames: number[];
  last: number;
  writes: number;
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const at = (xs: number[], q: number): number => sorted(xs)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const ms = (n: number): string => `${n.toFixed(1)} ms`;

const frame = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));

async function measure(width: number, height: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height } });
  const threw: string[] = [];
  page.on("pageerror", (e) => threw.push(e.message));
  await page.addInitScript(() => {
    const cost: Cost = { on: false, fits: [], frames: [], last: 0, writes: 0 };
    (window as Window & { bubbleCost?: Cost }).bubbleCost = cost;
    const Real = window.ResizeObserver;
    window.ResizeObserver = class extends Real {
      constructor(run: ResizeObserverCallback) {
        super((entries, self) => {
          const row = entries[0]?.target;
          if (!cost.on || !(row instanceof HTMLElement) || !row.matches("article.msg")) return run(entries, self);
          const from = performance.now();
          run(entries, self);
          cost.fits.push({ ms: performance.now() - from, rows: entries.length });
        });
      }
    };
    new MutationObserver((seen) => {
      if (cost.on) cost.writes += seen.filter((m) => m.target instanceof HTMLElement && m.target.classList.contains("msg-text")).length;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["style"] });
    const tick = (now: number) => {
      if (cost.on && cost.last) cost.frames.push(now - cost.last);
      cost.last = cost.on ? now : 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`http://127.0.0.1:${server.port}/?shot=own-bubbles&theme=dark`);
  const area = page.getByRole("textbox", { name: "Message" });
  await area.waitFor();
  for (let i = 0; i < count; i++) {
    await area.fill(`${LINES[i % LINES.length]} (${i + 1})`);
    await area.press("Enter");
  }
  await page.waitForFunction((n) => document.querySelectorAll(".main article.msg.is-mine").length >= n, count);
  const grip = page.locator(".side-grip");
  if (!(await grip.count())) await page.locator(".top-drawer").click();
  await grip.waitFor();
  await page.waitForTimeout(500);
  const scene = await page.evaluate(() => {
    const mine = [...document.querySelectorAll<HTMLElement>(".main article.msg.is-mine .msg-text")];
    return { mine: mine.length, fitted: mine.filter((b) => b.style.width).length, rows: document.querySelectorAll(".main article.msg").length };
  });
  const box = await grip.boundingBox();
  if (!box) throw new Error("the sidebar's edge has no box");
  const [least, most] = await grip.evaluate((el) => [Number(el.getAttribute("aria-valuemin")), Number(el.getAttribute("aria-valuemax"))]);
  const y = box.y + box.height / 2;
  let x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.evaluate(() => {
    const cost = (window as Window & { bubbleCost?: Cost }).bubbleCost;
    if (cost) cost.on = true;
  });
  const to = async (goal: number) => {
    while (Math.abs(goal - x) > 0.5) {
      x += Math.max(-4, Math.min(4, goal - x));
      await page.mouse.move(x, y);
      await frame(page);
    }
  };
  for (let i = 0; i < sweeps; i++) {
    await to(most ?? x);
    await to(least ?? x);
  }
  await page.mouse.up();
  const cost = await page.evaluate(() => (window as Window & { bubbleCost?: Cost }).bubbleCost ?? null);
  await page.close();
  if (!cost) throw new Error("the page kept no numbers");
  const fits = cost.fits.map((f) => f.ms);
  const frames = cost.frames;
  console.log(
    `\n${width}x${height}, ${engine}: ${scene.mine} of your bubbles (${scene.fitted} fitted to their text) among ${scene.rows} messages, the sidebar's edge dragged ${sweeps} times across its range`,
  );
  console.log(`  fits: ${fits.length}, about ${Math.round(mean(cost.fits.map((f) => f.rows)))} messages each, ${cost.writes} bubble widths written in all`);
  console.log(`  time in one fit: mean ${ms(mean(fits))}, median ${ms(at(fits, 0.5))}, p95 ${ms(at(fits, 0.95))}, longest ${ms(Math.max(0, ...fits))}`);
  console.log(`  frames: ${frames.length}, median ${ms(at(frames, 0.5))}, p95 ${ms(at(frames, 0.95))}, longest ${ms(Math.max(0, ...frames))}, over 20 ms: ${frames.filter((f) => f > 20).length}`);
  if (threw.length) console.log(`  page threw: ${[...new Set(threw)].join("; ")}`);
}

try {
  await measure(1440, 900);
  await measure(1000, 760);
} finally {
  await browser.close();
  await server.stop(true);
}
