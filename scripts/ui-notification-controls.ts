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
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=settings`);
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.getByRole("button", { name: "1 hour" }).click();
  const resume = page.getByRole("button", { name: "Resume" });
  await resume.waitFor();
  const moon = await page
    .getByRole("button", { name: /Notifications paused until/ })
    .waitFor({ timeout: 5_000 })
    .then(
      () => true,
      () => false,
    );
  expect(moon, "pausing shows the moon in the rail, naming when it ends");
  await resume.click();
  await page.getByRole("button", { name: "1 hour" }).waitFor();
  expect((await page.getByRole("button", { name: /Notifications paused/ }).count()) === 0, "Resume takes the pause and the moon away");

  await page.getByRole("switch", { name: "Quiet hours" }).click();
  expect((await page.getByLabel("Quiet hours start").inputValue()) === "22:00", "quiet hours offer 22:00 to 08:00 to start with");

  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel-settings`);
  const design = page.locator(".side-row", { hasText: "design" }).first();
  await design.waitFor();
  expect(!(await design.getAttribute("class"))?.includes("is-muted"), "#design starts unmuted");
  await page.getByRole("button", { name: "Mute #design" }).click();
  await page.waitForTimeout(150);
  expect(!!(await design.getAttribute("class"))?.includes("is-muted"), "muting #design from the channel's settings dims it in the sidebar");
  await page.getByRole("button", { name: "Unmute #design" }).click();
  await page.waitForTimeout(150);
  expect(!(await design.getAttribute("class"))?.includes("is-muted"), "and unmuting brings it back");
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
