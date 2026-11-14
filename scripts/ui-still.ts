#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--chromium") ? "chromium" : "webkit";

const SHOTS = ["thread-doc", "thread-doc-1000", "thread-doc-events", "long-feed", "channel", "ci-live", "event-runs", "dm"] as const;
const SIZES = [
  [1440, 900],
  [900, 1400],
  [420, 800],
] as const;
const SETTLE_MS = 1500;
const DRAWN_MS = 15_000;
const FRAMES = 60;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

async function moves(browser: Browser, shot: string, width: number, height: number): Promise<string | null> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(() => {
    const log: string[] = [];
    Reflect.set(window, "__still", log);
    const t0 = performance.now();
    const at = () => Math.round(performance.now() - t0);
    let watched: Element | null = null;
    const sizes = () => [...document.querySelectorAll<HTMLElement>(".feed-list > [data-seq]")].slice(-5).map((r) => `${r.dataset.seq}=${r.offsetHeight}`).join(",");
    const hook = () => {
      const f = document.querySelector<HTMLElement>(".feed");
      const l = f?.querySelector(".feed-list");
      if (!f || !l || l === watched) return;
      watched = l;
      new ResizeObserver(() => log.push(`${at()} resize ${Math.round(f.scrollTop)}/${f.scrollHeight} plain=${f.querySelectorAll(".md-plain").length} ${sizes()}`)).observe(l);
      f.addEventListener("scroll", () => log.push(`${at()} scroll ${Math.round(f.scrollTop)}/${f.scrollHeight}`), { passive: true });
      for (const kind of ["wheel", "pointerdown", "keydown"]) f.addEventListener(kind, () => log.push(`${at()} ${kind}`), { passive: true });
    };
    new MutationObserver(hook).observe(document, { childList: true, subtree: true });
  });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
    await page.waitForSelector(".feed", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await page
      .waitForFunction(() => !document.querySelector(".feed .md-plain"), undefined, { timeout: DRAWN_MS })
      .catch(() => {
        // A row whose markdown never parses keeps its plain text for good; the frames below still say whether the view moves.
      });
    if (process.env.STILL_FONTS) await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const before = await page.evaluate(() => { const f = document.querySelector<HTMLElement>(".feed"); return `t=${Math.round(Number(document.timeline.currentTime ?? -1))} vis=${document.visibilityState} ${f ? `${Math.round(f.scrollTop)}/${f.scrollHeight}` : "-"}`; });
    await page.waitForTimeout(SETTLE_MS);
    const after = await page.evaluate(() => { const f = document.querySelector<HTMLElement>(".feed"); return `t=${Math.round(Number(document.timeline.currentTime ?? -1))} vis=${document.visibilityState} ${f ? `${Math.round(f.scrollTop)}/${f.scrollHeight}` : "-"}`; });
    const why: string | null = await page.evaluate(
      (frames) =>
        new Promise<string | null>((done) => {
          const read = () => [...document.querySelectorAll<HTMLElement>(".feed")].map((f) => `${Math.round(f.scrollTop)}/${f.scrollHeight}`).join(" ");
          const rows = () => new Map([...document.querySelectorAll<HTMLElement>(".feed-list > *")].map((r, i) => [r.dataset.seq ?? `${r.className.split(" ")[0]}#${i}`, `${r.offsetHeight}:${r.className}:${r.innerHTML.length}`]));
          const first = rows();
          const seen = [read()];
          const tick = () => {
            seen.push(read());
            if (seen.length <= frames) return void requestAnimationFrame(tick);
            const changed = new Set(seen);
            const last = rows();
            const moved = [...last].filter(([k, v]) => first.get(k) !== v).map(([k, v]) => `${k}: ${first.get(k) ?? "new"} -> ${v}`).concat([...first.keys()].filter((k) => !last.has(k)).map((k) => `${k}: gone`));
            done(changed.size === 1 ? null : `${changed.size} positions in ${frames} frames: ${[...changed].slice(0, 6).join(" → ")} | rows: ${moved.join(" ; ")} | plain=${document.querySelectorAll(".feed .md-plain").length}`);
          };
          requestAnimationFrame(tick);
        }),
      FRAMES,
    );
    return why ? `${why} | settle: ${before} -> ${after}\n${(await page.evaluate(() => (Reflect.get(window, "__still") as string[]).join("\n"))).split("\n").slice(-30).join("\n")}` : null;
  } finally {
    await page.close();
  }
}

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
let failed = 0;
try {
  for (const shot of SHOTS)
    for (const [width, height] of SIZES) {
      const why = await moves(browser, shot, width, height);
      if (why) failed++;
      console.log(`${why ? "✗" : "✓"} ${shot} at ${width}x${height} holds still after opening${why ? `: ${why}` : ""}`);
    }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} views kept scrolling after they opened, in ${engine}`);
  process.exitCode = 1;
}
