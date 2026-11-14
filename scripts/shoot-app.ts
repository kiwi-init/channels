import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

import { reactionsOn, settleRequests, stopFetchOnLeave } from "./settle-requests.ts";
import { pageErrors } from "./page-errors.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const url = flag("--url");
const dist = flag("--dist");
if (dist && !existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const t0 = performance.now();
const clock = () => `${Math.round(performance.now() - t0)}ms`;
let trail: string[] = [];
const trace = (line: string) => void trail.push(`${clock()} ${line}`);
const server = dist
  ? Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const path = decodeURIComponent(new URL(req.url).pathname);
        const file = Bun.file(path.startsWith("/reactions/") ? resolve(import.meta.dir, "../site", "." + path) : join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
        const there = await file.exists();
        if (path.startsWith("/reactions/")) {
          trace(`server: ${path} ${there ? 200 : 404}${req.signal.aborted ? ", already aborted" : ""}`);
          req.signal.addEventListener("abort", () => trace(`server: ${path} aborted by the client`));
        }
        return there ? new Response(file) : new Response("not found", { status: 404 });
      },
    })
  : null;
const base = server ? `http://127.0.0.1:${server.port}/` : (url ?? "http://localhost:5175/");
const themes = (flag("--theme") ?? "dark").split(",");
const engine = flag("--browser") ?? "chromium";
const size = (flag("--size") ?? "1440x900").split("x").map(Number);
const only = flag("--only")?.split(",").filter(Boolean);
const textScale = flag("--text-scale");
const [shard = 1, shards = 1] = (flag("--shard") ?? "1/1").split("/").map(Number);
if (!(shards >= 1 && shard >= 1 && shard <= shards)) throw new Error("--shard is i/n, with 1 <= i <= n");
const out = resolve(args[0] ?? "shots");
mkdirSync(out, { recursive: true });

const page0 = server ? readFileSync(resolve(import.meta.dir, "../ui/src/demo/shots.ts"), "utf8") : await fetch(new URL("/src/demo/shots.ts", base)).then((r) => r.text());
const block = page0.slice(page0.search(/SHOTS\b[^=]*= \{/));
const names = [...block.matchAll(/^(?:\t| {2})"?([\w-]+)"?:/gm)]
  .map((m) => m[1] as string)
  .filter((n) => !only || only.includes(n))
  .filter((_, i) => i % shards === shard - 1);

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: size[0] ?? 1440, height: size[1] ?? 900 }, deviceScaleFactor: 2, timezoneId: "UTC", locale: "en-US" });
  await page.clock.setFixedTime(new Date("2026-11-04T15:30:00Z"));
  const errors: string[] = [];
  let at = "";
  const isReaction = reactionsOn(base);
  await pageErrors(page, (e) => {
    trace(`page error: ${e.split("\n")[0]}`);
    errors.push(`${at}: ${e}\n  what led up to it:\n${trail.map((l) => `    ${l}`).join("\n")}`);
  });
  page.on("request", (r) => isReaction(new URL(r.url())) && trace(`page: asks ${new URL(r.url()).pathname}`));
  page.on("response", (r) => isReaction(new URL(r.url())) && trace(`page: ${new URL(r.url()).pathname} answered ${r.status()}`));
  page.on("requestfinished", (r) => isReaction(new URL(r.url())) && trace(`page: ${new URL(r.url()).pathname} finished`));
  page.on("requestfailed", (r) => isReaction(new URL(r.url())) && trace(`page: ${new URL(r.url()).pathname} failed: ${r.failure()?.errorText ?? "no reason given"}`));
  page.on("framenavigated", (f) => f === page.mainFrame() && trace(`page: navigated to ${f.url().replace(base, "/")}`));
  const reactions = settleRequests(page, reactionsOn(base));
  const leave = await stopFetchOnLeave(page);
  for (const theme of themes) {
    for (const name of names) {
      trail = trail.slice(-12);
      at = `${name}-${theme}`;
      trace(`shot ${at} starts`);
      await page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          // about:blank before the first shot has no storage to clear
        }
      });
      await leave();
      await reactions.settled();
      await page.goto(`${base}?shot=${name}&theme=${theme}&frozen`);
      await page.waitForLoadState("networkidle");
      if (textScale) await page.evaluate((scale) => document.documentElement.style.setProperty("--text-scale", scale), textScale);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
      await reactions.settled();
      const file = join(out, `${name}-${theme}.png`);
      await page.screenshot({ path: file, animations: "disabled" });
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
