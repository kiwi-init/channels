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

async function fresh(shot: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  return page;
}

async function roomsAndTabs() {
  const page = await fresh("channel");
  await page.locator("article.msg").first().waitFor();
  expect((await room(page)) === "general", "a channel with nothing remembered opens #general");
  await page.locator('section[aria-label="Rooms"] button').filter({ hasText: "design" }).click();
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: /Specs/ }).click();
  await settle(page, 700);
  await page.reload();
  const chat = page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "# design" });
  await chat.waitFor();
  expect((await chat.getAttribute("aria-pressed")) === "true", "a restart reopens the channel on its chat, not on the tab you left (T1833)");
  expect((await room(page)) === "design", "in the room you were in");

  await search(page, "Wayland fixes", "2026.10.6 is out");
  await page.locator(".is-flash").first().waitFor();
  expect((await room(page)) === "releases", "a search hit in another room opens that room");
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await settle(page);
  expect((await room(page)) === "design", "⌘[ goes back to the room you searched from");
  await page.keyboard.press("ControlOrMeta+BracketRight");
  await settle(page);
  expect((await room(page)) === "releases", "⌘] goes forward to the hit's room again");
  await page.context().close();
}

async function scroll() {
  const page = await fresh("long-feed");
  await page.locator("article.msg").first().waitFor();
  await settle(page);
  const opened = await topRow(page);
  for (let i = 0; i < 4; i++) {
    await page.locator(".feed").evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollTop - 1500);
    });
    await settle(page, 300);
  }
  await settle(page, 700);
  const spot = await topRow(page);
  expect(!!spot && !near(spot, opened), `the long feed scrolls up to a spot of its own (${JSON.stringify(opened)} → ${JSON.stringify(spot)})`);
  await page.reload();
  await page.locator("article.msg").first().waitFor();
  await settle(page, 1200);
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
  await page.context().close();
}

const MARKDOWN_LATE_MS = 1500;

const heights = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, { h: number; plain: boolean }> = {};
    for (const row of document.querySelectorAll<HTMLElement>(".feed-list > [data-seq]"))
      out[row.dataset.seq ?? ""] = { h: row.getBoundingClientRect().height, plain: !!row.querySelector(".md-plain") };
    return out;
  });

const markdownLate = (page: Page) =>
  page.route(/\/markdown-[^/]*\.js$/, async (route) => {
    await page.waitForTimeout(MARKDOWN_LATE_MS);
    await route.continue();
  });

async function plainFirst() {
  const page = await fresh("long-feed");
  await page.locator("article.msg").first().waitFor();
  await settle(page);
  for (let i = 0; i < 4; i++) {
    await page.locator(".feed").evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollTop - 1500);
    });
    await settle(page, 300);
  }
  await settle(page, 700);
  const full = await heights(page);
  await markdownLate(page);
  await page.reload();
  await page.locator("article.msg").first().waitFor();
  const plain = await heights(page);
  const row = Object.entries(full)
    .map(([seq, md]) => ({ seq: Number(seq), md: md.h, plain: plain[seq] }))
    .find((r) => r.seq >= 2000 && r.plain?.plain && r.plain.h + 12 < r.md);
  expect(!!row, `a message in the long feed is shorter as plain text than as markdown (${JSON.stringify(row)})`);
  if (!row?.plain) return void (await page.context().close());
  await settle(page, MARKDOWN_LATE_MS + 700);
  const offset = -Math.round((row.plain.h + row.md) / 2);
  await page.locator(".feed").evaluate(
    (el, { seq, offset }) => {
      const at = el.querySelector<HTMLElement>(`.feed-list > [data-seq="${seq}"]`);
      if (at) el.scrollTop += at.getBoundingClientRect().top - el.getBoundingClientRect().top - offset;
    },
    { seq: row.seq, offset },
  );
  await settle(page, 700);
  const spot = await topRow(page);
  expect(spot?.seq === row.seq, `the feed rests on a message whose plain text ends above the top (${JSON.stringify(row)} → ${JSON.stringify(spot)})`);
  await page.reload();
  await page.locator("article.msg").first().waitFor();
  await settle(page, MARKDOWN_LATE_MS + 1200);
  const after = await topRow(page);
  expect(near(after, spot), `a restart that paints plain text before markdown still lands on the same message (${JSON.stringify(spot)} → ${JSON.stringify(after)})`);
  await page.context().close();
}

const BELOW_THE_ASK = 125;

async function belowTheAsk() {
  const page = await fresh("long-feed");
  await page.locator("article.msg").first().waitFor();
  await settle(page, 1500);
  await page.locator(".feed").evaluate((el, seq) => {
    const row = el.querySelector<HTMLElement>(`.feed-list > [data-seq="${seq}"]`);
    if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top + Math.round(row.getBoundingClientRect().height * 0.6);
  }, BELOW_THE_ASK);
  await settle(page, 700);
  const spot = await topRow(page);
  expect(spot?.seq === BELOW_THE_ASK, `the feed rests on the question just below the permission ask (${JSON.stringify(spot)})`);
  await page.reload();
  await page.locator("article.msg").first().waitFor();
  await settle(page, 1500);
  const after = await topRow(page);
  expect(near(after, spot), `a restart onto the message below the permission ask lands on that message once the cards settle (${JSON.stringify(spot)} → ${JSON.stringify(after)})`);

  await page.reload();
  await page.locator("article.msg").first().waitFor();
  const feed = await page.locator(".feed").boundingBox();
  if (feed) await page.mouse.move(feed.x + feed.width / 2, feed.y + feed.height / 2);
  await page.mouse.wheel(0, -600);
  await settle(page, 1500);
  const wheeled = await topRow(page);
  await settle(page, 700);
  const still = await topRow(page);
  expect(
    !!wheeled && !!spot && wheeled.seq < spot.seq && near(still, wheeled),
    `a wheel while the cards are still settling takes the feed away from the restored spot, and it stays there (${JSON.stringify(spot)} → ${JSON.stringify(wheeled)} → ${JSON.stringify(still)})`,
  );
  await page.context().close();
}

try {
  await roomsAndTabs();
  await scroll();
  await plainFirst();
  await belowTheAsk();
} finally {
  await browser.close();
  void server.stop(true);
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nrestore and back/forward hold");
