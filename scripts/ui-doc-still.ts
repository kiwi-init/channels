#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const MOVES_ALLOWED = 0;
const MOVE_PX = 4;
const KEYS = 40;
const KEY_MS = 120;
const LOOKS = 24;
const LOOK_MS = 250;
const READ_UP = 200;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

async function open(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.port}/?shot=thread-doc-busy`);
  await page.waitForSelector(".thread-doc .ProseMirror", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  return page;
}

function moves(ys: readonly number[]): number {
  return ys.slice(1).filter((y, i) => Math.abs(y - (ys[i] ?? y)) > MOVE_PX).length;
}

async function typing(browser: Browser): Promise<string | null> {
  const page = await open(browser);
  try {
    await page.locator(".main .composer textarea").first().click();
    const ys: number[] = [];
    for (let i = 0; i < KEYS; i++) {
      await page.keyboard.type("a");
      await page.waitForTimeout(KEY_MS);
      const y = await page.evaluate(
        () =>
          new Promise<number | null>((done) =>
            requestAnimationFrame(() =>
              setTimeout(() => {
                const area = document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
                done(area ? Math.round(area.getBoundingClientRect().top) : null);
              }, 0),
            ),
          ),
      );
      if (y !== null) ys.push(y);
    }
    const n = moves(ys);
    return ys.length < KEYS
      ? `the composer lost the focus after ${ys.length} of ${KEYS} keys`
      : n <= MOVES_ALLOWED
        ? null
        : `the composer moved ${n} times in ${KEYS} keys: ${[...new Set(ys)].join(" → ")}`;
  } finally {
    await page.close();
  }
}

async function watching(browser: Browser): Promise<string | null> {
  const page = await open(browser);
  try {
    const box = await page.locator(".feed").first().boundingBox();
    if (!box) return "no feed on screen";
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, -READ_UP);
    await page.waitForTimeout(500);
    const ys: number[] = [];
    for (let i = 0; i < LOOKS; i++) {
      await page.waitForTimeout(LOOK_MS);
      ys.push(
        await page.evaluate(
          () => new Promise<number>((done) => requestAnimationFrame(() => setTimeout(() => done(Math.round(document.querySelector(".thread-doc")?.getBoundingClientRect().top ?? -1)), 0))),
        ),
      );
    }
    const n = moves(ys);
    return n <= MOVES_ALLOWED ? null : `the doc moved ${n} times in ${(LOOKS * LOOK_MS) / 1000} s: ${[...new Set(ys)].join(" → ")}`;
  } finally {
    await page.close();
  }
}

const engine = process.argv.includes("--chromium") ? "chromium" : "webkit";
const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
let failed = 0;
try {
  for (const [what, check] of [
    ["the composer you type in stays put while lines arrive", typing],
    ["the doc stays put while you read a little above the bottom and lines arrive", watching],
  ] as const) {
    const why = await check(browser);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} thread-doc-busy: ${what}${why ? `: ${why}` : ""}`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} doc checks moved the view on their own, in ${engine === "webkit" ? "WebKit" : "Chromium"}`);
  process.exitCode = 1;
}
