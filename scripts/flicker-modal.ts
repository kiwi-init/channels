import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(name);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const dist = resolve(flag("--dist", "ui/dist"));
const engine = flag("--engine", "webkit");
const shot = flag("--shot", "channel-settings");
const seconds = Number(flag("--seconds", "45"));
const run = flag("--run", "1");
const out = resolve(flag("--out", "flicker-out/modal"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}`);
const cell = `${engine}-${shot}-r${run}`;
const dir = join(out, cell);
mkdirSync(dir, { recursive: true });

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const TRACE = () => {
  const log: Record<string, unknown>[] = [];
  const at = () => Number(performance.now().toFixed(1));
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const r = e as PerformanceResourceTiming;
      log.push({ t: Number(r.responseEnd.toFixed(1)), kind: "resource", name: r.name.replace(location.origin, ""), start: Number(r.startTime.toFixed(1)), type: r.initiatorType });
    }
  }).observe({ type: "resource", buffered: true });
  const describe = (n: Node) =>
    n instanceof Element
      ? `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}.${String(n.getAttribute("class") ?? "")
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .join(".")}`
      : n.nodeName;
  new MutationObserver((records) => {
    const t = at();
    for (const r of records) {
      if (r.type === "attributes") log.push({ t, kind: "attr", el: describe(r.target), name: r.attributeName });
      else if (r.type === "childList") {
        for (const n of r.addedNodes) log.push({ t, kind: "added", el: describe(n), parent: describe(r.target) });
        for (const n of r.removedNodes) log.push({ t, kind: "removed", el: describe(n), parent: describe(r.target) });
      } else log.push({ t, kind: "text", parent: describe(r.target.parentNode ?? r.target) });
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  let sheets = document.styleSheets.length;
  const watch = () => {
    if (document.styleSheets.length !== sheets) {
      log.push({ t: at(), kind: "sheets", from: sheets, to: document.styleSheets.length });
      sheets = document.styleSheets.length;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
  Object.assign(window, { flickerLog: log });
};

const viewport = { width: 1440, height: 900 };
const launcher = engine === "chromium" ? chromium : webkit;
const browser = await launcher.launch();
try {
  const context = await browser.newContext({ viewport, recordVideo: { dir, size: viewport } });
  await context.addInitScript(TRACE);
  const born = Date.now();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  const navAt = (Date.now() - born) / 1000;
  await page.mouse.move(2, 2);
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 20_000 });
  const dialogAt = (Date.now() - born) / 1000;
  const pageZero = await page.evaluate(() => Date.now() - performance.now());
  await page.waitForTimeout(seconds * 1000);
  const box = await dialog.boundingBox();
  const trace = (await page.evaluate(() => Reflect.get(window, "flickerLog"))) as Record<string, unknown>[];
  const endAt = (Date.now() - born) / 1000;
  await context.close();
  const video = readdirSync(dir).find((f) => f.endsWith(".webm") && f !== "video.webm");
  if (video) renameSync(join(dir, video), join(dir, "video.webm"));
  const meta = {
    cell,
    engine,
    shot,
    viewport,
    dialog: box ? { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } : null,
    navAtSeconds: navAt,
    dialogVisibleAtSeconds: dialogAt,
    endAtSeconds: endAt,
    pageTimeOriginOffsetSeconds: (pageZero - born) / 1000,
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 1));
  writeFileSync(join(dir, "trace.json"), JSON.stringify(trace));
  console.log(JSON.stringify(meta));
} finally {
  await browser.close();
  server.stop();
}
