#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { webkit, type Browser, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const MOVES_ALLOWED = 2;
const MOVE_PX = 4;
const KEYS = 40;
const KEY_MS = 120;
const LOOKS = 24;
const LOOK_MS = 250;

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
    await page.locator(".thread-doc .ProseMirror").first().click();
    await page.keyboard.press("Meta+ArrowDown");
    const ys: number[] = [];
    for (let i = 0; i < KEYS; i++) {
      await page.keyboard.type("a");
      await page.waitForTimeout(KEY_MS);
      const y = await page.evaluate(() => {
        const range = getSelection()?.rangeCount ? getSelection()?.getRangeAt(0) : null;
        const rect = range?.getClientRects()[0] ?? range?.startContainer.parentElement?.getBoundingClientRect();
        return rect ? Math.round(rect.top) : null;
      });
      if (y !== null) ys.push(y);
    }
    const n = moves(ys);
    return n <= MOVES_ALLOWED ? null : `the caret moved ${n} times in ${KEYS} keys: ${[...new Set(ys)].join(" → ")}`;
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
    await page.waitForTimeout(500);
    const ys: number[] = [];
    for (let i = 0; i < LOOKS; i++) {
      await page.waitForTimeout(LOOK_MS);
      ys.push(await page.evaluate(() => Math.round(document.querySelector(".thread-doc")?.getBoundingClientRect().top ?? -1)));
    }
    const n = moves(ys);
    return n <= MOVES_ALLOWED ? null : `the doc moved ${n} times in ${(LOOKS * LOOK_MS) / 1000} s: ${[...new Set(ys)].join(" → ")}`;
  } finally {
    await page.close();
  }
}

const browser = await webkit.launch();
let failed = 0;
try {
  for (const [what, check] of [
    ["the line you type in stays put while lines arrive", typing],
    ["the doc stays put while you read and lines arrive", watching],
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
  console.error(`${failed} doc checks moved the view on their own, in WebKit`);
  process.exitCode = 1;
}
