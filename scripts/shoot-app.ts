import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const url = flag("--url");
const dist = flag("--dist");
if (dist && !existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const server = dist
  ? Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const path = decodeURIComponent(new URL(req.url).pathname);
        const file = Bun.file(path.startsWith("/reactions/") ? resolve(import.meta.dir, "../site", "." + path) : join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
        return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
      },
    })
  : null;
const base = server ? `http://127.0.0.1:${server.port}/` : (url ?? "http://localhost:5175/");
const themes = (flag("--theme") ?? "dark").split(",");
const engine = flag("--browser") ?? "chromium";
const size = (flag("--size") ?? "1440x900").split("x").map(Number);
const only = flag("--only")?.split(",").filter(Boolean);
const out = resolve(args[0] ?? "shots");
mkdirSync(out, { recursive: true });

const page0 = server ? readFileSync(resolve(import.meta.dir, "../ui/src/demo/shots.ts"), "utf8") : await fetch(new URL("/src/demo/shots.ts", base)).then((r) => r.text());
const block = page0.slice(page0.search(/SHOTS\b[^=]*= \{/));
const names = [...block.matchAll(/^(?:\t| {2})"?([\w-]+)"?:/gm)].map((m) => m[1] as string).filter((n) => !only || only.includes(n));

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: size[0] ?? 1440, height: size[1] ?? 900 }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const theme of themes) {
    for (const name of names) {
      await page.goto(`${base}?shot=${name}&theme=${theme}`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
      const file = join(out, `${name}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await server?.stop(true);
}
