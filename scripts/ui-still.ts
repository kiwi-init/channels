#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--chromium") ? "chromium" : "webkit";

const SHOTS = ["thread-doc", "thread-doc-1000", "thread-doc-events", "long-feed", "channel", "ci-live", "event-runs", "dm"] as const;
const SIZES = [
  [1440, 900],
  [900, 1400],
  [420, 800],
] as const;
const SETTLE_MS = 1500;
const REOPEN = ["thread-doc-events"] as const;
const DOC_LATE_MS = 4000;
const DRAWN_MS = 15_000;
const FRAMES = 60;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const watchRows = (): void => {
  const grew: string[] = [];
  (window as Window & { grew?: string[] }).grew = grew;
  let last = new Map<string, number>();
  const read = (): void => {
    const now = new Map<string, number>();
    for (const feed of document.querySelectorAll<HTMLElement>(".feed")) {
      const list = feed.querySelector(".feed-list");
      if (!list || list.hasAttribute("data-unfinished")) continue;
      const view = feed.getBoundingClientRect();
      for (const row of feed.querySelectorAll<HTMLElement>(".feed-list > [data-seq], section.blk")) {
        const box = row.getBoundingClientRect();
        if (box.bottom <= view.top || box.top >= view.bottom) continue;
        now.set(row.dataset.seq ?? row.dataset.id ?? "", box.height);
      }
    }
    for (const [row, size] of now) {
      const was = last.get(row);
      if (was !== undefined && Math.abs(size - was) > 1.5) grew.push(`row ${row} ${Math.round(was)} → ${Math.round(size)} px`);
    }
    last = now;
    requestAnimationFrame(frame);
  };
  const frame = (): void => {
    const fresh = new ResizeObserver(() => {
      fresh.disconnect();
      read();
    });
    fresh.observe(document.documentElement);
  };
  requestAnimationFrame(frame);
};

const watchReveal = (): void => {
  const look = (): void => {
    const list = document.querySelector<HTMLElement>(".feed .feed-list");
    const feed = list?.closest<HTMLElement>(".feed");
    if (!list || !feed || list.hasAttribute("data-unfinished") || !list.querySelector("[data-seq]")) return void requestAnimationFrame(look);
    const view = feed.getBoundingClientRect();
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > [data-seq]")].filter((row) => {
      const box = row.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom;
    });
    (window as Window & { reveal?: { at: number; seqs: string[] } }).reveal = { at: Math.round(performance.now()), seqs: rows.map((row) => row.dataset.seq ?? "") };
  };
  requestAnimationFrame(look);
};

const docLine = (seq: string): boolean => seq.includes(".");

type Reveal = { at: number; seqs: string[] } | null;

async function moves(browser: Browser, shot: string, width: number, height: number): Promise<{ moved: string | null; grew: string[] }> {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.addInitScript(watchRows);
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
    return await measure(page);
  } finally {
    await page.close();
  }
}

async function reopens(browser: Browser, shot: string, width: number, height: number): Promise<{ moved: string | null; grew: string[]; reveal: Reveal }> {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>(".feed-list > [data-seq]")].some((row) => (row.dataset.seq ?? "").includes(".")), undefined, { timeout: DRAWN_MS });
    await page.waitForTimeout(SETTLE_MS);
    await page.addInitScript(watchRows);
    await page.addInitScript(watchReveal);
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}&docLate=${DOC_LATE_MS}`);
    await page.waitForFunction((after) => performance.now() > after, DOC_LATE_MS + SETTLE_MS, { timeout: DOC_LATE_MS + DRAWN_MS });
    const seen = await measure(page);
    return { ...seen, reveal: await page.evaluate(() => (window as Window & { reveal?: { at: number; seqs: string[] } }).reveal ?? null) };
  } finally {
    await page.close();
  }
}

async function measure(page: Page): Promise<{ moved: string | null; grew: string[] }> {
  await page.waitForSelector(".feed", { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  await page
    .waitForFunction(() => !document.querySelector(".feed .md-plain"), undefined, { timeout: DRAWN_MS })
    .catch(() => {
      // A row whose markdown never parses keeps its plain text for good; the frames below still say whether the view moves.
    });
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const moved = await page.evaluate(
    (frames) =>
      new Promise<string | null>((done) => {
        const read = () => [...document.querySelectorAll<HTMLElement>(".feed")].map((f) => `${Math.round(f.scrollTop)}/${f.scrollHeight}`).join(" ");
        const seen = [read()];
        const tick = () => {
          seen.push(read());
          if (seen.length <= frames) return void requestAnimationFrame(tick);
          const changed = new Set(seen);
          done(changed.size === 1 ? null : `${changed.size} positions in ${frames} frames: ${[...changed].slice(0, 6).join(" → ")}`);
        };
        requestAnimationFrame(tick);
      }),
    FRAMES,
  );
  return { moved, grew: await page.evaluate(() => (window as Window & { grew?: string[] }).grew ?? []) };
}

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
let failed = 0;
try {
  for (const shot of SHOTS)
    for (const [width, height] of SIZES) {
      const { moved, grew } = await moves(browser, shot, width, height);
      if (moved) failed++;
      console.log(`${moved ? "✗" : "✓"} ${shot} at ${width}x${height} holds still after opening${moved ? `: ${moved}` : ""}`);
      if (grew.length) failed++;
      console.log(
        `${grew.length ? "✗" : "✓"} ${shot} at ${width}x${height}: rows keep their height once the feed shows${grew.length ? `: ${grew.length} changes, ${grew.slice(0, 4).join(", ")}` : ""}`,
      );
    }
  for (const shot of REOPEN)
    for (const [width, height] of SIZES) {
      const { moved, grew, reveal } = await reopens(browser, shot, width, height);
      const late = `reopened with its doc ${DOC_LATE_MS} ms late`;
      if (moved) failed++;
      console.log(`${moved ? "✗" : "✓"} ${shot} at ${width}x${height} ${late} holds still${moved ? `: ${moved}` : ""}`);
      if (grew.length) failed++;
      console.log(`${grew.length ? "✗" : "✓"} ${shot} at ${width}x${height} ${late}: rows keep their height${grew.length ? `: ${grew.length} changes, ${grew.slice(0, 4).join(", ")}` : ""}`);
      const kept = !!reveal && reveal.at < DOC_LATE_MS && reveal.seqs.some(docLine);
      if (!kept) failed++;
      console.log(
        `${kept ? "✓" : "✗"} ${shot} at ${width}x${height} ${late}: its first frame shows the kept doc lines${reveal ? ` (shown at ${reveal.at} ms, ${reveal.seqs.filter(docLine).length} doc lines of ${reveal.seqs.length} rows)` : ": never shown"}`,
      );
    }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} views kept scrolling or grew rows after they opened, in ${engine}`);
  process.exitCode = 1;
}
