import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

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

interface Top {
  seq: number;
  offset: number;
}

const topRow = (page: Page): Promise<Top | null> =>
  page.evaluate(() => {
    const box = document.querySelector<HTMLElement>(".feed");
    const list = document.querySelector<HTMLElement>(".feed-list");
    if (!box || !list) return null;
    const top = box.getBoundingClientRect().top;
    for (const row of list.querySelectorAll<HTMLElement>(":scope > [data-seq]")) {
      const r = row.getBoundingClientRect();
      if (r.bottom > top) return { seq: Number(row.dataset.seq), offset: Math.round(r.top - top) };
    }
    return null;
  });

const near = (a: Top | null, b: Top | null): boolean => !!a && !!b && a.seq === b.seq && Math.abs(a.offset - b.offset) <= 2;
const settle = (page: Page, ms = 400) => page.waitForTimeout(ms);
const room = (page: Page) => page.locator('section[aria-label="Rooms"] [aria-current="page"] .side-label').innerText();
const visible = (page: Page, seq: number) =>
  page.evaluate((s) => {
    const box = document.querySelector<HTMLElement>(".feed")?.getBoundingClientRect();
    const row = document.querySelector<HTMLElement>(`.feed-list > [data-seq="${s}"]`)?.getBoundingClientRect();
    return !!box && !!row && row.bottom > box.top && row.top < box.bottom;
  }, seq);

async function search(page: Page, words: string, hit: string) {
  await page.getByRole("button", { name: /Search this channel/ }).click();
  await page.getByRole("combobox", { name: "Search this channel" }).fill(words);
  const option = page.locator(".search-item").filter({ hasText: hit }).first();
  await option.waitFor();
  await option.click();
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));

  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  await page.locator("article.msg").first().waitFor();
  expect((await room(page)) === "general", "a channel with nothing remembered opens #general");
  await page.locator('section[aria-label="Rooms"] button').filter({ hasText: "design" }).click();
  await page.getByRole("button", { name: "Specs" }).click();
  await settle(page, 700);
  await page.reload();
  await page.getByRole("button", { name: "Specs" }).waitFor();
  expect((await page.getByRole("button", { name: "Specs" }).getAttribute("aria-pressed")) === "true", "a restart reopens the tab you were on");
  await page.getByRole("button", { name: "# design" }).click();
  expect((await room(page)) === "design", "and the room you were in");

  await search(page, "Wayland fixes", "2026.10.6 is out");
  await page.locator(".is-flash").first().waitFor();
  expect((await room(page)) === "releases", "a search hit in another room opens that room");
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await settle(page);
  expect((await room(page)) === "design", "⌘[ goes back to the room you searched from");
  await page.keyboard.press("ControlOrMeta+BracketRight");
  await settle(page);
  expect((await room(page)) === "releases", "⌘] goes forward to the hit's room again");

  await page.goto(`http://127.0.0.1:${server.port}/?shot=long-feed`);
  await page.locator("article.msg").first().waitFor();
  await settle(page);
  await page.locator(".feed").evaluate((el) => {
    el.scrollTop = Math.max(0, el.scrollTop - 2600);
  });
  await settle(page, 700);
  const spot = await topRow(page);
  expect(!!spot, "the long feed has a top row to measure");
  await page.reload();
  await page.locator("article.msg").first().waitFor();
  await settle(page);
  const after = await topRow(page);
  expect(near(after, spot), `a restart brings the scroll back to the same message (${JSON.stringify(spot)} → ${JSON.stringify(after)})`);

  await search(page, "sidebar flickers", "sidebar flickers");
  const flashed = page.locator(".feed-list > .is-flash").first();
  await flashed.waitFor();
  const hit = Number(await flashed.getAttribute("data-seq"));
  await settle(page);
  expect(!near(await topRow(page), spot), "a search hit in the same room moves the feed");
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await settle(page);
  const back = await topRow(page);
  expect(near(back, spot), `⌘[ undoes a jump inside the room, back to where you were reading (${JSON.stringify(spot)} → ${JSON.stringify(back)})`);
  await page.keyboard.press("ControlOrMeta+BracketRight");
  await settle(page);
  expect(await visible(page, hit), "⌘] shows the hit again");
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await settle(page);
  await page.getByRole("combobox", { name: "Search this channel" }).focus();
  await page.keyboard.press("ControlOrMeta+BracketRight");
  await settle(page);
  expect(await visible(page, hit), "⌘] works from inside a text box too");
  await context.close();
} finally {
  await browser.close();
  void server.stop(true);
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nrestore and back/forward hold");
