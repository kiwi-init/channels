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
  const composer = page.getByRole("textbox", { name: "Message" });
  await mine.waitFor();

  await theirs.hover();
  expect((await theirs.getByRole("button", { name: "Edit" }).count()) === 0, "someone else's message offers no Edit");
  expect((await theirs.getByRole("button", { name: "Delete" }).count()) === 0, "someone else's message offers no Delete");

  await mine.hover();
  await mine.getByRole("button", { name: "Edit" }).click();
  await editor.waitFor();
  await editor.fill("@win ship it: tag v1.0.1");
  await editor.press("Enter");
  await page.waitForTimeout(200);
  expect((await mine.innerText()).includes("v1.0.1"), "Enter saves the new text in place");
  expect((await mine.locator(".msg-edited").count()) === 1, "the message is marked edited");

  await composer.click();
  await composer.press("ArrowUp");
  await editor.waitFor();
  await editor.fill("never mind");
  await editor.press("Escape");
  await page.waitForTimeout(200);
  expect((await editor.count()) === 0 && !(await mine.innerText()).includes("never mind"), "↑ in an empty composer edits your last message, and Esc keeps it as it was");

  await mine.hover();
  await mine.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this message?" });
  await dialog.waitFor();
  expect((await dialog.innerText()).includes("may still have it"), "the confirm doesn't promise erasure");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForTimeout(200);
  expect((await mine.locator(".msg-deleted").count()) === 1 && !(await mine.innerText()).includes("v1.0.1"), "a deleted message reads as deleted, in place");
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
