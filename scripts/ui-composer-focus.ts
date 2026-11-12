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

type Focus = { composer: boolean; value: string; caret: number | null; tag: string; label: string };
const focus = (page: Page): Promise<Focus> =>
  page.evaluate(() => {
    const el = document.activeElement;
    const area = el instanceof HTMLTextAreaElement ? el : null;
    return {
      composer: !!area && area.getAttribute("aria-label") === "Message" && !!area.closest("main"),
      value: area?.value ?? "",
      caret: area && area.selectionStart === area.selectionEnd ? area.selectionStart : null,
      tag: el?.tagName ?? "",
      label: el?.getAttribute("aria-label") ?? el?.textContent?.trim().slice(0, 30) ?? "",
    };
  });
const here = (page: Page) => page.locator('.side-row[aria-current="page"] .side-label, .side-row[aria-current="page"] .side-name').first().innerText();
const row = (page: Page, name: string) => page.locator(".side-row", { has: page.locator(".side-label, .side-name", { hasText: new RegExp(`^${name}$`) }) }).first();
const tile = (page: Page, name: string) => page.locator(".rail .tile", { has: page.locator(".tile-name", { hasText: new RegExp(`^${name}$`) }) }).first();
const settle = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  await row(page, "design").waitFor();

  await row(page, "design").click();
  await settle(page);
  let now = await focus(page);
  expect(now.composer, `room to room: clicking #design focuses its composer (focus on ${now.tag} ${now.label})`);
  await page.keyboard.type("design first");
  await row(page, "general").click();
  await settle(page);
  now = await focus(page);
  expect(now.composer && now.value === "", "room to room: #general's composer takes focus, empty, without #design's text");
  await page.keyboard.type("general words");
  await row(page, "design").click();
  await settle(page);
  now = await focus(page);
  expect(now.composer && now.value === "design first", "back in #design, its restored draft is there");
  expect(now.caret === "design first".length, `with the caret at its end, not selected (caret ${now.caret})`);
  await page.keyboard.type("!");
  expect((await focus(page)).value === "design first!", "and typing at once adds to the end of #design's draft");

  await row(page, "atlas").click();
  await settle(page);
  now = await focus(page);
  expect(now.composer && now.value === "", "room to DM: atlas's composer takes focus");
  await page.keyboard.type("to atlas");
  await row(page, "general").click();
  await settle(page);
  expect((await focus(page)).value === "general words", "each destination kept its own text: #general");
  await row(page, "atlas").click();
  await settle(page);
  expect((await focus(page)).value === "to atlas", "and atlas");

  await tile(page, "landing").click();
  await settle(page);
  now = await focus(page);
  expect(now.composer, `a channel switch from the rail focuses the writable conversation it opens (focus on ${now.tag} ${now.label})`);
  await page.keyboard.type("in landing");
  await tile(page, "kiwi").click();
  await settle(page);
  now = await focus(page);
  expect(now.composer && !now.value.includes("in landing"), "switching back focuses kiwi's composer, without landing's text");
  await tile(page, "landing").click();
  await settle(page);
  expect((await focus(page)).value === "in landing", "and landing kept what was typed there");
  await tile(page, "kiwi").click();
  await settle(page);

  await row(page, "general").focus();
  await page.keyboard.press("Enter");
  await settle(page);
  expect((await focus(page)).composer && (await here(page)) === "general", "Enter on a sidebar row opens it and focuses its composer");
  await row(page, "design").focus();
  await page.keyboard.press(" ");
  await settle(page);
  expect((await focus(page)).composer && (await here(page)) === "design", "so does Space");
  await row(page, "general").focus();
  await page.keyboard.press("Tab");
  await settle(page);
  now = await focus(page);
  expect(!now.composer && (await here(page)) === "design", `Tab only moves along the sidebar: nothing opens and the composer stays unfocused (focus on ${now.tag} ${now.label})`);

  await page.locator(".side-row.is-add[aria-expanded]").last().click();
  await page.locator(".side-row:has(.side-pair)").first().click();
  await settle(page);
  now = await focus(page);
  expect(now.tag !== "TEXTAREA", `a read-only conversation focuses no composer (focus on ${now.tag} ${now.label})`);
  await page.close();

  const live = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(live, (e) => fails.push(`page threw: ${e}`));
  await live.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  await row(live, "general").waitFor();
  await row(live, "general").click();
  await settle(live);
  expect((await focus(live)).composer, "opening #general focuses its composer");
  await live.keyboard.type("ping from the check");
  await live.evaluate(() => {
    const seen = { n: 0 };
    Object.assign(window, { seen });
    new MutationObserver((list) => (seen.n += list.length)).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  });
  await live.keyboard.press("Enter");
  await live.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await live.waitForTimeout(1500);
  const changes = await live.evaluate(() => ("seen" in window && typeof window.seen === "object" && window.seen && "n" in window.seen ? Number(window.seen.n) : 0));
  now = await focus(live);
  expect(changes > 0 && (await live.locator(".msg-body", { hasText: "ping from the check" }).count()) > 0, `the sent message arrived and the feed re-rendered (${changes} changes)`);
  expect(!now.composer, `the arrival and its update didn't pull focus back into the composer (focus on ${now.tag} ${now.label})`);
  await row(live, "general").click();
  await settle(live);
  await live.keyboard.type("a draft");
  await live.getByRole("button", { name: /^Search/ }).click();
  await live.locator(".top-find input").first().waitFor();
  await live.waitForTimeout(1200);
  now = await focus(live);
  expect(now.tag === "INPUT" && !now.composer, `with search open, draft sync and re-renders leave focus in search (focus on ${now.tag} ${now.label})`);
  await live.close();

  const touch = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const tap = await touch.newPage();
  await pageErrors(tap, (e) => fails.push(`page threw: ${e}`));
  await tap.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  await row(tap, "design").waitFor();
  expect(await tap.evaluate(() => matchMedia("(pointer: coarse)").matches), "the touch page reports a coarse pointer");
  await row(tap, "design").tap();
  await settle(tap);
  now = await focus(tap);
  expect((await here(tap)) === "design" && now.tag !== "TEXTAREA", `with a coarse pointer, opening #design opens no keyboard: the composer isn't focused (focus on ${now.tag} ${now.label})`);
  await tile(tap, "landing").tap();
  await settle(tap);
  expect((await focus(tap)).tag !== "TEXTAREA", "nor does a channel switch");
  await touch.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
