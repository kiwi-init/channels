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
  await page.locator("article.msg").first().waitFor();
  await page.getByRole("button", { name: /Search this channel/ }).click();
  const box = page.getByRole("combobox", { name: "Search this channel" });
  await box.fill("relay");
  const heading = page.getByText(/^Older messages · \d+$/);
  await heading.waitFor();
  const windowHits = await page.locator(".search-item").count();
  expect(windowHits > 1, "the window's hits and the older ones show in one list");
  expect(/· (\d+)/.exec(await heading.innerText())?.[1] !== "0", "the older section says how many matched");

  await box.fill("relay dumb");
  await heading.waitFor();
  const older = page.locator(".search-item").filter({ hasText: "Keep the relay dumb" }).first();
  await older.waitFor();
  await older.click();
  const bar = page.locator(".older-bar");
  await bar.waitFor();
  expect((await bar.innerText()).includes("Viewing older messages around"), "the bar says this is older history, and when");
  const hit = page.locator("article.msg.is-flash");
  await hit.waitFor();
  const shown = await hit.boundingBox();
  expect(!!shown && shown.y > 100 && shown.y < 700 && (await hit.innerText()).includes("Keep the relay dumb"), "the hit is scrolled into view and marked");
  expect((await page.locator("article.msg").count()) > 10, "the stretch around the hit is shown, not just the hit");

  await hit.hover();
  expect((await hit.getByRole("button", { name: "React 👍" }).count()) === 1, "an older message can still be reacted to");
  expect((await hit.getByRole("button", { name: "Copy text" }).count()) === 1, "and copied");
  expect((await hit.getByRole("button", { name: "Reply" }).count()) === 0, "but not replied to, since the quote couldn't show it");
  expect((await hit.getByRole("button", { name: "Open thread" }).count()) === 0, "and has no thread to open from here");

  await page.getByRole("button", { name: "Back to latest" }).click();
  await bar.waitFor({ state: "detached" });
  expect((await page.getByText("Keep the relay dumb").count()) === 0, "Back to latest returns to the live feed");

  if (!(await box.isVisible())) await page.getByRole("button", { name: /Search this channel/ }).click();
  await box.fill("relay dumb");
  await box.focus();
  await older.click();
  await bar.waitFor();
  await page
    .getByRole("link", { name: /releases/ })
    .or(page.getByRole("button", { name: /releases/ }))
    .first()
    .click();
  await bar.waitFor({ state: "detached" });
  expect(true, "moving to another room closes the older view");
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
