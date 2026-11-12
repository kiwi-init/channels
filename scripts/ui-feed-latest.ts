import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { type Place, px, rests, serveDist, wheelUp } from "./feed-place.ts";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-feed-latest.ts [--dist ui/dist] [--browser webkit|chromium]\n\nScrolled up a long feed, a little, far past the rows it holds, near the top of those rows, or while older rows still load, Jump to latest shows, takes a click, brings the feed's last line back to the bottom of the view and goes.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const WHEELS = [1, 6, 30] as const;
const WHEEL = 1200;
const NEAR_TOP = 600;
const LOADS_UNDER = 3;
const CLEAR = 200;

const server = serveDist(dist);
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

async function open(): Promise<{ page: Page; opened: Place }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=long-feed`);
  await page.waitForSelector(".main .feed-list > [data-seq]", { timeout: 15_000 });
  return { page, opened: await rests(page, (p) => p.pill === "" && p.rows > 20) };
}

async function wheels(page: Page, by: number): Promise<void> {
  for (let left = by; left > 0; left -= WHEEL) {
    await wheelUp(page, Math.min(WHEEL, left));
    await page.waitForTimeout(60);
  }
}

async function shown(page: Page, opened: Place, at: string): Promise<{ x: number; y: number; up: Place } | null> {
  const pill = page.locator(".main .feed-jump");
  const there = await pill
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  const up = await rests(page, () => true, 5_000);
  expect(
    there && up.pill !== "" && (up.last !== opened.last || up.under > 100),
    `${at}: Jump to latest shows (rows ${up.first} to ${up.last} are held, the view is ${px(up.top)} under their top and the last of them ends ${px(up.under)} under the view)`,
  );
  if (!there) return null;
  const onTop = await pill.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  expect(onTop, `${at}: nothing covers it, a click at its middle lands on it`);
  const spot = await pill.boundingBox();
  return spot ? { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2, up } : null;
}

async function lands(page: Page, opened: Place, at: string): Promise<void> {
  const back = await rests(page, (p) => p.pill === "" && p.last === opened.last && Math.abs(p.under - opened.under) <= 2);
  expect(
    back.last === opened.last && Math.abs(back.under - opened.under) <= 2,
    `${at}: a click brings the feed's last line back to the bottom of the view (row ${back.last} of ${opened.last}, ${px(back.under - opened.under)} from where it opened)`,
  );
  expect(back.pill === "" && back.room <= 0.5, `${at}: and Jump to latest goes, with no blank room under the last line (it reads "${back.pill}", ${px(back.room)} of room)`);
}

try {
  const first = await open();
  expect(
    first.opened.pill === "" && first.opened.rows > 20 && first.opened.under <= 0.5 && first.opened.under > -200,
    `the long feed opens on its last line with no Jump to latest (${first.opened.rows} rows, row ${first.opened.last} ends ${px(-first.opened.under)} above the bottom of the view)`,
  );
  for (const count of WHEELS) {
    const at = `${count * WHEEL}px of wheel up`;
    await wheels(first.page, count * WHEEL);
    const spot = await shown(first.page, first.opened, at);
    if (!spot) continue;
    await first.page.mouse.click(spot.x, spot.y);
    await lands(first.page, first.opened, at);
  }
  await first.page.close();

  const near = await open();
  const top = "near the top of the rows it holds";
  const edge = (await near.page.evaluate(() => document.querySelector<HTMLElement>(".main .feed")?.clientHeight ?? 0)) * LOADS_UNDER + CLEAR;
  await wheels(near.page, near.opened.top - edge);
  await rests(near.page, () => true, 5_000);
  await wheelUp(near.page, edge - NEAR_TOP);
  const spot = await shown(near.page, near.opened, top);
  if (spot) {
    expect(
      spot.up.last === near.opened.last && spot.up.rows > near.opened.rows,
      `${top}: older rows have loaded and the feed still holds its last line (${spot.up.rows} rows, ${near.opened.rows} when it opened, the last is row ${spot.up.last})`,
    );
    await near.page.mouse.click(spot.x, spot.y);
    await lands(near.page, near.opened, top);
  }
  await near.page.close();

  const busy = await open();
  const loading = "clicked right after a wheel to the top of the rows it holds, while older rows load";
  await wheels(busy.page, WHEEL);
  const pill = await shown(busy.page, busy.opened, loading);
  if (pill) {
    const from = await busy.page.evaluate(() => document.querySelector<HTMLElement>(".main .feed")?.scrollTop ?? 0);
    await busy.page.mouse.wheel(0, -Math.max(0, from - NEAR_TOP));
    await busy.page.mouse.click(pill.x, pill.y);
    await lands(busy.page, busy.opened, loading);
  }
  await busy.page.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed in ${engine}: Jump to latest left the feed away from its last line`);
  process.exit(1);
}
console.log(`\nJump to latest brings the feed's last line back from anywhere, in ${engine}`);
