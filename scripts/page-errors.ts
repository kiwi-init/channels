import type { Page } from "playwright-core";
import { describePageError, observerLines, type Observers } from "./page-error-lines.ts";

const TAG = "kiwi-resize-observers ";
const FRESH_MS = 2000;

let said = "";
let print: (...parts: unknown[]) => void = console.log.bind(console);
let tapped = false;

function tap(): void {
  if (tapped) return;
  tapped = true;
  print = console.log.bind(console);
  console.log = (...parts: unknown[]) => {
    const line = parts
      .map((p) => (typeof p === "string" ? p : ""))
      .join(" ")
      .split("\n")
      .findLast((l) => l.trim());
    if (line) said = line.trim().slice(0, 200);
    print(...parts);
  };
}

function observersIn(text: string): Observers | null {
  try {
    const seen: unknown = JSON.parse(text);
    if (seen === null || typeof seen !== "object") return null;
    const { late, untold, ran, loading } = seen as { late?: unknown; untold?: unknown; ran?: unknown; loading?: unknown };
    const lines = (x: unknown): string[] => (Array.isArray(x) ? x.filter((l): l is string => typeof l === "string") : []);
    return { late: lines(late), untold: lines(untold), ran: lines(ran), loading: lines(loading) };
  } catch {
    // a page's own debug line that starts like ours is not a trace
    return null;
  }
}

function traceObservers(tag: string): void {
  const Real = window.ResizeObserver;
  if (!Real) return;
  interface Watched {
    box: ResizeObserverBoxOptions;
    told: [number, number] | null;
    since: number;
  }
  interface Made {
    id: number;
    where: string;
    watched: Map<Element, Watched>;
  }
  const live = new Set<Made>();
  const owned = new WeakMap<ResizeObserver, Made>();
  const ran: { at: number; line: string }[] = [];
  let count = 0;
  const name = (el: Element): string =>
    `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}`;
  const toldSize = (e: ResizeObserverEntry, box: ResizeObserverBoxOptions): [number, number] => {
    const of = (box === "border-box" ? e.borderBoxSize : box === "device-pixel-content-box" ? e.devicePixelContentBoxSize : e.contentBoxSize)?.[0];
    return of ? [of.inlineSize, of.blockSize] : [e.contentRect.width, e.contentRect.height];
  };
  const px = (v: string): number => Number.parseFloat(v) || 0;
  const sizeNow = (el: HTMLElement, box: ResizeObserverBoxOptions): [number, number] => {
    if (box === "border-box") return [el.offsetWidth, el.offsetHeight];
    const s = getComputedStyle(el);
    const scale = box === "device-pixel-content-box" ? window.devicePixelRatio : 1;
    return [(el.clientWidth - px(s.paddingLeft) - px(s.paddingRight)) * scale, (el.clientHeight - px(s.paddingTop) - px(s.paddingBottom)) * scale];
  };
  window.ResizeObserver = class extends Real {
    constructor(run: ResizeObserverCallback) {
      const made: Made = {
        id: ++count,
        where: (new Error().stack ?? "")
          .split("\n")
          .map((l) => l.replace(/https?:\/\/[^/\s)]+\//g, "").trim())
          .filter((l) => /\.[cm]?[jt]sx?[:?]/.test(l))
          .slice(0, 2)
          .join(" < "),
        watched: new Map(),
      };
      super((entries, self) => {
        const sizes = entries.map((e): [Element, [number, number]] => {
          const seen = made.watched.get(e.target) ?? { box: "content-box", told: null, since: performance.now() };
          seen.told = toldSize(e, seen.box);
          made.watched.set(e.target, seen);
          return [e.target, seen.told];
        });
        ran.push({
          at: performance.now(),
          line: `observer ${made.id}${made.where ? ` (made at ${made.where})` : ""}: ${sizes
            .map(([el, [w, h]]) => `${name(el)} ${Math.round(w)}x${Math.round(h)}`)
            .join(", ")
            .slice(0, 400)}`,
        });
        if (ran.length > 60) ran.shift();
        run(entries, self);
      });
      owned.set(this, made);
    }
    observe(target: Element, options?: ResizeObserverOptions): void {
      const made = owned.get(this);
      if (made) {
        live.add(made);
        made.watched.set(target, { box: options?.box ?? "content-box", told: null, since: performance.now() });
      }
      super.observe(target, options);
    }
    unobserve(target: Element): void {
      owned.get(this)?.watched.delete(target);
      super.unobserve(target);
    }
    disconnect(): void {
      const made = owned.get(this);
      if (made) {
        made.watched.clear();
        live.delete(made);
      }
      super.disconnect();
    }
  };
  window.addEventListener("error", (e) => {
    if (!String(e.message).includes("ResizeObserver")) return;
    const now = performance.now();
    const late: string[] = [];
    const untold: { since: number; line: string }[] = [];
    for (const made of live) {
      const by = `observer ${made.id}${made.where ? ` (made at ${made.where})` : ""}`;
      for (const [el, { box, told, since }] of made.watched) {
        if (!(el instanceof HTMLElement) || !el.isConnected) continue;
        const [w, h] = sizeNow(el, box);
        if (!told) untold.push({ since, line: `${name(el)} ${Math.round(w)}x${Math.round(h)}, put under watch ${Math.round(now - since)} ms before by ${by}` });
        else if (Math.abs(w - told[0]) >= 1 || Math.abs(h - told[1]) >= 1)
          late.push(`${name(el)} ${Math.round(told[0])}x${Math.round(told[1])} -> ${Math.round(w)}x${Math.round(h)}, watched by ${by}`);
      }
    }
    console.debug(
      tag +
        JSON.stringify({
          late: late.slice(0, 12),
          untold: untold
            .sort((a, b) => b.since - a.since)
            .slice(0, 12)
            .map((u) => u.line),
          ran: ran
            .filter((r) => now - r.at < 250)
            .map((r) => r.line)
            .slice(-20),
          loading: [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
            .filter((l) => !l.sheet)
            .map((l) => l.href.replace(/^https?:\/\/[^/]+\//, ""))
            .slice(0, 30),
        }),
    );
  });
}

export async function pageErrors(page: Page, tell: (error: string) => void, { observers = true }: { observers?: boolean } = {}): Promise<void> {
  tap();
  let seen: { at: number; observers: Observers } | null = null;
  let owed = false;
  page.on("console", (m) => {
    if (m.type() !== "debug" || !m.text().startsWith(TAG)) return;
    const found = observersIn(m.text().slice(TAG.length));
    if (!found) return;
    if (!owed) {
      seen = { at: Date.now(), observers: found };
      return;
    }
    owed = false;
    print(`    ${observerLines(found).join("\n    ")}`);
  });
  page.on("pageerror", (e) => {
    const loop = observers && e.message.includes("ResizeObserver");
    const known = loop && seen && Date.now() - seen.at < FRESH_MS ? seen.observers : undefined;
    seen = null;
    owed = loop && !known;
    tell(describePageError({ message: e.message, stack: e.stack, after: said, observers: known }));
  });
  if (observers) await page.addInitScript(traceObservers, TAG);
}
