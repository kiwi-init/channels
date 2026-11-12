import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

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
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  const area = page.getByRole("textbox", { name: "Message" });
  const room = (name: string) => page.locator(`.side-row:has-text("${name}")`).first();

  await room("atlas").click();
  await area.fill("only for atlas");
  await page.locator(".compose input[type=file]").setInputFiles({ name: "atlas.png", mimeType: "image/png", buffer: PNG });
  await page.locator(".compose-file").first().waitFor();
  await room("releases").click();
  await page.locator(".thread-doc").first().waitFor({ state: "attached" });
  expect((await page.getByText("only for atlas").count()) === 0, "a room's doc doesn't pick up the DM's draft text");
  expect((await page.locator(".compose-file").count()) === 0, "nor the DM's images");
  await room("atlas").click();
  await page.waitForTimeout(200);
  expect((await area.inputValue()) === "only for atlas", "back in the DM, its draft text is still there");
  expect((await page.locator(".compose-file").count()) === 1, "back in the DM, its image is still attached");

  await area.fill("");
  await page.getByRole("button", { name: "Send" }).click();
  const last = page.locator("article.msg").last();
  await last.locator("img").first().waitFor();
  const said = (await last.locator(".msg-body").innerText()).toLowerCase();
  expect(!said.includes("general.png"), "an image sent alone posts no file name as its text");
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
