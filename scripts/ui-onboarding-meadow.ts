import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--webkit") ? webkit : chromium;
const site = join(import.meta.dir, "../site");
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(path.startsWith("/reactions/") ? resolve(site, "." + path) : join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const failures: string[] = [];
const check = (what: string, ok: boolean) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "✓" : "✗"} ${what}`);
};
const browser = await engine.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=onboarding-still`);
  await page.waitForTimeout(2600);
  const motion = await page.evaluate(() => document.documentElement.dataset.motion ?? "");
  const intro = await page.evaluate(() => document.querySelector("canvas[data-meadow]")?.getAttribute("data-meadow") ?? "none");
  check(`with the app's Reduce motion on (${motion}), the onboarding's meadow holds still (${intro})`, motion === "reduced" && intro !== "moving" && intro !== "none");
  check("no page errors", errors.length === 0);
} finally {
  await browser.close();
  await server.stop(true);
}
if (failures.length) process.exitCode = 1;
