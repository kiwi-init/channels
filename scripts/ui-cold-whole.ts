import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-cold-whole.ts [--dist ui/dist] [--browser webkit|chromium]\n\nA cold open never paints a partial row (#2513): from the first frame, whenever the feed is visible, no row it opened with still shows plain text waiting for markdown or a card waiting for its code, and no thread doc is still loading under the rows. Rows that arrive later are out of scope. At full speed no such frame may show at all. At 4x CPU (chromium only) and with the parser, markdown and doc code arriving 600 ms late, one may show only through the 1 s backstop, never before it. Runs a quiet channel and a busy thread doc.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const WATCH_MS = 3_000;
const SCENES = ["channel", "thread-doc-busy"];
const SLOW_MS = 600;
const SLOW_CHUNK = /\/assets\/(markdown|editor|md4c|mention-tree)-[^/]+\.js$/;
const BACKSTOP_MS = 950;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

interface Watched {
  frames: number;
  firstShown: number;
  heldFrames: number;
  shown: number;
  partial: { t: number; since: number; what: string }[];
}

async function cold(scene: string, throttle: number, slow: boolean): Promise<Watched> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (slow)
    await page.route(SLOW_CHUNK, async (route) => {
      await new Promise((r) => setTimeout(r, SLOW_MS));
      await route.continue();
    });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  await page.addInitScript((watchMs: number) => {
    const out = { frames: 0, shown: 0, firstShown: -1, heldFrames: 0, partial: [] as { t: number; since: number; what: string }[] };
    let opened: Set<string> | null = null;
    let listAt = -1;
    (window as unknown as { __whole: typeof out }).__whole = out;
    const onScreen = (el: Element, view: DOMRect) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.bottom > view.top && r.top < view.bottom;
    };
    const tick = () => {
      out.frames++;
      const list = document.querySelector<HTMLElement>(".feed-list");
      const feed = list?.parentElement;
      if (list && listAt < 0) listAt = performance.now();
      const painted = !!list && getComputedStyle(list).visibility !== "hidden";
      if (list && !painted) out.heldFrames++;
      if (list && feed && painted) {
        out.shown++;
        if (out.firstShown < 0) out.firstShown = out.frames;
        opened ??= new Set([...list.querySelectorAll("[data-seq]")].map((r) => r.getAttribute("data-seq") ?? ""));
        const view = feed.getBoundingClientRect();
        for (const el of list.querySelectorAll(".md-plain, .lazy-wait")) {
          const row = el.closest("[data-seq], section.blk");
          const what = row
            ? el.classList.contains("md-plain")
              ? `plain text in row ${row.getAttribute("data-seq") ?? "doc block"}`
              : `a loading card in row ${row.getAttribute("data-seq") ?? "doc block"}`
            : "a thread doc still loading under the rows";
          const atOpen = !row || !row.hasAttribute("data-seq") || opened?.has(row.getAttribute("data-seq") ?? "");
          if (atOpen && (!row || onScreen(row, view))) {
            if (out.partial.length < 10) out.partial.push({ t: Math.round(performance.now()), since: Math.round(performance.now() - listAt), what });
          }
        }
      }
      if (performance.now() < watchMs) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, WATCH_MS);
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${scene}`);
  await page.locator(".feed-list").first().waitFor({ state: "attached" });
  await page.waitForFunction((ms: number) => performance.now() > ms, WATCH_MS + 200, { timeout: 30_000 });
  const watched = await page.evaluate(() => (window as unknown as { __whole: Watched }).__whole);
  await page.close();
  return watched;
}

try {
  const runs = [
    ...(engine === "chromium" ? [1, 4] : [1]).flatMap((throttle) => SCENES.map((scene) => ({ scene, throttle, slow: false }))),
    ...SCENES.map((scene) => ({ scene, throttle: 1, slow: true })),
  ];
  for (const { scene, throttle, slow } of runs) {
    const w = await cold(scene, throttle, slow);
    const name = `${scene} @${throttle}x${slow ? `, markdown and doc code ${SLOW_MS} ms late` : ""}`;
    expect(w.shown > 0, `${name}: the feed showed (${w.shown} of ${w.frames} frames watched)`);
    expect(w.firstShown > 1, `${name}: watching began before the feed first showed (it showed on frame ${w.firstShown}, after ${w.heldFrames} frames with the feed present but held)`);
    const early = w.partial.filter((p) => p.since < BACKSTOP_MS);
    const list = (xs: Watched["partial"]) => xs.map((p) => `${p.what}, ${p.since} ms after the feed mounted`).join("; ");
    if (throttle === 1 && !slow) expect(w.partial.length === 0, `${name}: no frame painted a partial row it opened with${w.partial.length ? `: ${list(w.partial)}` : ""}`);
    else
      expect(
        early.length === 0,
        `${name}: no partial row it opened with showed before the 1 s backstop${early.length ? `: ${list(early)}` : w.partial.length ? ` (the backstop showed ${w.partial.length}, ${w.partial[0]?.since} ms after the feed mounted)` : ""}`,
      );
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed in ${engine}`);
  process.exit(1);
}
console.log(`\na cold open never paints a partial row, in ${engine}`);
