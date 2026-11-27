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
const base = `http://127.0.0.1:${server.port}/`;
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const fails: string[] = [];
const expect = (ok: boolean, what: string, got?: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok || got === undefined ? "" : ` (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(what);
};

const COMPOSER = 'textarea[aria-label="Message"]';
const TEXT_BOXES = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="tel"]';
const PAUSE = 1100;

async function open(page: Page, shot: string): Promise<void> {
  await page.goto(`${base}?shot=${shot}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

const valueOf = (page: Page, sel: string) => page.locator(sel).first().inputValue();

async function press(page: Page, keys: string): Promise<void> {
  await page.keyboard.press(keys);
  await page.waitForTimeout(60);
}

async function typeSlow(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: 20 });
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));

  await open(page, "channel");
  const composer = page.locator(COMPOSER).first();
  await composer.click();
  await typeSlow(page, "hello big world");
  await press(page, "Control+z");
  expect((await valueOf(page, COMPOSER)) === "hello big ", "Ctrl+Z in the composer undoes the last typed word", await valueOf(page, COMPOSER));
  await press(page, "Control+z");
  expect((await valueOf(page, COMPOSER)) === "hello ", "a second Ctrl+Z undoes one more word, so one press is one step", await valueOf(page, COMPOSER));
  await press(page, "Control+Shift+z");
  expect((await valueOf(page, COMPOSER)) === "hello big ", "Ctrl+Shift+Z right after an undo redoes one step", await valueOf(page, COMPOSER));
  await press(page, "Control+y");
  expect((await valueOf(page, COMPOSER)) === "hello big world", "Ctrl+Y redoes the next step", await valueOf(page, COMPOSER));
  await press(page, "Control+z");
  await page.waitForTimeout(PAUSE);
  await typeSlow(page, "planet");
  await press(page, "Control+y");
  expect((await valueOf(page, COMPOSER)) === "hello big planet", "a new edit after an undo leaves no redo to bring the old word back", await valueOf(page, COMPOSER));

  await composer.fill("");
  await page.waitForTimeout(PAUSE);
  await typeSlow(page, "copied text");
  const menu = await page.evaluate((sel) => {
    const el = document.querySelector<HTMLTextAreaElement>(sel);
    if (!el) return { prevented: false, value: "" };
    const ev = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyUndo" });
    el.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented, value: el.value };
  }, COMPOSER);
  expect(menu.prevented && menu.value === "copied ", "an undo from the Edit or context menu (historyUndo) takes the same one step and the engine's own undo never runs", menu.value);
  const menuRedo = await page.evaluate((sel) => {
    const el = document.querySelector<HTMLTextAreaElement>(sel);
    if (!el) return "";
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyRedo" }));
    return el.value;
  }, COMPOSER);
  expect(menuRedo === "copied text", "a redo from the menu (historyRedo) takes the same history", menuRedo);

  await composer.fill("");
  await page.waitForTimeout(PAUSE);
  await typeSlow(page, "hi @ma");
  await page.waitForTimeout(300);
  await press(page, "Tab");
  await page.waitForTimeout(200);
  const completed = await valueOf(page, COMPOSER);
  expect(completed.startsWith("hi @ma") && completed.length > "hi @ma".length, "Tab completes the mention", completed);
  await page.waitForTimeout(PAUSE);
  await typeSlow(page, "how");
  await press(page, "Control+z");
  expect((await valueOf(page, COMPOSER)) === completed, "Ctrl+Z after typing past a completion goes back to the completed text", await valueOf(page, COMPOSER));
  await press(page, "Control+z");
  expect((await valueOf(page, COMPOSER)) === "hi @ma", "the next Ctrl+Z goes back to the text typed before the completion, never an older draft", await valueOf(page, COMPOSER));

  await composer.fill("");
  await page.waitForTimeout(PAUSE);
  await typeSlow(page, "first message");
  await press(page, "Enter");
  await page.waitForTimeout(400);
  expect((await valueOf(page, COMPOSER)) === "", "Enter sends and empties the composer", await valueOf(page, COMPOSER));
  await press(page, "Control+z");
  expect((await valueOf(page, COMPOSER)) === "", "Ctrl+Z right after a send brings nothing back", await valueOf(page, COMPOSER));
  await typeSlow(page, "second");
  await press(page, "Control+z");
  await press(page, "Control+z");
  await press(page, "Control+z");
  expect((await valueOf(page, COMPOSER)) === "", "undo after a send never reaches the sent message or older text", await valueOf(page, COMPOSER));

  await composer.fill("");
  await page.waitForTimeout(PAUSE);
  await typeSlow(page, "saved draft");
  await press(page, "Control+s");
  await page.waitForTimeout(300);
  await typeSlow(page, "sent message");
  await press(page, "Enter");
  await page.waitForTimeout(400);
  await press(page, "Control+Shift+s");
  await page.waitForTimeout(300);
  const restored = await valueOf(page, COMPOSER);
  expect(restored === "saved draft", "Ctrl+Shift+S brings the put-away draft back after a send", restored);
  await press(page, "Control+z");
  const afterRestore = await valueOf(page, COMPOSER);
  expect(!afterRestore.includes("sent message"), "Ctrl+Z after a send and a restored draft never shows the sent message", afterRestore);

  const email = await page.evaluate(() => {
    const el = document.createElement("input");
    el.type = "email";
    el.id = "undo-email";
    const w = window as unknown as { emailInputs: number };
    w.emailInputs = 0;
    el.addEventListener("input", () => void w.emailInputs++);
    document.body.append(el);
    el.focus();
    return document.activeElement === el;
  });
  expect(email, "a plain email input takes focus");
  await page.waitForTimeout(PAUSE);
  await typeSlow(page, "me@example.org");
  const inputsTyped = await page.evaluate(() => (window as unknown as { emailInputs: number }).emailInputs);
  await press(page, "Control+z");
  const emailBack = await page.evaluate(() => ({ value: document.querySelector<HTMLInputElement>("#undo-email")?.value, inputs: (window as unknown as { emailInputs: number }).emailInputs }));
  expect(emailBack.value === "" && emailBack.inputs === inputsTyped + 1, "Ctrl+Z in an email input empties it and tells the page with one input event", JSON.stringify(emailBack));
  await press(page, "Control+Shift+z");
  const emailForward = await page.evaluate(() => ({ value: document.querySelector<HTMLInputElement>("#undo-email")?.value, inputs: (window as unknown as { emailInputs: number }).emailInputs }));
  expect(emailForward.value === "me@example.org" && emailForward.inputs === inputsTyped + 2, "Ctrl+Shift+Z in an email input brings it back with one more input event", JSON.stringify(emailForward));
  await page.evaluate(() => document.querySelector("#undo-email")?.remove());
  await composer.fill("");

  await page.evaluate((sel) => {
    const el = document.querySelector<HTMLTextAreaElement>(sel);
    el?.focus();
  }, COMPOSER);
  await page.waitForTimeout(PAUSE);
  await typeSlow(page, "before ");
  await page.evaluate((sel) => {
    const el = document.querySelector<HTMLTextAreaElement>(sel);
    el?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  }, COMPOSER);
  await page.keyboard.insertText("日本語");
  await page.evaluate((sel) => {
    const el = document.querySelector<HTMLTextAreaElement>(sel);
    el?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }));
  }, COMPOSER);
  await page.waitForTimeout(100);
  expect((await valueOf(page, COMPOSER)) === "before 日本語", "composed text lands in the box", await valueOf(page, COMPOSER));
  await press(page, "Control+z");
  expect((await valueOf(page, COMPOSER)) === "before ", "a composition undoes as one step", await valueOf(page, COMPOSER));

  await composer.fill("");
  await page.waitForTimeout(PAUSE);
  await typeSlow(page, "secret alpha draft");
  const room = page.locator('.side-row:has-text("atlas")').first();
  const switched = (await room.count()) > 0;
  expect(switched, "the sidebar has another room to switch to");
  if (switched) {
    await room.click();
    await page.waitForTimeout(500);
    const there = page.locator(COMPOSER).first();
    await there.click();
    const start = await there.inputValue();
    await press(page, "Control+z");
    await press(page, "Control+z");
    await press(page, "Control+z");
    const after = await there.inputValue();
    expect(!after.includes("secret") && after === start, "undo in another chat's composer never shows the first chat's draft", after);
  }

  await open(page, "channel");
  await press(page, "Control+f");
  await page.waitForTimeout(300);
  const search = page.locator(".search-input").first();
  if ((await search.count()) > 0) {
    await search.click();
    await typeSlow(page, "deploy fix");
    await press(page, "Control+z");
    expect((await search.inputValue()) === "deploy ", "Ctrl+Z in search undoes the last word", await search.inputValue());
    await press(page, "Control+y");
    expect((await search.inputValue()) === "deploy fix", "Ctrl+Y in search redoes it", await search.inputValue());
  } else expect(false, "Ctrl+F opens the search box");

  const SCREENS = ["channel", "task", "spec-draft", "channel-settings", "new-channel", "new-room", "palette", "personality-editor", "invite", "settings", "room-members", "stash-open"];
  let covered = 0;
  for (const shot of SCREENS) {
    await open(page, shot);
    const modal = page.locator("dialog[open]");
    const boxes = ((await modal.count()) > 0 ? modal.last() : page.locator("body")).locator(TEXT_BOXES);
    const count = await boxes.count();
    for (let i = 0; i < count; i++) {
      const box = boxes.nth(i);
      if (!(await box.isVisible()) || !(await box.isEditable())) continue;
      const label = (await box.getAttribute("aria-label")) ?? (await box.getAttribute("placeholder")) ?? (await box.getAttribute("name")) ?? `#${i}`;
      await box.click();
      await press(page, "Control+a");
      await page.waitForTimeout(PAUSE);
      await typeSlow(page, "alpha beta");
      const typed = await box.inputValue().catch(() => null);
      if (typed !== "alpha beta") {
        console.log(`  skip ${shot} "${label}": it rewrites what is typed (${JSON.stringify(typed)})`);
        continue;
      }
      await press(page, "Control+z");
      const back = await box.inputValue().catch(() => null);
      await press(page, "Control+y");
      const forward = await box.inputValue().catch(() => null);
      expect(back === "alpha " && forward === "alpha beta", `${shot}: "${label}" undoes and redoes a word with Ctrl+Z and Ctrl+Y`, `${back} / ${forward}`);
      covered++;
      await press(page, "Escape");
    }
  }
  expect(covered >= 8, `the box walk reached at least 8 text boxes across ${SCREENS.length} screens`, String(covered));
} finally {
  await browser.close();
  server.stop();
}
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
