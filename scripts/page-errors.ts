import type { Page } from "playwright-core";

const TAG = "kiwi-resize-observers ";
const FRESH_MS = 2000;
const FRAMES = 8;

export interface Observers {
  late: string[];
  ran: string[];
}

export interface PageError {
  message: string;
  stack?: string;
  after: string;
  observers?: Observers;
}

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

function frames(message: string, stack: string | undefined): string[] {
  return (stack ?? "")
    .split("\n")
    .map((l) => l.replace(/https?:\/\/[^/\s)]+\//g, "").trim())
    .filter((l) => l && !l.includes(message.trim()))
    .slice(0, FRAMES);
}

export function observerLines(seen: Observers): string[] {
  return [
    ...(seen.late.length ? ["changed size after its observer last ran:", ...seen.late.map((l) => `  ${l}`)] : ["no watched element had changed size when the error came"]),
    ...(seen.ran.length ? ["resize observers that ran just before:", ...seen.ran.map((l) => `  ${l}`)] : ["no resize observer ran just before"]),
  ];
}

export function describePageError(e: PageError): string {
  const stack = frames(e.message, e.stack);
  return [
    e.message.trim(),
    e.after ? `after: ${e.after}` : "before anything was printed",
    ...(stack.length ? ["stack:", ...stack.map((l) => `  ${l}`)] : ["stack: the engine gave none"]),
    ...(e.observers ? observerLines(e.observers) : []),
  ].join("\n    ");
}

function observersIn(text: string): Observers | null {
  try {
    const seen: unknown = JSON.parse(text);
    if (seen === null || typeof seen !== "object") return null;
    const { late, ran } = seen as { late?: unknown; ran?: unknown };
    const lines = (x: unknown): string[] => (Array.isArray(x) ? x.filter((l): l is string => typeof l === "string") : []);
    return { late: lines(late), ran: lines(ran) };
  } catch {
    // a page's own debug line that starts like ours is not a trace
    return null;
  }
}

function traceObservers(tag: string): void {
  const Real = window.ResizeObserver;
  if (!Real) return;
  interface Made {
    id: number;
    where: string;
    sizes: Map<Element, [number, number]>;
  }
  const live = new Set<Made>();
  const owned = new WeakMap<ResizeObserver, Made>();
  const ran: { at: number; line: string }[] = [];
  let count = 0;
  const name = (el: Element): string =>
    `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}`;
  const size = (e: ResizeObserverEntry): [number, number] => {
    const box = e.borderBoxSize?.[0];
    return box ? [box.inlineSize, box.blockSize] : [e.contentRect.width, e.contentRect.height];
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
        sizes: new Map(),
      };
      super((entries, self) => {
        live.add(made);
        for (const e of entries) made.sizes.set(e.target, size(e));
        ran.push({
          at: performance.now(),
          line: `observer ${made.id}${made.where ? ` (made at ${made.where})` : ""}: ${entries
            .map((e) => `${name(e.target)} ${Math.round(size(e)[0])}x${Math.round(size(e)[1])}`)
            .join(", ")
            .slice(0, 400)}`,
        });
        if (ran.length > 60) ran.shift();
        run(entries, self);
      });
      owned.set(this, made);
    }
    unobserve(target: Element): void {
      owned.get(this)?.sizes.delete(target);
      super.unobserve(target);
    }
    disconnect(): void {
      const made = owned.get(this);
      if (made) {
        made.sizes.clear();
        live.delete(made);
      }
      super.disconnect();
    }
  };
  window.addEventListener("error", (e) => {
    if (!String(e.message).includes("ResizeObserver")) return;
    const now = performance.now();
    const late: string[] = [];
    for (const made of live) {
      for (const [el, [w, h]] of made.sizes) {
        if (!(el instanceof HTMLElement) || !el.isConnected) continue;
        if (Math.abs(el.offsetWidth - w) < 1 && Math.abs(el.offsetHeight - h) < 1) continue;
        late.push(`${name(el)} ${Math.round(w)}x${Math.round(h)} -> ${el.offsetWidth}x${el.offsetHeight}, watched by observer ${made.id}${made.where ? ` (made at ${made.where})` : ""}`);
      }
    }
    console.debug(
      tag +
        JSON.stringify({
          late: late.slice(0, 12),
          ran: ran
            .filter((r) => now - r.at < 250)
            .map((r) => r.line)
            .slice(-20),
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
