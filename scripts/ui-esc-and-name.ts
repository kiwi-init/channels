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
  const panel = page.locator("aside.panel");
  const search = page.locator('input[aria-label="Search this channel"]');

  await page.goto(`http://127.0.0.1:${server.port}/?shot=thread`);
  await panel.waitFor();
  await page.keyboard.press("Control+f");
  await search.fill("bundle");
  await search.press("Escape");
  await page.waitForTimeout(200);
  expect((await panel.count()) === 1, "Esc in search closes the search and leaves the open panel");
  await page
    .locator("main")
    .first()
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect((await panel.count()) === 0, "Esc anywhere else still closes the panel");

  await page.goto(`http://127.0.0.1:${server.port}/?shot=settings`);
  const name = page.locator(".set-row", { hasText: "Name" }).first();
  await name.waitFor();
  expect((await name.getByRole("button", { name: "Change" }).count()) === 0, "Settings shows your name without a Change it can't keep");
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
