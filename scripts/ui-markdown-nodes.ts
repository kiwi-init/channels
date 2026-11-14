import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Locator } from "playwright-core";
import { SPOILER_MESSAGES } from "../ui/src/demo/markdown-samples.ts";

const flag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const dist = resolve(flag("--dist") ?? "ui/dist");
const engine = flag("--browser") ?? "chromium";
if (engine !== "chromium" && engine !== "webkit") throw new Error("--browser must be chromium or webkit");
if (!existsSync(join(dist, "index.html"))) throw new Error(`Build the UI first: ${dist}/index.html is missing`);
const shots = flag("--shots");
const theme = flag("--theme") ?? "dark";
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch();
let checks = 0;
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
  console.log(`ok ${++checks}: ${message}`);
};
const selection = (root: Locator) =>
  root.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const text = selection?.toString() ?? "";
    selection?.removeAllRanges();
    return text;
  });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text), readText: async () => copied.at(-1) ?? "" } });
  });
  await page.goto(`http://127.0.0.1:${server.port}/?shot=markdown-nodes&theme=${theme}`);
  const message = (seq: number) => page.locator(`.feed [data-seq="${seq}"]`);
  const primary = message(801).locator(".md");
  await primary.getByRole("button", { name: "Show spoiler", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const control = primary.getByRole("button", { name: "Show spoiler", exact: true });
  check((await control.getAttribute("aria-expanded")) === "false", "concealed control exposes collapsed state");
  check(!(await primary.ariaSnapshot()).includes("beta"), "concealed text is absent from the browser accessibility snapshot");
  check((await primary.locator("a, input, [tabindex]").count()) === 0, "concealed descendants cannot receive focus");
  check((await selection(primary)) === "alpha  gamma", "selection before reveal is exactly 'alpha  gamma'");
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  check(await control.evaluate((button) => button.matches(":focus-visible") && getComputedStyle(button).outlineStyle !== "none"), "keyboard focus is visible");
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `concealed-${theme}-${engine}.png`) });
  }
  await page.keyboard.press("Enter");
  const hide = primary.getByRole("button", { name: "Hide spoiler", exact: true });
  await hide.waitFor();
  check((await hide.getAttribute("aria-expanded")) === "true", "Enter reveals and exposes expanded state");
  check(await hide.evaluate((button) => button === document.activeElement), "focus remains on the reveal/hide control");
  check((await selection(primary)) === "alpha beta gamma", "selection after reveal is exactly 'alpha beta gamma'");
  check((await primary.ariaSnapshot()).includes("beta"), "revealed text is in the browser accessibility snapshot");
  if (shots) await page.screenshot({ path: join(shots, `revealed-${theme}-${engine}.png`) });
  await page.keyboard.press("Space");
  await primary.getByRole("button", { name: "Show spoiler", exact: true }).waitFor();
  check(!(await primary.ariaSnapshot()).includes("beta"), "Space conceals again");
  await primary.getByRole("button", { name: "Show spoiler", exact: true }).click();
  await primary.getByRole("button", { name: "Hide spoiler", exact: true }).waitFor();
  check((await selection(primary)) === "alpha beta gamma", "pointer reveals selectable text");
  const multiple = message(802).locator(".md");
  await multiple.getByRole("button", { name: "Show spoiler", exact: true }).first().click();
  check(
    (await multiple.getByRole("button", { name: "Show spoiler", exact: true }).count()) === 1 && (await multiple.getByRole("button", { name: "Hide spoiler", exact: true }).count()) === 1,
    "multiple spoilers reveal independently",
  );
  const formatted = message(803).locator(".md");
  check((await formatted.getByRole("link").count()) === 0, "a concealed link is not mounted or focusable");
  const popups: string[] = [];
  page.on("popup", (popup) => popups.push(popup.url()));
  await formatted.getByRole("button", { name: "Show spoiler", exact: true }).click();
  check((await formatted.locator("strong").innerText()) === "bold", "formatting survives reveal");
  check((await formatted.getByRole("link", { name: "docs" }).getAttribute("href")) === "https://example.com/hidden", "the revealed link keeps its destination");
  check(popups.length === 0 && page.url().includes("shot=markdown-nodes"), "revealing never activates the contained link");
  const linked = message(804).locator(".md");
  check((await linked.locator("a button, button a, button button").count()) === 0, "spoiler-in-link has no nested interactive controls");
  await linked.getByRole("button", { name: "Show spoiler", exact: true }).click();
  check((await linked.getByRole("link", { name: "inside", exact: true }).getAttribute("href")) === "https://example.com/outer", "revealed spoiler-in-link text keeps the enclosing destination");
  check((await linked.locator("a button, button a, button button").count()) === 0 && popups.length === 0, "revealing inside a link neither nests controls nor opens it");
  const code = message(805).locator(".md");
  check((await code.getByRole("button", { name: "Show spoiler", exact: true }).count()) === 0, "inline/fenced code stays literal");
  check(
    (await code.locator("code").allTextContents()).every((text) => text.trim() === SPOILER_MESSAGES[0]),
    "inline/fenced code keeps its exact content",
  );
  check((await message(807).locator(".msg-quote-text").innerText()) === SPOILER_MESSAGES[0], "reply preview preserves its existing literal-pipe string");
  for (const label of ["Hide spoiler", "Show spoiler"]) {
    const toggle = primary.getByRole("button", { name: label, exact: true });
    await message(801).hover();
    await message(801).getByRole("button", { name: "Copy text", exact: true }).click();
    check((await page.evaluate(() => navigator.clipboard.readText())) === SPOILER_MESSAGES[0], `whole-message copy keeps raw markdown while the control says ${label}`);
    await toggle.click();
  }
  check(errors.length === 0, `no page errors: ${errors.join("; ")}`);
  console.log(`${engine}: ${checks} checks passed; browser accessibility assertions only, no assistive-technology run claimed`);
} finally {
  await browser.close();
  await server.stop(true);
}
