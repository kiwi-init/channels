#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { firstRun, newChannel, say } from "./perf-ui.ts";
import { pageErrors } from "./page-errors.ts";

if (process.argv.includes("--help")) {
  console.log(`Two windows of jow in one channel. The second sends tall lines from its composer that land below the fold of the
first, which reads at the top. Then the first scrolls down to them: the feed must keep its height, because the feed's scroll
keeper (useStick) scrolls inside its own ResizeObserver, and a line that changes size when it scrolls into view loops that
observer (WebKit: "ResizeObserver loop completed with undelivered notifications").

  bun scripts/ui-doc-steady.ts [--webkit] [--dist=ui/dist-harness]

Needs bun scripts/ui-harness.ts first.`);
  process.exit(0);
}

const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const ROWS = 24;

const data = mkdtempSync(join(tmpdir(), "kiwi-doc-steady-"));
mkdirSync(join(data, "relay"));
const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

async function switchTo(page: Page, name: string): Promise<void> {
  await page.evaluate((title) => {
    const tile = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Channels"] button.tile')].find((b) => (b.getAttribute("aria-label") ?? "").split(",")[0] === title);
    if (!tile) throw new Error(`no ${title} tile in the rail`);
    tile.click();
  }, name);
  await page.waitForFunction((title) => document.querySelector('nav[aria-label="Channels"] button.tile[aria-current="page"]')?.getAttribute("aria-label")?.split(",")[0] === title, name, {
    timeout: 15000,
  });
}

const rows = (from: number, to: number): string => Array.from({ length: to - from + 1 }, (_, i) => `row ${from + i} of the tall line below the fold`).join("\n");

const shows = (page: Page, want: string): Promise<unknown> => page.waitForFunction((text) => document.querySelector(".main .feed-list")?.textContent?.includes(text), want, { timeout: 20000 });

const height = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const list = document.querySelector<HTMLElement>(".feed-list");
    if (!list) return -1;
    const cs = getComputedStyle(list);
    return Math.round((list.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) * 10) / 10;
  });

const scrollTo = (page: Page, at: "top" | "bottom"): Promise<void> =>
  page.evaluate(
    (where) =>
      new Promise<void>((done) => {
        const feed = document.querySelector<HTMLElement>(".feed");
        if (feed) feed.scrollTop = where === "top" ? 0 : feed.scrollHeight;
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
    at,
  );

const errors: string[] = [];
const failures: string[] = [];
const check = (what: string, why: string | null): void => {
  if (why) failures.push(`${what}: ${why}`);
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
};

try {
  const reader = await browser.newContext({ viewport: { width: 1280, height: 700 } });
  const a = await reader.newPage();
  await pageErrors(a, (e) => errors.push(`reader: ${e}`));
  await a.goto(BASE);
  await firstRun(a, "jow");
  await newChannel(a, "steady");
  const writer = await browser.newContext({ viewport: { width: 1280, height: 700 }, storageState: await reader.storageState({ indexedDB: true }) });
  const b = await writer.newPage();
  await pageErrors(b, (e) => errors.push(`writer: ${e}`));
  await b.goto(BASE);
  await switchTo(b, "steady");
  for (let n = 1; n <= 36; n++) await say(a, `line ${n}, sent so the feed is taller than the window`);
  await say(b, `a tall line\n${rows(1, ROWS)}`);
  await shows(a, `row ${ROWS} of the tall line`);
  await scrollTo(a, "top");
  await a.waitForTimeout(800);
  await say(b, `another tall line\n${rows(ROWS + 1, ROWS * 2)}`);
  await shows(a, `row ${ROWS * 2} of the tall line`);
  await a.waitForTimeout(1500);
  const before = await height(a);
  await scrollTo(a, "bottom");
  const after = await height(a);
  check("tall lines sent below the fold keep their height when the reader scrolls to them", Math.abs(after - before) <= 0.5 ? null : `the feed went from ${before} to ${after} px as it scrolled`);
  await a.waitForTimeout(500);
  check("no page errors", errors.length ? errors.slice(0, 3).join("; ") : null);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`a line changed size as it scrolled into view, in ${ENGINE}`);
  process.exitCode = 1;
}
