#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "chromium";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

const place = (page: Page): Promise<string> => page.evaluate(() => document.querySelector(".side [aria-current='page']")?.querySelector(".side-label, .side-name")?.textContent?.trim() ?? "");
const profile = (page: Page): Promise<boolean> => page.evaluate(() => !!document.querySelector("dialog[open]"));
const settle = (page: Page) => page.waitForTimeout(500);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  await page.locator("article.msg").first().waitFor();
  await page.waitForTimeout(1200);
  const room = await place(page);
  const mentions = page.locator('article.msg .msg-text a[href^="kiwi-mention:"]').filter({ visible: true });
  const count = await mentions.count();
  expect(count > 0, `the demo channel's feed has mentions to click (${count})`);
  let opened = "";
  for (let i = 0; i < count && !opened; i++) {
    const clicked = await mentions
      .nth(i)
      .click({ timeout: 5000 })
      .then(
        () => true,
        () => false,
      );
    if (!clicked) continue;
    await settle(page);
    if (await profile(page)) {
      await page.keyboard.press("Escape");
      await settle(page);
      continue;
    }
    const now = await place(page);
    if (now && now !== room) opened = now;
  }
  expect(opened !== "", `a click on a mention of someone else opens the direct conversation with them (from ${room} to ${opened || "nowhere"})`);
  expect(!(await profile(page)), "and no profile opens on the way");
  await page.goto(`http://127.0.0.1:${server.port}/?shot=dm`);
  await page.locator("article.msg").first().waitFor();
  await page.waitForTimeout(1200);
  const dm = await place(page);
  const names = page.locator("article.msg .msg-name").filter({ visible: true });
  const shown = await names.allInnerTexts();
  const at = shown.findIndex((n) => n.trim() === dm);
  expect(at >= 0, `the demo direct conversation with ${dm} shows their name on a message (${shown.join(", ")})`);
  if (at >= 0) {
    await names.nth(at).click({ timeout: 5000 });
    await settle(page);
    expect(await profile(page), "inside the conversation with someone, a click on their name opens their profile");
    await page.keyboard.press("Escape");
    await settle(page);
    expect((await place(page)) === dm, `and the conversation stays where it was (${await place(page)})`);
  }
} finally {
  await browser.close();
  void server.stop(true);
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\na click on a person goes to the conversation, and to the profile from inside it");
