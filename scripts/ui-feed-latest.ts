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
    "usage: bun scripts/ui-feed-latest.ts [--dist ui/dist] [--browser webkit|chromium]\n\nScrolled up a long feed, a little or far past the rows it holds, Jump to latest shows, takes a click, brings the feed to its end and goes.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const WHEELS = [1, 6, 30] as const;
const WHEEL = 1200;
const STILL_FRAMES = 30;

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

interface Place {
  below: number;
  first: number;
  rows: number;
}

const place = (page: Page): Promise<Place> =>
  page.evaluate(() => {
    const feed = document.querySelector<HTMLElement>(".main .feed");
    if (!feed) throw new Error("no feed on screen");
    return {
      below: Math.round(feed.scrollHeight - feed.scrollTop - feed.clientHeight),
      first: Number(feed.querySelector("[data-seq]")?.getAttribute("data-seq") ?? -1),
      rows: feed.querySelectorAll("[data-seq]").length,
    };
  });

const atEnd = (page: Page): Promise<boolean> =>
  page
    .waitForFunction(
      () => {
        const feed = document.querySelector<HTMLElement>(".main .feed");
        return !!feed && feed.scrollHeight - feed.scrollTop - feed.clientHeight <= 2 && !document.querySelector(".main .feed-jump");
      },
      undefined,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);

const drifts = (page: Page, frames: number): Promise<number> =>
  page.evaluate(
    (frames) =>
      new Promise<number>((done) => {
        const feed = document.querySelector<HTMLElement>(".main .feed");
        if (!feed) return done(-1);
        let most = 0;
        let left = frames;
        const tick = () => {
          most = Math.max(most, feed.scrollHeight - feed.scrollTop - feed.clientHeight);
          if (--left > 0) return void requestAnimationFrame(tick);
          done(Math.round(most));
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=long-feed`);
  await page.waitForSelector(".main .feed [data-seq]", { timeout: 15_000 });
  const opened = (await atEnd(page)) ? await place(page) : null;
  expect(opened !== null && opened.rows > 20, `the long feed opens at its end with no Jump to latest (${opened ? `${opened.rows} rows, ${opened.below}px below` : "it never rested at its end"})`);
  const latest = opened ? opened.first + opened.rows : -1;
  const box = await page.locator(".main .feed").boundingBox();
  if (!box) throw new Error("no feed box");
  for (const wheels of WHEELS) {
    const at = `${wheels * WHEEL}px of wheel up`;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < wheels; i++) {
      await page.mouse.wheel(0, -WHEEL);
      await page.waitForTimeout(60);
    }
    const pill = page.locator(".main .feed-jump");
    const shown = await pill
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const up = await place(page);
    expect(shown && up.below > 100, `${at}: Jump to latest shows (${up.below}px above the end, first row ${up.first})`);
    if (!shown) continue;
    const onTop = await pill.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    });
    expect(onTop, `${at}: nothing covers it, a click at its middle lands on it`);
    const spot = await pill.boundingBox();
    if (spot) await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2);
    const rested = await atEnd(page);
    const back = await place(page);
    expect(rested, `${at}: a click brings the feed to its end and Jump to latest goes (${back.below}px below, ${await pill.count()} shown)`);
    expect(back.first + back.rows >= latest, `${at}: the latest rows are the ones on screen (rows ${back.first} to ${back.first + back.rows - 1}, the feed ends at ${latest - 1})`);
    const most = await drifts(page, STILL_FRAMES);
    expect(most <= 2, `${at}: and it stays at its end for the next ${STILL_FRAMES} frames (${most}px below at most)`);
  }
  await page.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed in ${engine}: Jump to latest left the feed away from its end`);
  process.exit(1);
}
console.log(`\nJump to latest brings the feed to its end from anywhere, in ${engine}`);
