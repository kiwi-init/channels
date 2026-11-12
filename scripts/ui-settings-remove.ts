#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser } from "playwright-core";

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

async function run(browser: Browser): Promise<string | null> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=channel-settings`);
    await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length > 0, undefined, { timeout: 60_000, polling: "raf" });
    await page.waitForTimeout(1200);
    await page.locator("dialog[open]").getByRole("button", { name: "GitHub" }).click();
    await page.waitForTimeout(400);
    await page.locator("dialog[open] button[aria-label^='Remove']").first().click();
    await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 2, undefined, { timeout: 10_000, polling: "raf" });
    await page.locator("dialog[open] button.is-danger").click();
    await page.waitForTimeout(800);
    const open = await page.evaluate(() => [...document.querySelectorAll("dialog[open]")].map((d) => d.getAttribute("aria-label")));
    if (open.length !== 1 || open[0] !== "Channel settings") return `after Remove, open dialogs are [${open.join(", ")}]: the settings dialog must stay open on the GitHub tab`;
    const repos = await page.evaluate(() => [...(document.querySelector("dialog[open]")?.querySelectorAll(".cset-repo-name") ?? [])].map((n) => n.textContent?.trim()));
    if (repos.some((r) => r === "kiwi-init/channels")) return "the removed repo is still listed";
    return null;
  } finally {
    await page.close();
  }
}

const problems: string[] = [];
for (const one of [engine]) {
  const browser = one === "chromium" ? await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined }) : await webkit.launch();
  try {
    const bad = await run(browser);
    if (bad) problems.push(`${one}: ${bad}`);
    else console.log(`${one}: removing a repo keeps the settings dialog open on the GitHub tab`);
  } finally {
    await browser.close();
  }
}
server.stop(true);
if (problems.length) {
  for (const p of problems) console.error(`ui-settings-remove: ${p}`);
  process.exit(1);
}
