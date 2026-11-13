import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(name);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const dist = resolve(flag("--dist", "ui/dist"));
const scale = Number(flag("--scale", "1"));
const scroll = flag("--scroll", "bottom");
const focus = flag("--focus", "off");
const windows = Number(flag("--windows", "3"));
const seconds = Number(flag("--seconds", "30"));
const traced = flag("--trace", "on") === "on";
const out = resolve(flag("--out", "flicker-out"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}`);
const cell = `scale${scale}-${scroll}-focus${focus}-${traced ? "traced" : "plain"}`;
mkdirSync(join(out, cell), { recursive: true });

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const HOOKS = () => {
  const log: Record<string, unknown>[] = [];
  let frame = 0;
  const id = (el: Element | null): string => {
    if (!el) return "none";
    const seq = el instanceof HTMLElement && el.dataset["seq"] ? `#${el.dataset["seq"]}` : "";
    return `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(".")}${seq}`;
  };
  const caller = (): string =>
    (new Error().stack ?? "")
      .split("\n")
      .slice(2, 6)
      .map((l) =>
        l
          .replace(/https?:\/\/[^/]+\/assets\//, "")
          .replace(/\?[^:]*/, "")
          .trim(),
      )
      .join(" < ");
  const top = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  if (top?.set && top.get) {
    const get = top.get;
    const set = top.set;
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(v: number) {
        const before = get.call(this);
        set.call(this, v);
        log.push({ t: performance.now(), frame, kind: "scrollTop", el: id(this as Element), asked: v, before, after: get.call(this), caller: caller() });
      },
    });
  }
  const Native = window.ResizeObserver;
  window.ResizeObserver = class extends Native {
    constructor(cb: ResizeObserverCallback) {
      super((entries, obs) => {
        log.push({
          t: performance.now(),
          frame,
          kind: "resize",
          targets: entries.map((e) => `${id(e.target)} ${e.contentRect.width.toFixed(2)}x${e.contentRect.height.toFixed(2)}`),
        });
        cb(entries, obs);
      });
    }
  };
  const rect = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Number(r.top.toFixed(3)), Number(r.height.toFixed(3))];
  };
  const sample = () => {
    frame++;
    const feed = document.querySelector<HTMLElement>(".feed");
    if (feed) {
      const rows = [...feed.querySelectorAll<HTMLElement>("[data-seq]")].filter((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > 0 && b.top < innerHeight;
      });
      log.push({
        t: performance.now(),
        frame,
        kind: "frame",
        scrollTop: feed.scrollTop,
        scrollHeight: feed.scrollHeight,
        clientHeight: feed.clientHeight,
        feed: rect(feed),
        rows: Object.fromEntries(rows.map((r) => [r.dataset["seq"], rect(r)])),
        composer: rect(document.querySelector(".compose")),
        step: rect(document.querySelector(".step textarea, .ask-step textarea")),
        shell: rect(document.querySelector(".rail")),
        avatar: rect(document.querySelector(".msg-av, .avatar")),
        spacer: (feed.querySelector<HTMLElement>(":scope > div:last-child")?.style.height ?? "") || "0",
      });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  Object.assign(window, { flickerLog: log, flickerFrame: () => frame });
};

const browser = await webkit.launch();
const summary: Record<string, unknown>[] = [];
try {
  const page = await browser.newPage({ viewport: { width: Math.round(1421 / scale), height: Math.round(1298 / scale) }, deviceScaleFactor: scale });
  if (traced) await page.addInitScript(HOOKS);
  await page.goto(`http://127.0.0.1:${server.port}/?shot=flicker`);
  await page.locator(".feed [data-seq]").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "* { caret-color: transparent !important; }" });
  const textarea = page.locator(".feed textarea").first();
  await textarea.waitFor({ timeout: 10_000 }).catch(() => undefined);
  const hasStep = (await textarea.count()) > 0;
  if (scroll === "up") {
    const box = await page.locator(".feed").boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -2 * box.height);
    }
  }
  await page.waitForTimeout(600);
  if (focus === "on" && hasStep) await textarea.focus();
  else await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.waitForTimeout(2000);
  const env = await page.evaluate(() => ({ dpr: devicePixelRatio, inner: `${innerWidth}x${innerHeight}`, ua: navigator.userAgent, fonts: document.fonts.status }));
  const clipOf = async (p: Page) => {
    const b = await p.locator(".feed").boundingBox();
    return b ? { x: Math.round(b.x + 72), y: Math.round(b.y), width: Math.round(b.width - 72), height: Math.round(b.height) } : undefined;
  };
  for (let w = 1; w <= windows; w++) {
    if (traced) await page.evaluate(() => (Reflect.get(window, "flickerLog") as unknown[]).splice(0));
    const clip = await clipOf(page);
    const frames: { t: number; changed: boolean }[] = [];
    let last: Buffer | null = null;
    let changed = 0;
    const start = Date.now();
    while (Date.now() - start < seconds * 1000) {
      const t = Date.now() - start;
      const shot = await page.screenshot({ clip, animations: "allow" });
      const diff = last !== null && !shot.equals(last);
      if (diff) {
        changed++;
        if (changed <= 12) writeFileSync(join(out, cell, `w${w}-change${changed}-${t}ms.png`), shot);
        if (changed <= 12 && last) writeFileSync(join(out, cell, `w${w}-change${changed}-${t}ms-before.png`), last);
      }
      frames.push({ t, changed: diff });
      last = shot;
    }
    const trace = traced ? ((await page.evaluate(() => Reflect.get(window, "flickerLog"))) as Record<string, unknown>[]) : [];
    if (traced) writeFileSync(join(out, cell, `w${w}-trace.json`), JSON.stringify(trace));
    const samples = trace.filter((e) => e["kind"] === "frame");
    const writes = trace.filter((e) => e["kind"] === "scrollTop");
    const resizes = trace.filter((e) => e["kind"] === "resize");
    let moved = 0;
    const moves: string[] = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      const ra = a["rows"] as Record<string, number[]>;
      const rb = b["rows"] as Record<string, number[]>;
      const shifts = Object.keys(rb)
        .filter((k) => ra[k] && Math.abs(ra[k]![0]! - rb[k]![0]!) > 0.01)
        .map((k) => `${k}:${(rb[k]![0]! - ra[k]![0]!).toFixed(3)}`);
      const st = Number(b["scrollTop"]) - Number(a["scrollTop"]);
      const comp = JSON.stringify(a["composer"]) !== JSON.stringify(b["composer"]) || JSON.stringify(a["step"]) !== JSON.stringify(b["step"]);
      if (shifts.length || Math.abs(st) > 0.001 || comp) {
        moved++;
        if (moves.length < 20) moves.push(`frame ${b["frame"]} t=${Number(b["t"]).toFixed(1)}: scrollTop ${st.toFixed(3)}; rows ${shifts.slice(0, 4).join(" ")}${comp ? "; composer/step moved" : ""}`);
      }
    }
    const row = {
      cell,
      window: w,
      env,
      hasStep,
      captures: frames.length,
      capturesPerSecond: Number((frames.length / seconds).toFixed(1)),
      pixelChanges: changed,
      rafSamples: samples.length,
      geometryMoves: moved,
      scrollTopWrites: writes.length,
      scrollTopWritesThatMoved: writes.filter((e) => Math.abs(Number(e["after"]) - Number(e["before"])) > 0.001).length,
      resizeCallbacks: resizes.length,
      firstMoves: moves,
      firstWrites: writes.slice(0, 6).map((e) => `${Number(e["t"]).toFixed(1)} ${e["el"]} ${e["before"]}->${e["after"]} (${e["caller"]})`),
      firstResizes: resizes.slice(0, 4).map((e) => `${Number(e["t"]).toFixed(1)} ${(e["targets"] as string[]).join(", ")}`),
    };
    summary.push(row);
    console.log(JSON.stringify(row));
  }
} finally {
  writeFileSync(join(out, cell, "summary.json"), JSON.stringify(summary, null, 1));
  await browser.close();
  await server.stop(true);
}
