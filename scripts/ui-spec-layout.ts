#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { webkit, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const FILLS = 0.95;
const COMMENTS_PX = 400;
const LONG = "This reads fine, but the export should say which board it came from, and the date, so a file in someone's downloads still makes sense next week. ".repeat(3);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

async function layout(page: Page): Promise<string | null> {
  const got = await page.evaluate(() => {
    const pageEl = document.querySelector<HTMLElement>(".spec-page")!;
    const wrap = document.querySelector<HTMLElement>(".spec-doc-wrap")!;
    const rail = wrap.querySelector<HTMLElement>(".spec-rail");
    const pad = parseFloat(getComputedStyle(pageEl).paddingLeft) + parseFloat(getComputedStyle(pageEl).paddingRight);
    return { room: pageEl.clientWidth - pad, used: wrap.getBoundingClientRect().width, comments: rail?.getBoundingClientRect().width ?? 0 };
  });
  const fill = got.used / got.room;
  if (fill < FILLS) return `the spec and its comments use ${Math.round(got.used)} of ${Math.round(got.room)} px, leaving empty margins`;
  if (got.comments < COMMENTS_PX) return `the comments column is ${Math.round(got.comments)} px wide`;
  return null;
}

async function grows(page: Page): Promise<string | null> {
  const box = page.getByLabel("Comment on the spec");
  await box.click();
  const before = await box.boundingBox();
  await page.keyboard.type(LONG);
  await page.waitForTimeout(400);
  const after = await box.boundingBox();
  if (!before || !after) return "no comment box on screen";
  if (Math.abs(after.y - before.y) > 4) return `the comment box moved from y ${Math.round(before.y)} to ${Math.round(after.y)} while it grew`;
  return after.height > before.height * 2 ? null : `the comment box stayed ${Math.round(after.height)} px high (was ${Math.round(before.height)}) with a comment that wraps over several lines`;
}

const browser = await webkit.launch();
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.port}/?shot=spec-draft`);
  await page.waitForSelector(".spec-doc-wrap.is-wide", { timeout: 15_000 });
  await page.waitForTimeout(500);
  for (const [what, check] of [
    ["a wide window goes to the spec and its comments, not to empty margins", layout],
    ["the comment box grows in place as a long comment wraps", grows],
  ] as const) {
    const why = await check(page);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} spec-draft at 1900x1000: ${what}${why ? `: ${why}` : ""}`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} spec page checks failed, in WebKit`);
  process.exitCode = 1;
}
