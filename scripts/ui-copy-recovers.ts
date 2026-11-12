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

const WORKING_CLIPBOARD = () => {
  const copied: string[] = [];
  Reflect.set(window, "copiedTexts", copied);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
};

async function open(shot: string, clipboard: "working" | "as-the-shot-says"): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on("pageerror", (e) => fails.push(`${shot}: page threw: ${e.message}`));
  if (clipboard === "working") await page.addInitScript(WORKING_CLIPBOARD);
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  await page.locator(".invite-box .icon-btn:not(:disabled)").first().waitFor();
  return page;
}

const copied = (page: Page) => page.evaluate(() => [...(Reflect.get(window, "copiedTexts") as string[])]);
const commandOnScreen = (page: Page) =>
  page
    .locator(".invite-box code")
    .first()
    .evaluate((el) => el.textContent ?? "");

async function selection(page: Page): Promise<{ focused: boolean; selected: string; value: string }> {
  return page.locator(".copy-manual-text").evaluate((el) => {
    const area = el as HTMLTextAreaElement;
    return { focused: document.activeElement === area, selected: area.value.slice(area.selectionStart, area.selectionEnd), value: area.value };
  });
}

try {
  const refused = await open("add-agent-copy-refused", "as-the-shot-says");
  await refused.locator(".copy-manual-text").waitFor();
  const command = await commandOnScreen(refused);
  const first = await selection(refused);
  expect(command.includes(" --nick "), `the command on screen is a join command (${command.length} characters)`);
  expect(first.value === command, "a refused copy shows the exact command in the manual-copy box");
  expect(first.focused && first.selected === command, "the manual-copy box takes focus with the whole command selected");
  expect((await refused.getByRole("alert").filter({ hasText: "Ctrl+C" }).count()) === 1, "it says how to copy by hand");

  const copy = refused.locator(".invite-box .icon-btn").first();
  for (let i = 0; i < 5; i++) await copy.click();
  await refused.waitForTimeout(300);
  expect((await refused.locator(".copy-manual").count()) === 1, "five more clicks on a refused copy leave one manual-copy box");

  await refused.getByRole("textbox", { name: "Name" }).focus();
  const away = await selection(refused);
  expect(!away.focused, "focus can leave the manual-copy box");
  await refused.getByRole("button", { name: "Select it again" }).click();
  const again = await selection(refused);
  expect(again.focused && again.selected === command, "Select it again focuses the box and selects the whole command");

  await refused.evaluate(WORKING_CLIPBOARD);
  await copy.click();
  await refused.locator(".copy-manual").waitFor({ state: "detached" });
  expect((await copied(refused)).at(-1) === command, "once the clipboard takes it, Copy copies the command and the manual-copy box goes");
  await refused.close();

  const working = await open("add-agent", "working");
  const line = await commandOnScreen(working);
  await working.locator(".invite-box .icon-btn").first().click();
  await working.waitForTimeout(300);
  expect((await copied(working)).join("\n") === line, "a copy that lands copies the command exactly");
  expect((await working.locator(".copy-manual").count()) === 0, "and shows no manual-copy box");
  await working.close();

  const invite = await open("invite", "working");
  const link = await commandOnScreen(invite);
  await invite.locator(".invite-box .icon-btn").first().click();
  await invite.waitForTimeout(300);
  expect(link.length > 0 && (await copied(invite)).join("\n") === link, "the invite link's Copy still copies the link");
  expect((await invite.locator(".copy-manual").count()) === 0, "and shows no manual-copy box");
  await invite.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
