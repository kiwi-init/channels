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
  const area = page.getByRole("textbox", { name: "Message" });
  const chip = page.locator(".stash-chip");
  const rows = page.locator(".stash-row");
  await area.click();
  for (const text of ["first draft", "second draft"]) {
    await area.fill(text);
    await area.press("Control+s");
  }
  await chip.waitFor();
  expect((await area.inputValue()) === "", "Ctrl+S stashes the draft and empties the composer");

  await chip.click();
  await rows.first().waitFor();
  expect((await rows.count()) === 2, "the chip opens the list with both drafts");
  await rows.nth(1).click();
  await page.waitForTimeout(100);
  expect((await area.inputValue()) === "first draft", "clicking an older row puts it back in the composer");
  expect((await page.locator(".stash-list").count()) === 0, "the list closes after a row is taken");

  await area.fill("");
  await chip.click();
  await rows.first().waitFor();
  await chip.click();
  await page.waitForTimeout(100);
  expect((await page.locator(".stash-list").count()) === 0, "clicking the chip again closes the list");

  await chip.click();
  await rows.first().click();
  await page.waitForTimeout(100);
  expect((await area.inputValue()) === "second draft", "clicking the last row brings it back");
  expect((await chip.count()) === 0, "the chip goes once the stash is empty");
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
