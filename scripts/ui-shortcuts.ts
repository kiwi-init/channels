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

const settle = (page: Page, ms = 300) => page.waitForTimeout(ms);
const sheet = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });
const openChannel = (page: Page) => page.locator('nav[aria-label="Channels"] .tile[aria-current="page"]').getAttribute("data-code");
const railCodes = (page: Page) => page.locator('nav[aria-label="Channels"] .tile[data-code]').evaluateAll((tiles) => tiles.map((t) => (t as HTMLElement).dataset.code ?? ""));

async function run() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  await page.locator("article.msg").first().waitFor();
  await settle(page);

  await page.keyboard.press("ControlOrMeta+Slash");
  await sheet(page).waitFor();
  const words = await sheet(page).innerText();
  expect(
    ["Find a channel", "Back and forward", "Put the draft away", "Text size"].every((w) => words.includes(w)),
    "⌘/ opens the shortcut sheet with every group",
  );
  await page.keyboard.press("ControlOrMeta+Slash");
  await settle(page);
  expect(!(await sheet(page).isVisible()), "⌘/ again closes it");

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("shortcuts");
  await page.getByRole("option", { name: /Keyboard shortcuts/ }).click();
  await sheet(page).waitFor();
  expect(await sheet(page).isVisible(), "⌘K finds Keyboard shortcuts and opens the sheet");
  await page.keyboard.press("Escape");
  await settle(page);
  expect(!(await sheet(page).isVisible()), "Esc closes it");

  const rail = await railCodes(page);
  await page.getByRole("textbox", { name: "Message" }).click();
  await page.keyboard.press("ControlOrMeta+2");
  await settle(page);
  expect((await openChannel(page)) === rail[1], `⌘2 opens the second channel in the rail, even from the composer (${rail[1]})`);
  await page.keyboard.press("ControlOrMeta+9");
  await settle(page);
  expect((await openChannel(page)) === rail.at(-1), `⌘9 opens the last one (${rail.at(-1)})`);
  await page.keyboard.press("ControlOrMeta+1");
  await settle(page);
  expect((await openChannel(page)) === rail[0], `⌘1 the first (${rail[0]})`);
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
console.log("\nshortcut sheet and ⌘1-9 hold");
