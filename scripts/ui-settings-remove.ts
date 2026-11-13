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

const openDialogs = (page: Page) => page.evaluate(() => [...document.querySelectorAll("dialog[open]")].map((d) => d.getAttribute("aria-label")));
const repos = (page: Page) =>
  page.evaluate(() => [...(document.querySelector("dialog[open]")?.querySelectorAll(".ctl-label") ?? [])].map((n) => n.textContent?.trim() ?? "").filter((label) => /^[\w.-]+\/[\w.-]+$/.test(label)));
const settingsStays = async (page: Page, what: string, want: string[]): Promise<string | null> => {
  await page.waitForTimeout(400);
  const open = await openDialogs(page);
  if (open.length !== 1 || open[0] !== "Channel settings") return `${what}: open dialogs are [${open.join(", ")}]: the settings dialog must stay open`;
  const got = await repos(page);
  if (want.some((r) => !got.includes(r))) return `${what}: repos are [${got.join(", ")}]: the GitHub tab must still list [${want.join(", ")}]`;
  return null;
};

async function run(browser: Browser): Promise<string | null> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=channel-settings`);
    await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length > 0, undefined, { timeout: 60_000, polling: "raf" });
    await page.waitForTimeout(1200);
    await page.locator("dialog[open]").getByRole("button", { name: "GitHub" }).click();
    await page.waitForTimeout(400);
    const both = ["kiwi-init/channels", "kiwi-init/electrobun-livewire"];

    await page.locator("dialog[open] button[aria-label^='Remove']").first().click();
    await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 2, undefined, { timeout: 10_000, polling: "raf" });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    let bad = await settingsStays(page, "cancelling the repo confirm", both);
    if (bad) return bad;

    await page.locator("dialog[open] button[aria-label^='Remove']").first().click();
    await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 2, undefined, { timeout: 10_000, polling: "raf" });
    await page.keyboard.press("Escape");
    bad = await settingsStays(page, "escaping the repo confirm", both);
    if (bad) return bad;

    await page.locator("dialog[open] button[aria-label^='Remove']").first().click();
    await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 2, undefined, { timeout: 10_000, polling: "raf" });
    await page.locator("dialog[open] button.is-danger").click();
    bad = await settingsStays(page, "confirming the repo's Remove", ["kiwi-init/electrobun-livewire"]);
    if (bad) return bad;
    const after = await repos(page);
    if (after.includes("kiwi-init/channels")) return "the removed repo is still listed";

    await page.locator("dialog[open]").getByRole("button", { name: "General" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /Delete channel/ }).click();
    await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 2, undefined, { timeout: 10_000, polling: "raf" });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    bad = await settingsStays(page, "cancelling the delete-channel confirm", []);
    if (bad) return bad;

    await page.getByRole("dialog", { name: "Channel settings" }).getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForTimeout(400);
    const shut = await openDialogs(page);
    if (shut.length !== 0) return `after the settings dialog's own Close, open dialogs are [${shut.join(", ")}]`;
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
    else console.log(`${one}: the repo confirm closes only itself, by Remove, Cancel and Escape, and the settings dialog still closes on its own`);
  } finally {
    await browser.close();
  }
}
server.stop(true);
if (problems.length) {
  for (const p of problems) console.error(`ui-settings-remove: ${p}`);
  process.exit(1);
}
