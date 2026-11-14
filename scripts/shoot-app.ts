import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

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

const QUIET_MS = 300;
const QUIET_CAP_MS = 3000;

const quiet = (page: Page) =>
  page.evaluate(
    ([still, cap]) =>
      new Promise<number | null>((done) => {
        const start = performance.now();
        let last = start;
        const moved = () => void (last = performance.now());
        const seen = new MutationObserver(moved);
        seen.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
        document.addEventListener("scroll", moved, true);
        const check = () => {
          const now = performance.now();
          if (now - last < still && now - start < cap) return void requestAnimationFrame(check);
          seen.disconnect();
          document.removeEventListener("scroll", moved, true);
          done(now - last < still ? null : Math.round(now - start));
        };
        requestAnimationFrame(check);
      }),
    [QUIET_MS, QUIET_CAP_MS] as const,
  );

const SHOT_TIME = new Date("2026-11-04T15:30:00Z");
const MOVING_MS = 4000;

const seedRandom = () => {
  let seed = 2770;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
try {
  const errors: string[] = [];
  const isReaction = reactionsOn(base);
  const shoot = async (name: string, theme: string, moving: boolean): Promise<boolean> => {
    const at = `${name}-${theme}`;
    const page = await browser.newPage({ viewport: { width: size[0] ?? 1440, height: size[1] ?? 900 }, deviceScaleFactor: 2, timezoneId: "UTC", locale: "en-US" });
    await page.addInitScript(seedRandom);
    if (moving) await page.clock.install({ time: SHOT_TIME });
    else await page.clock.setFixedTime(SHOT_TIME);
    await pageErrors(page, (e) => {
      trace(`page error: ${e.split("\n")[0]}`);
      errors.push(`${at}: ${e}\n  what led up to it:\n${trail.map((l) => `    ${l}`).join("\n")}`);
    });
    page.on("request", (r) => isReaction(new URL(r.url())) && trace(`page: asks ${new URL(r.url()).pathname}`));
    page.on("response", (r) => isReaction(new URL(r.url())) && trace(`page: ${new URL(r.url()).pathname} answered ${r.status()}`));
    page.on("requestfinished", (r) => isReaction(new URL(r.url())) && trace(`page: ${new URL(r.url()).pathname} finished`));
    page.on("requestfailed", (r) => isReaction(new URL(r.url())) && trace(`page: ${new URL(r.url()).pathname} failed: ${r.failure()?.errorText ?? "no reason given"}`));
    page.on("framenavigated", (f) => f === page.mainFrame() && trace(`page: navigated to ${f.url().replace(base, "/")}`));
    const reactions = settleRequests(page, isReaction);
    const leave = await stopFetchOnLeave(page);
    await page.goto(`${base}?shot=${name}&theme=${theme}&frozen`);
    await page.waitForLoadState("networkidle");
    if (textScale) await page.evaluate((scale) => document.documentElement.style.setProperty("--text-scale", scale), textScale);
    await page.evaluate(() => document.fonts.ready);
    let still = true;
    if (moving) {
      await page.clock.runFor(MOVING_MS);
      await page.waitForLoadState("networkidle");
      await page.clock.runFor(500);
    } else still = (await quiet(page)) !== null;
    await reactions.settled();
    if (still) {
      const file = join(out, `${name}-${theme}.png`);
      await page.screenshot({ path: file, animations: "disabled" });
      console.log(file);
    }
    await leave();
    await reactions.settled();
    await page.close();
    return still;
  };
  for (const theme of themes) {
    for (const name of names) {
      trail = trail.slice(-12);
      trace(`shot ${name}-${theme} starts`);
      if (await shoot(name, theme, false)) continue;
      console.log(`${name}-${theme}: still moving after ${QUIET_CAP_MS} ms, shot ${MOVING_MS} ms into a paused clock`);
      await shoot(name, theme, true);
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
