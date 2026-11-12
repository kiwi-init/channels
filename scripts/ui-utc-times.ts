#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--chromium") ? "chromium" : "webkit";

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const SENT = "probe standup 06:30Z, review 2030-01-16T01:15:00Z, plain 06:30 stays, `07:00Z` too, 25:00Z wrong";

const tipShown = (page: Page) =>
  page.waitForFunction(
    () => {
      const zone = document.querySelector<HTMLAnchorElement>('a[href^="kiwi-utc:"]');
      if (!zone) return false;
      const after = getComputedStyle(zone, "::after");
      return after.opacity === "1" && after.content !== "none" && after.content !== '""' && after.content !== "normal";
    },
    { timeout: 10_000, polling: "raf" },
  );

async function run(browser: Browser): Promise<string | null> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=specs-general`);
    await page.waitForSelector(".composer textarea, .composer [contenteditable]", { timeout: 60_000 });
    await page.waitForTimeout(800);
    const box = page.locator(".composer textarea, .composer [contenteditable]").first();
    await box.click();
    await page.keyboard.type(SENT);
    await page.keyboard.press("Enter");
    await page.waitForSelector('a[href^="kiwi-utc:"]', { timeout: 30_000 });
    await page.waitForTimeout(600);

    const zones = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('a[href^="kiwi-utc:"]')].map((a) => ({ text: a.textContent ?? "", local: a.dataset.local ?? "" })));
    if (zones.length !== 2) return `${zones.length} zoned times were recognized; exactly 06:30Z and the full timestamp should be`;
    if (!zones.every((z) => z.text === "06:30Z" || z.text === "2030-01-16T01:15:00Z")) return `a recognized time changed its text: ${zones.map((z) => z.text).join(", ")}`;
    if (!zones.every((z) => /^\d\d?:\d\d\b/.test(z.local) && z.local.includes(" "))) return `a local time tooltip shows no local time with its zone: ${zones.map((z) => z.local).join(" | ")}`;
    if (!zones.some((z) => z.local.includes("assuming"))) return "the time-only token's tooltip never says its assumed date";

    await page.locator('a[href^="kiwi-utc:"]').first().hover();
    try {
      await tipShown(page);
    } catch {
      return "hovering a zoned time leaves its local time hidden";
    }

    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.evaluate(() => document.querySelector<HTMLAnchorElement>('a[href^="kiwi-utc:"]')?.focus());
    if (!(await page.evaluate(() => document.activeElement?.matches('a[href^="kiwi-utc:"]') ?? false))) return "a zoned time can't take keyboard focus";
    try {
      await tipShown(page);
    } catch {
      return "keyboard focus on a zoned time leaves its local time hidden";
    }

    const pressed = page.locator('a[href^="kiwi-utc:"]').first();
    await pressed.hover();
    await page.mouse.down();
    const held = await page.evaluate(() => {
      const zone = document.querySelector<HTMLAnchorElement>('a[href^="kiwi-utc:"]');
      return zone ? getComputedStyle(zone, "::after").opacity : "0";
    });
    await page.mouse.up();
    if (held !== "1") return "pressing a zoned time leaves its local time hidden";

    const copied = await page.evaluate(() => {
      const zone = document.querySelector('a[href^="kiwi-utc:"]');
      const block = zone?.closest("p, li, td, .md") ?? null;
      if (!block) return "";
      const range = document.createRange();
      range.selectNodeContents(block);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? "";
    });
    if (!copied.includes("06:30Z") || !copied.includes("2030-01-16T01:15:00Z")) return "copying the message loses the original times";
    const stripped = copied.replaceAll("06:30Z", "").replaceAll("2030-01-16T01:15:00Z", "");
    if (/GMT|assuming/.test(stripped)) return `copying the message drags the tooltip along: ${copied.slice(0, 120)}`;
    return null;
  } finally {
    await page.close();
  }
}

const problems: string[] = [];
const browser = engine === "chromium" ? await chromium.launch() : await webkit.launch();
try {
  const bad = await run(browser);
  if (bad) problems.push(`${engine}: ${bad}`);
  else console.log(`${engine}: a UTC time in chat prose names its local time on hover, keyboard focus and press, and copying keeps the original text`);
} finally {
  await browser.close();
}
server.stop(true);
if (problems.length) {
  for (const p of problems) console.error(`ui-utc-times: ${p}`);
  process.exit(1);
}
