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
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  const area = page.getByRole("textbox", { name: "Message" });
  const room = (name: string) => page.locator(".side-row", { hasText: name }).first();

  await area.fill("only for general");
  await page.locator(".compose input[type=file]").setInputFiles({ name: "general.png", mimeType: "image/png", buffer: PNG });
  await page.locator(".compose-file").first().waitFor();
  await room("releases").click();
  await page.waitForTimeout(200);
  expect((await area.inputValue()) === "", "another room's composer starts empty, not with general's text");
  expect((await page.locator(".compose-file").count()) === 0, "another room's composer has none of general's images");
  await room("general").click();
  await page.waitForTimeout(200);
  expect((await area.inputValue()) === "only for general", "back in general, its draft text is still there");
  expect((await page.locator(".compose-file").count()) === 1, "back in general, its image is still attached");

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
