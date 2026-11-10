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

const paletteOpen = (page: Page) => page.locator(".palette, [role='dialog'] [role='combobox'], dialog[open] [role='combobox']").first().isVisible();
const searching = (page: Page) =>
  page
    .locator(".top-tools.is-searching")
    .count()
    .then((n) => n > 0);
const sideShown = (page: Page) => page.locator(".side-row").first().isVisible();

async function keys(platform: "MacIntel" | "Linux x86_64"): Promise<void> {
  const mac = platform === "MacIntel";
  const on = mac ? "a Mac" : "Linux";
  const mine = mac ? "Meta" : "Control";
  const other = mac ? "Control" : "Meta";
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript((p) => Object.defineProperty(navigator, "platform", { get: () => p }), platform);
  page.on("pageerror", (e) => fails.push(`page threw on ${on}: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  await page.locator(".main article.msg").first().waitFor();
  const composer = page.locator(".main .composer textarea").first();
  const settle = () => page.waitForTimeout(250);

  await page.locator(".main article.msg").first().click();
  await page.keyboard.press(`${other}+k`);
  await settle();
  expect(!(await paletteOpen(page)), `on ${on}, ${other}+K does not open the palette`);
  await page.keyboard.press(`${mine}+k`);
  await settle();
  expect(await paletteOpen(page), `on ${on}, ${mine}+K opens the palette`);
  await page.keyboard.press(`${mine}+k`);
  await settle();
  expect(!(await paletteOpen(page)), `on ${on}, ${mine}+K closes it again`);

  await page.keyboard.press(`${other}+f`);
  await settle();
  expect(!(await searching(page)), `on ${on}, ${other}+F does not open search`);
  await page.keyboard.press(`${mine}+f`);
  await settle();
  expect(await searching(page), `on ${on}, ${mine}+F opens search`);
  await page.keyboard.press("Escape");
  await settle();
  if (await searching(page)) {
    await page.keyboard.press("Escape");
    await settle();
  }

  await page.locator(".rail .tile.is-add").click();
  const dialog = page.locator("dialog[open]").first();
  await dialog.waitFor();
  await page.keyboard.press(`${mine}+f`);
  await settle();
  expect(!(await searching(page)) && (await dialog.isVisible()), `on ${on}, ${mine}+F does nothing behind an open dialog`);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" }).catch(() => {});

  const shown = await sideShown(page);
  await page.locator(".main article.msg").first().click();
  await page.keyboard.press(`${other}+\\`);
  await settle();
  expect((await sideShown(page)) === shown, `on ${on}, ${other}+\\ leaves the sidebar as it is`);
  await page.keyboard.press(`${mine}+\\`);
  await settle();
  expect((await sideShown(page)) !== shown, `on ${on}, ${mine}+\\ hides or shows the sidebar`);
  await page.keyboard.press(`${mine}+\\`);
  await settle();

  const url = () => page.evaluate(() => location.href);
  await composer.click();
  await composer.fill("one\ntwo\nthree");
  await composer.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  const before = await url();
  await page.keyboard.press("Alt+ArrowDown");
  await settle();
  const caret = await composer.evaluate((el: HTMLTextAreaElement) => el.selectionStart);
  expect(caret > 0 && (await url()) === before, `on ${on}, Option/Alt+Down in the composer moves the caret (to ${caret}) and stays in the channel`);
  await composer.fill("");
  await page.close();
}

try {
  await keys("MacIntel");
  await keys("Linux x86_64");
} finally {
  await browser.close();
  server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nkeys: ok");
