import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-side-still.ts [--dist ui/dist] [--browser webkit|chromium] [--times 3]\n\nThe sidebar stays where it is scrolled while its highlight glides to the row just opened, so a press on a row right after a scroll opens that row.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const TIMES = Number(flag("--times") ?? 3);

const INTO_GLIDE_MS = 60;
const HELD_MS = 50;
const FAR = "atlas";
const NEAR = "releases";

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
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

interface Scrolled {
  gliding: boolean;
  room: number;
  start: number;
  low: number;
  high: number;
  end: number;
  x: number;
  y: number;
}

const row = (page: Page, name: string) => page.locator(`.side-row:has-text("${name}")`).first();
const open = (page: Page, name: string) => page.locator(`.side-row.is-on:has-text("${name}")`).first();

async function rested(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const side = document.querySelector(".side");
    return !document.getAnimations().some((a) => {
      const fx = a.effect as KeyframeEffect | null;
      return fx?.target === side && fx?.pseudoElement === "::before" && a.playState === "running";
    });
  });
}

async function scrollMidGlide(page: Page, watch: boolean): Promise<Scrolled> {
  return page.evaluate(
    async ({ into, far, watch }): Promise<Scrolled> => {
      const side = document.querySelector<HTMLElement>(".side");
      if (!side) throw new Error("no sidebar on screen");
      const glide = (): Animation | undefined =>
        document.getAnimations().find((a) => {
          const fx = a.effect as KeyframeEffect | null;
          return fx?.target === side && fx?.pseudoElement === "::before" && a.playState === "running";
        });
      const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));
      const until = performance.now() + 1500;
      while (performance.now() < until && Number(glide()?.currentTime ?? 0) < into) await frame();
      const gliding = glide() !== undefined;
      side.scrollTop = side.scrollHeight;
      const start = side.scrollTop;
      let low = start;
      let high = start;
      if (watch) {
        const stop = performance.now() + 1500;
        while (performance.now() < stop && glide()) {
          await frame();
          low = Math.min(low, side.scrollTop);
          high = Math.max(high, side.scrollTop);
        }
        for (let i = 0; i < 6; i++) {
          await frame();
          low = Math.min(low, side.scrollTop);
          high = Math.max(high, side.scrollTop);
        }
      }
      const at = [...side.querySelectorAll<HTMLElement>(".side-row")].find((r) => r.textContent?.includes(far))?.getBoundingClientRect();
      return {
        gliding,
        room: side.scrollHeight - side.clientHeight,
        start,
        low,
        high,
        end: side.scrollTop,
        x: at ? at.left + at.width / 2 : -1,
        y: at ? at.top + at.height / 2 : -1,
      };
    },
    { into: INTO_GLIDE_MS, far: FAR, watch },
  );
}

const px = (n: number): string => `${Math.round(n * 10) / 10}px`;

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  await row(page, FAR).waitFor();
  const moved: string[] = [];
  const lost: string[] = [];
  let glides = 0;
  let room = 0;
  for (let i = 1; i <= TIMES; i++) {
    await row(page, FAR).click();
    await open(page, FAR).waitFor();
    await rested(page);
    await row(page, NEAR).click();
    const still = await scrollMidGlide(page, true);
    room = still.room;
    if (still.gliding) glides += 1;
    const drift = Math.max(still.start - still.low, still.high - still.start, Math.abs(still.end - still.start));
    if (drift > 1)
      moved.push(`time ${i}: scrolled to ${px(still.start)}, it went as far as ${px(still.start - still.low > still.high - still.start ? still.low : still.high)} and ended at ${px(still.end)}`);

    await row(page, FAR).click();
    await open(page, FAR).waitFor();
    await rested(page);
    await row(page, NEAR).click();
    const press = await scrollMidGlide(page, false);
    if (press.gliding) glides += 1;
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.waitForTimeout(HELD_MS);
    await page.mouse.up();
    const opened = await open(page, FAR)
      .waitFor({ timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    if (!opened) lost.push(`time ${i}: ${(await page.locator(".side-row.is-on").first().textContent())?.trim().slice(0, 20) ?? "nothing"} is open, not ${FAR}`);
    await rested(page);
  }
  expect(room > 100 && glides === TIMES * 2, `the scene's sidebar scrolls (${px(room)}), and its highlight was still gliding each time it was scrolled (${glides} of ${TIMES * 2})`);
  expect(moved.length === 0, `scrolled while its highlight glides to the row just opened, the sidebar stays where it was put${moved.length ? `: ${moved.join("; ")}` : ""}`);
  expect(lost.length === 0, `a press on a row right after that scroll, released ${HELD_MS} ms later, opens that row${lost.length ? `: ${lost.join("; ")}` : ""}`);
  await page.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed in ${engine}`);
  process.exit(1);
}
console.log(`\nthe sidebar holds still while its highlight glides, in ${engine}`);
