import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
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

const settle = (page: Page, ms = 400) => page.waitForTimeout(ms);
const room = (page: Page) => page.locator('section[aria-label="Rooms"] [aria-current="page"] .side-label').innerText();
const visible = (page: Page, seq: number) =>
  page.evaluate((s) => {
    const box = document.querySelector<HTMLElement>(".feed")?.getBoundingClientRect();
    const row = document.querySelector<HTMLElement>(`.feed-list > [data-seq="${s}"]`)?.getBoundingClientRect();
    return !!box && !!row && row.bottom > box.top && row.top < box.bottom;
  }, seq);
const copied = (page: Page) => page.evaluate(() => (window as Window & { copied?: string[] }).copied?.at(-1) ?? "");
const toBottom = (page: Page) =>
  page.locator(".feed").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

async function olderMessage(page: Page): Promise<{ seq: number; text: string }> {
  for (let i = 0; i < 4; i++) {
    await page.locator(".feed").evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollTop - 1500);
    });
    await settle(page, 300);
  }
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>(".feed")!.getBoundingClientRect();
    for (const row of document.querySelectorAll<HTMLElement>(".feed-list > [data-seq]")) {
      const r = row.getBoundingClientRect();
      const text = row.querySelector<HTMLElement>(".msg-text")?.innerText.trim() ?? "";
      if (r.top > box.top + 40 && r.bottom < box.bottom && row.matches("article.msg") && text.length > 12) return { seq: Number(row.dataset.seq), text };
    }
    throw new Error("no whole message on screen");
  });
}

async function run() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    const kept: string[] = [];
    (window as Window & { copied?: string[] }).copied = kept;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          kept.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  const page = await context.newPage();
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=long-feed`);
  await page.locator("article.msg").first().waitFor();
  await settle(page);

  const older = await olderMessage(page);
  await page.locator(`.feed-list > [data-seq="${older.seq}"] .msg-text`).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy link to message" }).click();
  const link = await copied(page);
  const at = /^kiwi:\/\/join\/([A-Za-z0-9_-]+)\?m=(\d+)$/.exec(link);
  expect(!!at && Number(at[2]) === older.seq, `Copy link to message copies the message's address (${link})`);
  expect(!link.includes(older.text.slice(0, 12)), "and none of its text");
  const code = at?.[1] ?? "";

  await toBottom(page);
  await settle(page);
  expect(!(await visible(page, older.seq)), "the linked message is off screen once the feed is back at the bottom");
  await page.locator('.side-row:has-text("atlas")').first().click();
  await page.getByRole("textbox", { name: "Message" }).fill(`back to ${link} please`);
  await page.keyboard.press("Enter");
  const pasted = page
    .locator(".msg-text a")
    .filter({ hasText: `message #${older.seq}` })
    .last();
  await pasted.waitFor();
  expect((await pasted.getAttribute("href")) === link, "a pasted link shows as the message's number and keeps the link");
  await pasted.click();
  await page.locator(`.feed-list > .is-flash[data-seq="${older.seq}"]`).waitFor();
  await settle(page);
  expect((await room(page)) === "general" && (await visible(page, older.seq)), "clicking it jumps to the message in its room");
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await settle(page);
  expect(!(await visible(page, older.seq)), "⌘[ goes back to where you were reading");

  await page.locator('section[aria-label="Rooms"] button').filter({ hasText: "design" }).click();
  await settle(page);
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#${code}?m=${older.seq}`);
  await page.locator(`.feed-list > .is-flash[data-seq="${older.seq}"]`).waitFor();
  await settle(page);
  expect((await room(page)) === "general" && (await visible(page, older.seq)), "a link opened from outside goes to the message's room and shows it");
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await settle(page);
  expect((await room(page)) === "design", "⌘[ goes back to the room the link was opened from");
  await context.close();
}

try {
  await run();
} finally {
  await browser.close();
  void server.stop(true);
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nmessage links copy and open");
