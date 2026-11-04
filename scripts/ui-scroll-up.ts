#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { webkit, type Browser } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const FIRST_SEQ = 101;
const SIZES = [
  [1440, 900],
  [900, 1400],
  [420, 800],
] as const;
const WHEELS = 40;
const STEP_MS = 300;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

async function climb(browser: Browser, width: number, height: number): Promise<string | null> {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=event-runs`);
    await page.waitForSelector(".feed [data-seq]", { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const first = () => page.evaluate(() => Number(document.querySelector<HTMLElement>(".feed [data-seq]")?.dataset.seq));
    const box = await page.locator(".feed").first().boundingBox();
    if (!box) return "no feed on screen";
    const opened = await first();
    let seen = opened;
    for (let i = 0; i < WHEELS && seen > FIRST_SEQ; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -box.height * 1.5);
      await page.waitForTimeout(STEP_MS);
      seen = Math.min(seen, await first());
    }
    return seen <= FIRST_SEQ ? null : `opened at #${opened}, stopped loading at #${seen} after ${WHEELS} wheels up`;
  } finally {
    await page.close();
  }
}

const browser = await webkit.launch();
let failed = 0;
try {
  for (const [width, height] of SIZES) {
    const why = await climb(browser, width, height);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} event-runs at ${width}x${height} loads back to its first row while scrolling up${why ? `: ${why}` : ""}`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} sizes stopped loading before the top of the event-runs feed, in WebKit`);
  process.exitCode = 1;
}
