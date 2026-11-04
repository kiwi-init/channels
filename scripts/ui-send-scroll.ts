#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { firstRun, newChannel } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";

interface View {
  top: number;
  bottom: number;
}

const view = (page: Page): Promise<View> =>
  page.evaluate(() => {
    const box = document.querySelector(".main .feed");
    if (!box) throw new Error("no feed");
    return { top: box.scrollTop, bottom: box.scrollHeight - box.clientHeight - box.scrollTop };
  });

const data = mkdtempSync(join(tmpdir(), "kiwi-send-scroll-"));
mkdirSync(join(data, "relay"));
const { relay, port } = await startLocalRelay(join(data, "relay"), harnessDist(), { rateLimits: false });
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const failures: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await firstRun(page, "jow");
  await newChannel(page, "scroll");
  await page.locator(".thread-doc .doc-tail").last().click();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.type(`seed message ${i}`);
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(1000);
  for (const mode of ["bottom", "up", "multiline"] as const) {
    await page.locator(".thread-doc .doc-tail").last().click();
    await page.keyboard.type(`measured ${mode}`);
    if (mode === "multiline")
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Enter");
        await page.keyboard.type(`line ${i}`);
      }
    if (mode === "up") await page.evaluate(() => document.querySelector(".main .feed")?.scrollBy({ top: -350 }));
    await page.waitForTimeout(300);
    const before = await view(page);
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(1000);
    const after = await view(page);
    const kept = before.bottom <= 2 ? after.bottom <= 2 : Math.abs(after.top - before.top) <= 2;
    const said = `${mode}: scrollTop ${Math.round(before.top)} → ${Math.round(after.top)}, ${Math.round(before.bottom)} → ${Math.round(after.bottom)}px below the view`;
    console.log(`${kept ? "✓" : "✗"} ${said}`);
    if (!kept) failures.push(said);
  }
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`sending moved the view: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("sending keeps the view where it was");
