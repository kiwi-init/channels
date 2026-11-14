#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser } from "playwright-core";

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

async function moves(browser: Browser, shot: string, width: number, height: number): Promise<string | null> {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
    await page.waitForSelector(".feed", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await page
      .waitForFunction(() => !document.querySelector(".feed .md-plain"), undefined, { timeout: DRAWN_MS })
      .catch(() => {
        // A row whose markdown never parses keeps its plain text for good; the frames below still say whether the view moves.
      });
    await page.waitForTimeout(SETTLE_MS);
    return await page.evaluate(
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
  } finally {
    await page.close();
  }
}

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
let failed = 0;
try {
  for (const shot of SHOTS)
    for (const [width, height] of SIZES) {
      const why = await moves(browser, shot, width, height);
      if (why) failed++;
      console.log(`${why ? "✗" : "✓"} ${shot} at ${width}x${height} holds still after opening${why ? `: ${why}` : ""}`);
    }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} views kept scrolling after they opened, in ${engine}`);
  process.exitCode = 1;
}
