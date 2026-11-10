#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const MOVES_ALLOWED = 0;
const MOVE_PX = 4;
const KEYS = 40;
const KEY_MS = 120;
const LOOKS = 24;
const LOOK_MS = 250;
const READ_UP = 200;
const tracing = process.argv.includes("--trace");
const loopsAt = process.argv.indexOf("--loops");
const LOOPS = loopsAt > 0 ? Math.max(1, Number(process.argv[loopsAt + 1]) || 1) : 1;

interface Step {
  t: number;
  line: string;
}

declare global {
  interface Window {
    stillTrace?: Step[];
  }
}

const TRACE = (): void => {
  const steps: Step[] = [];
  window.stillTrace = steps;
  const push = (line: string): void => {
    steps.push({ t: performance.now(), line });
    if (steps.length > 50_000) steps.splice(0, 10_000);
  };
  const px = (n: number | undefined): string => (n === undefined ? "-" : n.toFixed(2));
  const field = (o: unknown, k: string): unknown => (typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined);
  const feed = (): HTMLElement | null => document.querySelector<HTMLElement>(".feed");
  const list = (): HTMLElement | null => document.querySelector<HTMLElement>(".feed-list");
  const native = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  const read = native?.get;
  const write = native?.set;
  if (!read || !write) return;
  const top = (el: Element): number => Number(read.call(el));
  let refs: { anchor: unknown; stuck: unknown; touched: unknown } | null = null;
  const stick = (box: HTMLElement, l: HTMLElement): typeof refs => {
    if (refs) return refs;
    const key = Object.keys(box).find((k) => k.startsWith("__reactFiber$"));
    for (let fiber = key ? field(box, key) : undefined; fiber; fiber = field(fiber, "return")) {
      let hook = field(fiber, "memoizedState");
      while (hook && field(field(hook, "memoizedState"), "current") !== box) hook = field(hook, "next");
      const at = [hook];
      for (let i = 0; i < 9; i++) at.push(field(at[i], "next"));
      if (hook && field(field(at[1], "memoizedState"), "current") === l) {
        refs = { stuck: field(at[3], "memoizedState"), anchor: field(at[6], "memoizedState"), touched: field(at[9], "memoizedState") };
        return refs;
      }
    }
    return null;
  };
  const anchorOf = (r: typeof refs): string => {
    if (!r) return "?";
    const a = field(r.anchor, "current");
    if (!a) return "none";
    const el = field(a, "el");
    const name = el instanceof Element && el.classList.contains("thread-doc") ? "doc" : `row ${String(field(a, "seq"))}`;
    return `${name} top ${px(Number(field(a, "top")))} at ${px(Number(field(a, "at")))}`;
  };
  const snap = (): string => {
    const box = feed();
    const l = list();
    if (!box || !l) return "no feed";
    const view = box.getBoundingClientRect().top;
    const doc = l.querySelector(".thread-doc")?.getBoundingClientRect().top;
    const r = stick(box, l);
    const mode = r ? `${field(r.stuck, "current") ? "stuck" : "free"}${field(r.touched, "current") ? " touched" : ""}` : "?";
    return `scrollTop ${px(top(box))} docTop ${px(doc === undefined ? undefined : doc - view)} list ${px(l.getBoundingClientRect().height)} max ${px(box.scrollHeight - box.clientHeight)} anchor ${anchorOf(r)} ${mode}`;
  };
  let via = "";
  let known = Number.NaN;
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    enumerable: true,
    get(this: Element) {
      return read.call(this);
    },
    set(this: Element, v: number) {
      if (this !== feed()) return write.call(this, v);
      const from = top(this);
      write.call(this, v);
      known = top(this);
      push(`write by ${via || "effect"}: ${px(from)} asked ${px(v)} got ${px(known)} (shift ${px(known - from)})`);
    },
  });
  for (const name of ["scrollTo", "scrollBy", "scrollIntoView"] as const) {
    const original = Element.prototype[name];
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      writable: true,
      value(this: Element, ...args: unknown[]) {
        const box = feed();
        const ours = box && (this === box || box.contains(this));
        const from = box ? top(box) : 0;
        Reflect.apply(original, this, args);
        if (ours && box) {
          known = top(box);
          push(`${name} by ${via || "effect"} on ${this === box ? "feed" : this.className}: ${px(from)} → ${px(known)} ${JSON.stringify(args)}`);
        }
      },
    });
  }
  const Native = window.ResizeObserver;
  window.ResizeObserver = class extends Native {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        const box = feed();
        const l = list();
        const ours = entries.filter((e) => e.target === box || e.target === l);
        if (!ours.length) return callback(entries, observer);
        const why = ours.map((e) => `${e.target === box ? "feed" : "list"} ${px(e.contentRect.height)}`).join(" + ");
        push(`settle on resize of ${why}: before ${snap()}`);
        via = "resize";
        try {
          callback(entries, observer);
        } finally {
          via = "";
        }
        push(`settle on resize of ${why}: after ${snap()}`);
      });
    }
  };
  const ended = new WeakSet<Element>();
  document.addEventListener(
    "scroll",
    (e) => {
      const box = feed();
      if (e.target !== box || !box) return;
      const now = top(box);
      const odd = Number.isNaN(known) || Math.abs(now - known) <= 0.5 ? "" : ` (moved ${px(now - known)} by no write)`;
      known = now;
      push(`scroll event${odd}: ${snap()}`);
      via = "scroll";
      if (!ended.has(box)) {
        ended.add(box);
        box.addEventListener("scroll", () => (via = ""));
      }
    },
    true,
  );
  document.addEventListener("wheel", (e) => push(`wheel ${e.deltaY}`), true);
  const watched = new WeakSet<Element>();
  let lastDoc = Number.NaN;
  const frame = (): void => {
    const box = feed();
    const l = list();
    if (box && l && !watched.has(l)) {
      watched.add(l);
      new MutationObserver((records) => {
        const rows = records.flatMap((r) => [...r.addedNodes]).filter((n) => n instanceof HTMLElement && n.dataset.seq).length;
        const gone = records.flatMap((r) => [...r.removedNodes]).flatMap((n) => (n instanceof HTMLElement && n.dataset.seq ? [n.dataset.seq] : []));
        if (rows || gone.length) push(`rows +${rows}${gone.length ? ` −${gone.length} (seq ${gone.join(", ")})` : ""} committed: ${snap()}`);
      }).observe(l, { childList: true });
    }
    const doc = box && l?.querySelector(".thread-doc");
    if (box && doc) {
      const now = doc.getBoundingClientRect().top - box.getBoundingClientRect().top;
      if (Math.abs(now - lastDoc) > 0.5) push(`frame: docTop ${px(lastDoc)} → ${px(now)}: ${snap()}`);
      lastDoc = now;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

async function open(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (tracing) await page.addInitScript(TRACE);
  await page.goto(`http://127.0.0.1:${server.port}/?shot=thread-doc-busy`);
  await page.waitForSelector(".thread-doc .ProseMirror", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  return page;
}

function moves(ys: readonly number[]): number {
  return ys.slice(1).filter((y, i) => Math.abs(y - (ys[i] ?? y)) > MOVE_PX).length;
}

async function typing(browser: Browser): Promise<string | null> {
  const page = await open(browser);
  try {
    await page.locator(".main .composer textarea").first().click();
    const ys: number[] = [];
    for (let i = 0; i < KEYS; i++) {
      await page.keyboard.type("a");
      await page.waitForTimeout(KEY_MS);
      const y = await page.evaluate(
        () =>
          new Promise<number | null>((done) =>
            requestAnimationFrame(() =>
              setTimeout(() => {
                const area = document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
                done(area ? Math.round(area.getBoundingClientRect().top) : null);
              }, 0),
            ),
          ),
      );
      if (y !== null) ys.push(y);
    }
    const n = moves(ys);
    return ys.length < KEYS
      ? `the composer lost the focus after ${ys.length} of ${KEYS} keys`
      : n <= MOVES_ALLOWED
        ? null
        : `the composer moved ${n} times in ${KEYS} keys: ${[...new Set(ys)].join(" → ")}`;
  } finally {
    await page.close();
  }
}

async function watchOnce(browser: Browser, loop: number): Promise<string | null> {
  const page = await open(browser);
  try {
    const box = await page.locator(".feed").first().boundingBox();
    if (!box) return "no feed on screen";
    const from = await page.evaluate(() => performance.now());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, -READ_UP);
    await page.waitForTimeout(500);
    const below = await page.evaluate(() => {
      const feed = document.querySelector(".feed");
      return feed ? feed.scrollHeight - feed.scrollTop - feed.clientHeight : 0;
    });
    const ys: number[] = [];
    for (let i = 0; below >= READ_UP / 2 && i < LOOKS; i++) {
      await page.waitForTimeout(LOOK_MS);
      ys.push(
        await page.evaluate(
          () => new Promise<number>((done) => requestAnimationFrame(() => setTimeout(() => done(Math.round(document.querySelector(".thread-doc")?.getBoundingClientRect().top ?? -1)), 0))),
        ),
      );
    }
    const n = moves(ys);
    const why =
      below < READ_UP / 2
        ? `the read never left the bottom: ${Math.round(below)} px below the view after scrolling ${READ_UP} px up`
        : n <= MOVES_ALLOWED
          ? null
          : `the doc moved ${n} times in ${(LOOKS * LOOK_MS) / 1000} s: ${[...new Set(ys)].join(" → ")}`;
    if (tracing && (why || loop === 1)) {
      const steps = await page.evaluate((since) => (window.stillTrace ?? []).filter((s) => s.t >= since), from);
      console.log(`--- settle trace, loop ${loop} (${why ? "moved" : "still"}), ${steps.length} steps, ms from the first wheel:`);
      for (const s of steps) console.log(`${(s.t - from).toFixed(1).padStart(8)}  ${s.line}`);
      console.log("--- end of trace");
    }
    return why;
  } finally {
    await page.close();
  }
}

async function watching(browser: Browser): Promise<string | null> {
  for (let loop = 1; loop <= LOOPS; loop++) {
    const why = await watchOnce(browser, loop);
    if (why) return LOOPS > 1 ? `${why} (loop ${loop} of ${LOOPS})` : why;
    if (LOOPS > 1 && loop % 10 === 0) console.log(`  ${loop} of ${LOOPS} loops still`);
  }
  if (LOOPS > 1) console.log(`  the doc stayed still in all ${LOOPS} loops`);
  return null;
}

const engine = process.argv.includes("--chromium") ? "chromium" : "webkit";
const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
let failed = 0;
try {
  for (const [what, check] of [
    ["the composer you type in stays put while lines arrive", typing],
    ["the doc stays put while you read a little above the bottom and lines arrive", watching],
  ] as const) {
    const why = await check(browser);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} thread-doc-busy: ${what}${why ? `: ${why}` : ""}`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} doc checks moved the view on their own, in ${engine === "webkit" ? "WebKit" : "Chromium"}`);
  process.exitCode = 1;
}
