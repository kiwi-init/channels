#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

if (process.argv.includes("--help")) {
  console.log(`A feed keeps its place when its width changes. Each demo feed is opened at the bottom and again scrolled up, then the
sidebar is hidden and shown three times, its edge is dragged out and back, a task is opened in the panel and closed, and the
window is narrowed and widened, once past the point where the layout switches. After every step the feed has no blank room
under its last line; at the bottom it is still at the bottom, and scrolled up the row that was at the top is still in view and
back on its pixel once the width is back. Short feeds get a short window, so they have something to scroll.

  bun scripts/ui-feed-width.ts [--dist ui/dist] [--chromium]`);
  process.exit(0);
}

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--chromium") ? "chromium" : "webkit";

const FEEDS = [
  { shot: "channel", name: "a room with a shared doc", feed: ".main .feed", height: 900 },
  { shot: "room-doc", name: "a short room with a written doc", feed: ".main .feed", height: 620 },
  { shot: "long-feed", name: "a long room", feed: ".main .feed", height: 900 },
  { shot: "dm", name: "a conversation with no doc", feed: ".main .feed", height: 420 },
  { shot: "channel", name: "a thread in the panel", feed: "aside.panel .feed", height: 420, open: ".main .msg-thread" },
] as const;
const WIDTH = 1440;
const UP = 300;
const LEAST_UP = 60;
const WAIT_MS = 350;

interface Seen {
  top: number;
  below: number;
  room: number;
  width: number;
  row: number | null;
  rowTop: number;
  rowInView: boolean;
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

const read = (page: Page, feed: string, row: number | null): Promise<Seen> =>
  page.evaluate(
    ({ feed, row }) => {
      const box = document.querySelector<HTMLElement>(feed);
      if (!box) throw new Error(`no ${feed}`);
      const view = box.getBoundingClientRect();
      const rows = [...box.querySelectorAll<HTMLElement>("[data-seq]")];
      const el = row === null ? rows.find((r) => r.getBoundingClientRect().bottom > view.top + 1) : rows.find((r) => Number(r.dataset.seq) === row);
      const rect = el?.getBoundingClientRect();
      return {
        top: box.scrollTop,
        below: box.scrollHeight - box.clientHeight - box.scrollTop,
        room: box.querySelector<HTMLElement>(".feed-room")?.getBoundingClientRect().height ?? 0,
        width: box.clientWidth,
        row: el ? Number(el.dataset.seq) : null,
        rowTop: rect ? rect.top - view.top : Number.NaN,
        rowInView: !!rect && rect.bottom > view.top && rect.top < view.bottom,
      };
    },
    { feed, row },
  );

async function steps(page: Page, feed: string, height: number): Promise<[string, boolean, () => Promise<void>][]> {
  const toggle = () => page.locator(".top-drawer").click();
  const grip = await page.locator(".side-grip").boundingBox();
  const drag = (by: number) => async () => {
    const now = await page.locator(".side-grip").boundingBox();
    if (!now) throw new Error("the sidebar has no edge to drag");
    const y = now.y + now.height / 2;
    await page.mouse.move(now.x + now.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(now.x + now.width / 2 + by, y, { steps: 6 });
    await page.mouse.up();
  };
  const all: [string, boolean, () => Promise<void>][] = [];
  for (let round = 1; round <= 3; round++) {
    all.push([`the sidebar hidden (round ${round})`, false, toggle]);
    all.push([`the sidebar shown (round ${round})`, true, toggle]);
  }
  if (grip) {
    all.push(["the sidebar's edge dragged 90px out", false, drag(90)]);
    all.push(["the sidebar's edge dragged back", true, drag(-90)]);
  }
  if (feed.startsWith(".main") && (await page.locator(".track .track-row").count()) > 0) {
    all.push(["a task opened in the panel", false, () => page.locator(".track .track-row").first().click()]);
    all.push(["the panel closed", true, () => page.locator("aside.panel").getByRole("button", { name: "Close", exact: true }).click()]);
  }
  for (const width of [1100, 700]) {
    all.push([`the window narrowed to ${width}px`, false, () => page.setViewportSize({ width, height })]);
    all.push([`the window back at ${WIDTH}px`, true, () => page.setViewportSize({ width: WIDTH, height })]);
  }
  return all;
}

async function check(browser: Browser, target: (typeof FEEDS)[number], place: "at the bottom" | "scrolled up"): Promise<string[] | null> {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: target.height } });
  const fails: string[] = [];
  await pageErrors(page, (e) => fails.push(`the page threw: ${e}`));
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${target.shot}`);
    await page.waitForSelector(".main .feed", { timeout: 15_000 });
    if ("open" in target) await page.locator(target.open).first().click();
    const feed = page.locator(target.feed);
    await feed.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    await feed.dispatchEvent("pointerdown");
    if (place === "scrolled up") {
      const by = Math.min(UP, Math.floor((await read(page, target.feed, null)).top) - 20);
      if (by < LEAST_UP) return null;
      await feed.evaluate((el, by) => el.scrollBy(0, -by), by);
      await page.waitForTimeout(WAIT_MS);
    }
    const start = await read(page, target.feed, null);
    if (place === "at the bottom" && (start.below > 1 || start.room > 0)) fails.push(`it opened ${Math.round(start.below)}px above its end with ${Math.round(start.room)}px of room`);
    const widths = new Set([start.width]);
    for (const [step, back, act] of await steps(page, target.feed, target.height)) {
      await act();
      await page.waitForTimeout(WAIT_MS);
      const now = await read(page, target.feed, start.row);
      widths.add(now.width);
      if (now.room > 0.5) fails.push(`${step}: ${Math.round(now.room)}px of blank room under the last line`);
      if (place === "at the bottom" && now.below > 1) fails.push(`${step}: the feed rests ${Math.round(now.below)}px above its end`);
      if (place === "scrolled up" && !now.rowInView) fails.push(`${step}: the row that was being read (#${start.row}) left the view`);
      if (place === "scrolled up" && back && Math.abs(now.rowTop - start.rowTop) > 2)
        fails.push(`${step}: the row that was being read (#${start.row}) is ${Math.round(now.rowTop - start.rowTop)}px from where it was`);
    }
    if (widths.size < 2) fails.push("no step changed the feed's width, so nothing was checked");
    return fails;
  } finally {
    await page.close();
  }
}

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
let failed = 0;
try {
  for (const target of FEEDS)
    for (const place of ["at the bottom", "scrolled up"] as const) {
      const fails = await check(browser, target, place);
      if (!fails) {
        failed++;
        console.log(`✗ ${target.name}, ${place}: the feed is too short to scroll up, so nothing was checked`);
        continue;
      }
      if (fails.length) failed++;
      console.log(`${fails.length ? "✗" : "✓"} ${target.name}, ${place}, keeps its place through every width change${fails.length ? `:\n    ${fails.join("\n    ")}` : ""}`);
    }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} feeds lost their place when their width changed, in ${engine}`);
  process.exitCode = 1;
}
