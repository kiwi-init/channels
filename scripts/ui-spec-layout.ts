#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { webkit, type Locator, type Page } from "playwright-core";

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

async function below(page: Page, what: string, el: Locator): Promise<string | null> {
  const at = (await el.count()) ? await el.boundingBox() : null;
  const view = page.viewportSize();
  if (!at || !view) return `no ${what}`;
  const bottom = at.y + at.height;
  return bottom > view.height + 1 ? `${what} ends at y ${Math.round(bottom)}, below the ${view.height} px window` : null;
}

async function grows(page: Page): Promise<string | null> {
  const box = page.getByLabel("Comment on the spec");
  const foot = page.locator(".spec-rail-foot");
  const rest = await below(page, "the comment box", foot);
  if (rest) return `${rest} before anything is typed`;
  await box.click();
  const [before, footBefore] = [await box.boundingBox(), await foot.boundingBox()];
  await page.keyboard.type(LONG);
  await page.waitForTimeout(400);
  const [after, footAfter] = [await box.boundingBox(), await foot.boundingBox()];
  if (!before || !after || !footBefore || !footAfter) return "no comment box on screen";
  const grew = footAfter.height - footBefore.height;
  if (after.y > before.y + 4 || after.y < before.y - grew - 4)
    return `the comment box moved from y ${Math.round(before.y)} to ${Math.round(after.y)} while it and its buttons grew ${Math.round(grew)} px`;
  const typed = await below(page, "the Comment button", page.locator(".spec-rail-foot").getByRole("button", { name: "Comment", exact: true }));
  if (typed) return `${typed} after a long comment`;
  const hidden = await page.locator(".spec-rail-scroll").evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));
  if (hidden > 1) return `the newest comment slid ${hidden} px out of view as the box grew`;
  return after.height > before.height * 2 ? null : `the comment box stayed ${Math.round(after.height)} px high (was ${Math.round(before.height)}) with a comment that wraps over several lines`;
}

async function growsFull(page: Page): Promise<string | null> {
  const fill = await page.locator(".spec-rail-scroll").evaluate((el) => ({ content: el.scrollHeight, shown: el.clientHeight }));
  if (fill.content <= fill.shown + 1) return `the comments fit (${fill.content} px in ${fill.shown}), so the rail isn't full: make the window shorter`;
  return grows(page);
}

const FULL = [
  [1900, 900, "with the comments nearly filling the rail", grows],
  [1900, 680, "with the comments filling the rail", growsFull],
  [1400, 480, "with the comments filling the rail", growsFull],
] as const;

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

async function staysInPane(page: Page): Promise<string | null> {
  const got = await page.evaluate(() => {
    const work = document.querySelector<HTMLElement>(".tall-work");
    const spec = work?.querySelector<HTMLElement>(".spec-page");
    if (!work || !spec) return { kind: "missing" as const };
    const bottom = work.getBoundingClientRect().bottom;
    const clipped = (el: HTMLElement): boolean => {
      for (let up: HTMLElement | null = el.parentElement; up; up = up.parentElement) {
        if (getComputedStyle(up).overflowY !== "visible" && up.getBoundingClientRect().bottom <= bottom + 1) return true;
        if (up === work) return false;
      }
      return false;
    };
    const leaks = [...work.querySelectorAll<HTMLElement>("*")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0 && r.bottom > bottom + 1 && !clipped(el);
    });
    const scrolls = spec.scrollHeight > spec.clientHeight + 1;
    return { kind: "seen" as const, leaks: leaks.slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${el.className || "-"}`), n: leaks.length, scrolls, bottom: Math.round(bottom) };
  });
  if (got.kind === "missing") return "no spec in the tall layout's top pane";
  if (!got.scrolls) return "the spec fits its pane, so nothing could spill: make the window shorter or the pane smaller";
  return got.n ? `${got.n} parts of the spec draw below the grip (y ${got.bottom}), such as ${got.leaks.join(", ")}` : null;
}

const TALL_H = 1500;
const SPLIT = Math.round(TALL_H * 0.42);
const CHAT_MAX_PX = 420;

const heights = (page: Page) =>
  page.evaluate(() => ({
    work: Math.round(document.querySelector<HTMLElement>(".tall-work")!.getBoundingClientRect().height),
    chat: Math.round(document.querySelector<HTMLElement>(".tall-chat")!.getBoundingClientRect().height),
  }));

async function roomy(page: Page): Promise<string | null> {
  const got = await heights(page);
  if (got.work < SPLIT + 200) return `the top pane is ${got.work} px, about the usual ${SPLIT} px split`;
  return got.chat <= CHAT_MAX_PX ? null : `the chat keeps ${got.chat} px under an open spec`;
}

async function drags(page: Page): Promise<string | null> {
  const before = (await heights(page)).work;
  await page.locator(".tall-grip").focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowUp");
  await page.waitForTimeout(200);
  const after = (await heights(page)).work;
  return after < before - 300 ? null : `the pane went from ${before} to ${after} px after the grip moved up 384 px`;
}

async function givesBack(page: Page): Promise<string | null> {
  await page.getByRole("button", { name: "All specs" }).click();
  await page.waitForTimeout(400);
  const got = (await heights(page)).work;
  return Math.abs(got - SPLIT) <= 2 ? null : `the top pane is ${got} px after the spec closed, not the usual ${SPLIT} px`;
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
    ["the comment box grows as a long comment wraps, and its Comment button stays on screen", grows],
  ] as const) {
    const why = await check(page);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} spec-draft at 1900x1000: ${what}${why ? `: ${why}` : ""}`);
  }
  for (const [width, height, rail, check] of FULL) {
    const full = await browser.newPage({ viewport: { width, height } });
    await full.goto(`http://127.0.0.1:${server.port}/?shot=spec-draft`);
    await full.waitForSelector(".spec-doc-wrap.is-wide", { timeout: 15_000 });
    await full.waitForTimeout(500);
    const why = await check(full);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} spec-draft at ${width}x${height}: ${rail}, the comment box grows and its Comment button stays on screen${why ? `: ${why}` : ""}`);
    await full.close();
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
  const tall = await browser.newPage({ viewport: { width: 1100, height: TALL_H } });
  await tall.goto(`http://127.0.0.1:${server.port}/?shot=spec-draft`);
  await tall.waitForSelector(".tall-work .spec-doc-wrap", { timeout: 15_000 });
  await tall.waitForTimeout(500);
  for (const [what, check] of [
    ["an open spec grows the top pane and leaves the chat a strip", roomy],
    ["the grip still resizes the pane while a spec is open", drags],
    ["the spec stays in the top pane, above the grip", staysInPane],
    ["closing the spec gives back the usual split", givesBack],
  ] as const) {
    const why = await check(tall);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} spec-draft at 1100x${TALL_H} (tall): ${what}${why ? `: ${why}` : ""}`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} spec page checks failed, in WebKit`);
  process.exitCode = 1;
}
