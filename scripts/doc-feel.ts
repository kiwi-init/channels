#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const dist = process.argv[2] ?? "ui/dist";
const keys = Number(process.env.DOC_FEEL_KEYS ?? 120);
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

interface Stats {
  median: number;
  p95: number;
  max: number;
}

const stats = (xs: number[]): Stats => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => Math.round((s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0) * 10) / 10;
  return { median: at(0.5), p95: at(0.95), max: at(1) };
};

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const opened = Date.now();
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${process.env.DOC_FEEL_SHOT ?? "thread-doc-1000"}`);
  await page.waitForFunction((n) => document.querySelectorAll(".thread-doc .blk").length >= n, Number(process.env.DOC_FEEL_MIN ?? 1000), { timeout: 30_000 });
  const openMs = Date.now() - opened;
  const blocks = await page.evaluate(() => document.querySelectorAll(".thread-doc .blk").length);

  await page.evaluate(() => {
    const w = window as unknown as { __lat: number[] };
    w.__lat = [];
    window.addEventListener(
      "keydown",
      () => {
        const t0 = performance.now();
        requestAnimationFrame(() => setTimeout(() => w.__lat.push(performance.now() - t0), 0));
      },
      true,
    );
  });
  await page.locator(".thread-doc .ProseMirror").focus();
  await page.keyboard.type("x".repeat(keys), { delay: 30 });
  await page.waitForTimeout(300);
  const typing = stats(await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat));

  const frames = await page.evaluate(async () => {
    const feed = document.querySelector<HTMLElement>(".feed");
    if (!feed) return [];
    const deltas: number[] = [];
    let last = performance.now();
    feed.scrollTop = feed.scrollHeight;
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      deltas.push(now - last);
      last = now;
      feed.scrollTop -= 160;
    }
    return deltas;
  });
  const scroll = stats(frames);
  const long = frames.filter((d) => d > 50).length;

  console.log(`blocks: ${blocks}, open to 1,000 blocks: ${openMs} ms`);
  console.log(`typing (${keys} keys, keydown to after paint): median ${typing.median} ms, p95 ${typing.p95} ms, max ${typing.max} ms`);
  console.log(`scroll (240 frames): median ${scroll.median} ms, p95 ${scroll.p95} ms, max ${scroll.max} ms, ${long} frames over 50 ms`);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.stop(true);
}
