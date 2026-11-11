import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

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
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  const mine = page.locator('article.msg[data-seq="120"]');
  const theirs = page.locator('article.msg[data-seq="112"]');
  const editor = page.getByRole("textbox", { name: "Edit message" });
  const composer = page.locator(".main .composer textarea");
  await mine.waitFor();

  await theirs.hover();
  expect((await theirs.getByRole("button", { name: "Edit" }).count()) === 0, "someone else's message offers no Edit");
  expect((await theirs.getByRole("button", { name: "Delete" }).count()) === 0, "someone else's message offers no Delete");

  await composer.fill("a draft from before");
  await mine.hover();
  await mine.getByRole("button", { name: "Edit" }).click();
  await mine.getByRole("textbox", { name: "Edit message" }).waitFor();
  expect(
    (await editor.count()) === 1 && (await editor.inputValue()) === "@win ship it: tag v1.0.0" && (await editor.evaluate((el) => el === document.activeElement)),
    "Edit opens the message in a box in its own row, focused",
  );
  expect((await composer.inputValue()) === "a draft from before", "the composer keeps its draft while a message is edited");
  await editor.fill("@win ship it: tag v1.0.1");
  await editor.press("Enter");
  await page.waitForTimeout(200);
  expect((await mine.innerText()).includes("v1.0.1") && (await editor.count()) === 0, "Enter saves the new text in place and closes the box");
  expect((await mine.locator(".msg-edited").count()) === 1, "the message is marked edited");
  expect((await composer.inputValue()) === "a draft from before", "and the draft is still there");
  await composer.fill("");

  await page.locator('.side-row:has-text("atlas")').first().click();
  await composer.click();
  await composer.press("ArrowUp");
  await editor.waitFor({ timeout: 5000 }).catch(() => {});
  const up = (await editor.count()) === 1 ? await editor.inputValue() : "no editor";
  const focused = (await editor.count()) === 1 && (await editor.evaluate((el) => el === document.activeElement));
  await editor.fill("never mind").catch(() => {});
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect(
    up === "yes, take it" && focused && (await editor.count()) === 0 && (await page.locator("article.msg", { hasText: "never mind" }).count()) === 0,
    "↑ in an empty composer opens your last message in its row, and Esc keeps it as it was",
  );

  await page.locator(".side-row", { hasText: "general" }).first().click();
  await mine.hover();
  await mine.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this message?" });
  await dialog.waitFor();
  expect((await dialog.innerText()).includes("may still have it"), "the confirm doesn't promise erasure");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForTimeout(200);
  expect((await mine.locator(".msg-deleted").count()) === 1 && !(await mine.innerText()).includes("v1.0.1"), "a deleted message reads as deleted, in place");

  await page.goto(`http://127.0.0.1:${server.port}/?shot=task-working`);
  const panel = page.locator("aside.panel");
  const inPanel = panel.locator(".composer textarea");
  await inPanel.waitFor();
  await inPanel.fill("a line from the task panel");
  await inPanel.press("Enter");
  const line = panel.locator("article.msg", { hasText: "a line from the task panel" }).last();
  await line.waitFor();
  await page.waitForTimeout(900);
  await line.hover();
  await line.getByRole("button", { name: "Edit" }).click();
  const inRow = line.getByRole("textbox", { name: "Edit message" });
  await inRow.waitFor({ timeout: 5000 }).catch(() => {});
  expect(
    (await editor.count()) === 1 && (await inRow.count()) === 1 && (await inRow.inputValue()) === "a line from the task panel" && (await inPanel.inputValue()) === "",
    "Edit in the task panel opens the line in its row there, and nowhere else",
  );
  await inRow.fill("a line from the task panel, edited");
  await inRow.press("Enter");
  await page.waitForTimeout(200);
  expect((await line.innerText()).includes("edited") && (await editor.count()) === 0, "saving in the panel changes the line in place");
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
