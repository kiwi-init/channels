#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { firstRun, newChannel } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";

const ENGINES = (process.argv.find((a) => a.startsWith("--engines="))?.slice(10) ?? "chromium,webkit").split(",");
const SHOTS = process.argv.find((a) => a.startsWith("--shots="))?.slice(8);

interface Seen {
  menu: { top: number; bottom: number; left: number; right: number };
  frame: { top: number; bottom: number; left: number; right: number };
  spill: number;
  rows: number;
}

const seen = (page: Page): Promise<Seen | null> =>
  page.evaluate(() => {
    const ul = document.querySelector(".thread-doc .doc-suggest");
    const feed = document.querySelector(".main .feed");
    if (!ul || !feed) return null;
    const box = (r: DOMRect) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) });
    const menu = ul.getBoundingClientRect();
    const spill = Math.max(0, ...[...ul.querySelectorAll("li")].map((li) => li.getBoundingClientRect().right - menu.right + 4));
    return { menu: box(menu), frame: box(feed.getBoundingClientRect()), spill: Math.round(spill), rows: ul.querySelectorAll("li").length };
  });

async function run(engine: string, browser: Browser, base: string): Promise<string[]> {
  const failures: string[] = [];
  for (const [label, width] of [
    ["wide", 1280],
    ["narrow", 760],
    ["tight", 620],
  ] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    await page.goto(base);
    await firstRun(page, `jow${engine}${label}`);
    await newChannel(page, `menu ${label}`);
    await page.setViewportSize({ width, height: 700 });
    await page.locator(".thread-doc .doc-tail").last().click();
    for (let i = 0; i < 16; i++) {
      await page.keyboard.type(`a line to fill the window ${i}`);
      await page.keyboard.press("ControlOrMeta+Enter");
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(800);
    await page.locator(".thread-doc .doc-tail").last().click();
    await page.keyboard.type("/");
    await page.locator(".thread-doc .doc-suggest").waitFor({ timeout: 5000 });
    await page.waitForTimeout(200);
    const s = await seen(page);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `slash-${engine}-${label}.png`) });
    const said = `${engine} ${label}: ${JSON.stringify(s)}`;
    const ok = !!s && s.rows > 0 && s.menu.top >= s.frame.top && s.menu.bottom <= s.frame.bottom && s.menu.right <= s.frame.right && s.menu.left >= s.frame.left && s.spill <= 1;
    console.log(`${ok ? "✓" : "✗"} ${said}`);
    if (!ok) failures.push(said);
    await page.keyboard.press("Escape");
    await page.close();
  }
  return failures;
}

const data = mkdtempSync(join(tmpdir(), "kiwi-slash-menu-"));
mkdirSync(join(data, "relay"));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const { relay, port } = await startLocalRelay(join(data, "relay"), harnessDist(), { rateLimits: false });
const failures: string[] = [];
try {
  for (const engine of ENGINES) {
    const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
    try {
      failures.push(...(await run(engine, browser, `http://127.0.0.1:${port}/`)));
    } finally {
      await browser.close();
    }
  }
} finally {
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`the doc's / menu left the window or spilled out of its box: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("the doc's / menu stays on screen and inside its box, in every engine");
