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
    "usage: bun scripts/ui-cold-whole.ts [--dist ui/dist] [--browser webkit|chromium]\n\nA cold open never paints a partial row (#2513): from the first frame until the feed settles, whenever the feed is visible, no row on screen still shows plain text waiting for markdown or a card waiting for its code, and no thread doc is still loading under the rows. Runs a quiet channel and a busy thread doc, at full speed and at 4x CPU (chromium only).",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const WATCH_MS = 3_000;
const SCENES = ["channel", "thread-doc-busy"];

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
  partial: { t: number; what: string }[];
}

async function cold(scene: string, throttle: number): Promise<Watched> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  await page.addInitScript((watchMs: number) => {
    const out = { frames: 0, shown: 0, firstShown: -1, heldFrames: 0, partial: [] as { t: number; what: string }[] };
    (window as unknown as { __whole: typeof out }).__whole = out;
    const onScreen = (el: Element, view: DOMRect) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.bottom > view.top && r.top < view.bottom;
    };
    const tick = () => {
      out.frames++;
      const list = document.querySelector<HTMLElement>(".feed-list");
      const feed = list?.parentElement;
      if (list && (list.hasAttribute("data-unfinished") || getComputedStyle(list).visibility === "hidden")) out.heldFrames++;
      if (list && feed && !list.hasAttribute("data-unfinished") && getComputedStyle(list).visibility !== "hidden") {
        out.shown++;
        if (out.firstShown < 0) out.firstShown = out.frames;
        const view = feed.getBoundingClientRect();
        for (const el of list.querySelectorAll(".md-plain, .lazy-wait")) {
          const row = el.closest("[data-seq], section.blk");
          const what = row
            ? el.classList.contains("md-plain")
              ? `plain text in row ${row.getAttribute("data-seq") ?? "doc block"}`
              : `a loading card in row ${row.getAttribute("data-seq") ?? "doc block"}`
            : "a thread doc still loading under the rows";
          if (!row || onScreen(row, view)) {
            if (out.partial.length < 10) out.partial.push({ t: Math.round(performance.now()), what });
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
  for (const throttle of engine === "chromium" ? [1, 4] : [1])
    for (const scene of SCENES) {
      const w = await cold(scene, throttle);
      expect(w.shown > 0, `${scene} @${throttle}x: the feed showed (${w.shown} of ${w.frames} frames watched)`);
      expect(w.firstShown > 1, `${scene} @${throttle}x: watching began before the feed first showed (it showed on frame ${w.firstShown}, after ${w.heldFrames} frames with the feed present but held)`);
      expect(w.partial.length === 0, `${scene} @${throttle}x: no frame painted a partial row${w.partial.length ? `: ${w.partial.map((p) => `${p.what} at ${p.t} ms`).join("; ")}` : ""}`);
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
