#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { webkit, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const FILLS = 0.95;
const COMMENTS_PX = 400;
const LONG = "This reads fine, but the export should say which board it came from, and the date, so a file in someone's downloads still makes sense next week. ".repeat(3);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

async function layout(page: Page): Promise<string | null> {
  const got = await page.evaluate(() => {
    const pageEl = document.querySelector<HTMLElement>(".spec-page")!;
    const wrap = document.querySelector<HTMLElement>(".spec-doc-wrap")!;
    const rail = wrap.querySelector<HTMLElement>(".spec-rail");
    const pad = parseFloat(getComputedStyle(pageEl).paddingLeft) + parseFloat(getComputedStyle(pageEl).paddingRight);
    return { room: pageEl.clientWidth - pad, used: wrap.getBoundingClientRect().width, comments: rail?.getBoundingClientRect().width ?? 0 };
  });
  const fill = got.used / got.room;
  if (fill < FILLS) return `the spec and its comments use ${Math.round(got.used)} of ${Math.round(got.room)} px, leaving empty margins`;
  if (got.comments < COMMENTS_PX) return `the comments column is ${Math.round(got.comments)} px wide`;
  return null;
}

async function grows(page: Page): Promise<string | null> {
  const box = page.getByLabel("Comment on the spec");
  await box.click();
  const before = await box.boundingBox();
  await page.keyboard.type(LONG);
  await page.waitForTimeout(400);
  const after = await box.boundingBox();
  if (!before || !after) return "no comment box on screen";
  if (Math.abs(after.y - before.y) > 4) return `the comment box moved from y ${Math.round(before.y)} to ${Math.round(after.y)} while it grew`;
  return after.height > before.height * 2 ? null : `the comment box stayed ${Math.round(after.height)} px high (was ${Math.round(before.height)}) with a comment that wraps over several lines`;
}

const GAP_PX = 64;

async function ownScroll(page: Page): Promise<string | null> {
  const rail = (await page.locator(".spec-rail-scroll").count()) ? page.locator(".spec-rail-scroll") : page.locator(".spec-rail");
  const spec = () => page.evaluate(() => document.querySelector<HTMLElement>(".spec-page")!.scrollTop);
  const own = () => rail.evaluate((el) => el.scrollTop);
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".spec-page")!;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  });
  await page.waitForTimeout(300);
  const box = await rail.boundingBox();
  const view = page.viewportSize();
  if (!box || !view) return "the comments aren't on screen";
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, view.height);
  if (bottom - top < 40) return `the comments scrolled out of view with the spec (${Math.round(box.y)}-${Math.round(box.y + box.height)})`;
  const fits = await rail.evaluate((el) => (el.scrollHeight <= el.clientHeight + 1 ? `${el.scrollHeight} px in ${el.clientHeight}` : ""));
  if (fits) return `the comments fit (${fits}), so there is nothing to scroll: make the window shorter`;
  const [specBefore, ownBefore] = [await spec(), await own()];
  await page.mouse.move(box.x + box.width / 2, (top + bottom) / 2);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(500);
  const [specAfter, ownAfter] = [await spec(), await own()];
  if (Math.abs(specAfter - specBefore) > 1) return `a wheel over the comments moved the spec from ${specBefore} to ${specAfter}`;
  return ownAfter !== ownBefore ? null : `the comments didn't scroll (${ownBefore} → ${ownAfter})`;
}

async function inView(page: Page): Promise<string | null> {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".spec-page")!;
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>(".spec-page")!.getBoundingClientRect();
    const rail = document.querySelector<HTMLElement>(".spec-rail")?.getBoundingClientRect();
    const box = document.querySelector<HTMLElement>('[aria-label="Comment on the spec"]')?.getBoundingClientRect();
    return { top: view.top, bottom: view.bottom, rail: rail ? { top: rail.top, bottom: rail.bottom } : null, box: box ? { top: box.top, bottom: box.bottom } : null };
  });
  if (!got.rail || !got.box) return "no comments column or comment box";
  if (got.rail.bottom < got.top + 40) return `the comments scrolled away with the spec (their bottom is at ${Math.round(got.rail.bottom)}, the page starts at ${Math.round(got.top)})`;
  return got.box.top >= got.top && got.box.bottom <= got.bottom + 1
    ? null
    : `the comment box is at ${Math.round(got.box.top)}-${Math.round(got.box.bottom)}, outside ${Math.round(got.top)}-${Math.round(got.bottom)}`;
}

async function noGaps(page: Page): Promise<string | null> {
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".spec-rail .spec-comment")].map((c) => [c.getBoundingClientRect().top, c.getBoundingClientRect().bottom] as const).sort((a, b) => a[0] - b[0]),
  );
  if (tops.length < 3) return `only ${tops.length} comments in the column`;
  const gaps = tops.slice(1).map(([top], i) => Math.round(top - tops[i]![1]));
  const worst = Math.max(...gaps);
  return worst <= GAP_PX ? null : `comments sit ${gaps.join(", ")} px apart, up to ${worst}`;
}

async function jumps(page: Page): Promise<string | null> {
  await page.evaluate(() => (document.querySelector<HTMLElement>(".spec-page")!.scrollTop = 0));
  await page.waitForTimeout(300);
  const link = page.locator(".spec-rail button.spec-comment-quote", { hasText: "Anything archived before 0.20" });
  if (!(await link.count())) return "a comment on a line has no link to that line";
  await link.click();
  await page.waitForTimeout(600);
  const shown = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>(".spec-page")!.getBoundingClientRect();
    const line = [...document.querySelectorAll<HTMLElement>(".spec-doc [data-anchor]")].find((b) => b.textContent?.includes("Anything archived before 0.20"));
    const at = line?.getBoundingClientRect();
    return at ? at.top >= view.top && at.bottom <= view.bottom : false;
  });
  return shown ? null : "the spec line is still out of view after a click on its comment";
}

const browser = await webkit.launch();
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.port}/?shot=spec-draft`);
  await page.waitForSelector(".spec-doc-wrap.is-wide", { timeout: 15_000 });
  await page.waitForTimeout(500);
  for (const [what, check] of [
    ["a wide window goes to the spec and its comments, not to empty margins", layout],
    ["the comment box grows in place as a long comment wraps", grows],
  ] as const) {
    const why = await check(page);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} spec-draft at 1900x1000: ${what}${why ? `: ${why}` : ""}`);
  }
  const short = await browser.newPage({ viewport: { width: 1400, height: 480 } });
  await short.goto(`http://127.0.0.1:${server.port}/?shot=spec-draft`);
  await short.waitForSelector(".spec-doc-wrap.is-wide", { timeout: 15_000 });
  await short.waitForTimeout(500);
  for (const [what, check] of [
    ["a wheel over the comments scrolls them, not the spec", ownScroll],
    ["at the end of the spec, the comments and their box are still in view", inView],
    ["the comments stack without gaps", noGaps],
    ["a comment's quote brings its spec line into view", jumps],
  ] as const) {
    const why = await check(short);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} spec-draft at 1400x480: ${what}${why ? `: ${why}` : ""}`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} spec page checks failed, in WebKit`);
  process.exitCode = 1;
}
