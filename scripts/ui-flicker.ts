import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};

if (process.argv.includes("--help")) {
  console.log(`Drives the app's main flows and lists every flicker: an element whose box, opacity, colours or text changes and comes
back within --short ms (a return), or holds a state for at most --short ms between two states held at least --steady ms, that
is not on the way from the first to the second (a detour). Every element is read right after each frame is drawn (a
MessageChannel message posted from requestAnimationFrame runs after the paint), so a state that never reached the screen,
such as a scroll a ResizeObserver corrects in the same frame, is not counted.

  bun scripts/ui-flicker.ts --dist ui/dist --browser webkit|chromium [--flow NAME] [--live] [--out DIR] [--short 100] [--steady 150]`);
  process.exit(0);
}

const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const only = flag("--flow");
const live = process.argv.includes("--live");
const out = flag("--out");
const SHORT_MS = Number(flag("--short") ?? 100);
const STEADY_MS = Number(flag("--steady") ?? 150);
const STEP_MS = 3000;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const base = `http://127.0.0.1:${server.port}/`;

type Log = { times: number[]; labels: [number, string][]; changes: Record<string, [number, string][]> };

const recorder = () => {
  const cut = (s: string) => (s.length > 40 ? s.slice(0, 40) : s);
  const keys = new WeakMap<Element, string>();
  const keyOf = (el: Element): string => {
    const known = keys.get(el);
    if (known) return known;
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body && parts.length < 7; e = e.parentElement) {
      const cls = [...e.classList].filter((c) => !c.startsWith("is-") && !c.startsWith("has-")).slice(0, 2);
      const at = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
      parts.unshift(`${e.tagName.toLowerCase()}${cls.length ? `.${cls.join(".")}` : ""}:${at}`);
    }
    const key = parts.join(">");
    keys.set(el, key);
    return key;
  };
  const styles = new WeakMap<Element, CSSStyleDeclaration>();
  const last = new Map<string, string>();
  const log: Log = { times: [], labels: [[0, "load"]], changes: {} };
  const read = () => {
    const w = innerWidth;
    const h = innerHeight;
    const seen = new Map<string, string>();
    const moving = new Set<Element>();
    for (const a of document.getAnimations()) {
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (a.playState === "running" && target instanceof Element) moving.add(target);
    }
    const animated = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) if (moving.has(e)) return true;
      return false;
    };
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= w || r.top >= h) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      let cs = styles.get(el);
      if (!cs) {
        cs = getComputedStyle(el);
        styles.set(el, cs);
      }
      const text = el.childElementCount === 0 ? cut((el.textContent ?? "").trim()) : "";
      let key = keyOf(el);
      while (seen.has(key)) key += "+";
      seen.set(
        key,
        `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}|${cs.opacity}|${cs.backgroundColor}|${cs.color}|${text}${moving.size && animated(el) ? "|~" : ""}`,
      );
    }
    return seen;
  };
  const painted = new MessageChannel();
  const tick = () => {
    painted.port2.postMessage(0);
    requestAnimationFrame(tick);
  };
  painted.port1.onmessage = () => {
    if (document.body) {
      const frame = log.times.length;
      log.times.push(Math.round(performance.now()));
      const now = read();
      for (const [key, state] of now) {
        if (last.get(key) !== state) (log.changes[key] ??= []).push([frame, state]);
        last.set(key, state);
      }
      for (const key of last.keys()) {
        if (!now.has(key)) {
          (log.changes[key] ??= []).push([frame, "-"]);
          last.delete(key);
        }
      }
    }
  };
  requestAnimationFrame(tick);
  Object.assign(window, {
    __flicker: {
      mark: (label: string) => void log.labels.push([log.times.length, label]),
      take: () => ({ ...log, times: [...log.times, Math.round(performance.now())] }),
    },
  });
};

type Hit = { flow: string; step: string; frame: number; t: number; key: string; kind: "return" | "detour"; ms: number; from: string; via: string[]; to: string };

const ANIMATED = "|~";

const TEXT = 4;
const nums = (s: string) => (s.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const between = (a: string, b: string, c: string) => {
  if (a === "-" || b === "-" || c === "-") return false;
  const [fa, fb, fc] = [a.split("|"), b.split("|"), c.split("|")];
  return fb.every((v, i) => {
    if (v === fa[i] || v === fc[i]) return true;
    if (i === TEXT) return false;
    const [na, nb, nc] = [nums(fa[i] ?? ""), nums(v), nums(fc[i] ?? "")];
    const slack = i === 1 ? 0.01 : 1;
    return nb.length === na.length && nb.length === nc.length && nb.every((x, k) => x >= Math.min(na[k]!, nc[k]!) - slack && x <= Math.max(na[k]!, nc[k]!) + slack);
  });
};

const hitsOf = (flow: string, log: Log): Hit[] => {
  const end = log.times.length - 1;
  const at = (frame: number) => log.times[frame] ?? log.times[end] ?? 0;
  const stepAt = (frame: number) => log.labels.filter(([f]) => f <= frame).at(-1)?.[1] ?? "load";
  const hits: Hit[] = [];
  for (const [key, list] of Object.entries(log.changes)) {
    const segs = list.map(([frame, state], i) => ({ frame, state, ms: at(list[i + 1]?.[0] ?? end) - at(frame) }));
    if (list[0] && list[0][0] > 0) segs.unshift({ frame: 0, state: "-", ms: at(list[0][0]) - at(0) });
    for (let i = 0; i + 2 < segs.length; i++) {
      const a = segs[i]!;
      if (a.ms < STEADY_MS) continue;
      let span = 0;
      for (let j = i + 1; j < segs.length; j++) {
        const b = segs[j]!;
        if (b.state === a.state) {
          const via = segs.slice(i + 1, j);
          if (j > i + 1 && !via.some((s) => s.state.endsWith(ANIMATED)))
            hits.push({
              flow,
              step: stepAt(via[0]!.frame),
              frame: via[0]!.frame,
              t: at(via[0]!.frame) - at(0),
              key,
              kind: "return",
              ms: span,
              from: a.state,
              via: via.map((s) => s.state),
              to: b.state,
            });
          break;
        }
        span += b.ms;
        if (span > SHORT_MS) break;
      }
      const b = segs[i + 1]!;
      const c = segs[i + 2]!;
      if (b.ms <= SHORT_MS && c.ms >= STEADY_MS && c.state !== a.state && !b.state.endsWith(ANIMATED) && !between(a.state, b.state, c.state))
        hits.push({ flow, step: stepAt(b.frame), frame: b.frame, t: at(b.frame) - at(0), key, kind: "detour", ms: b.ms, from: a.state, via: [b.state], to: c.state });
    }
  }
  return hits;
};

const skipped: string[] = [];
const settle = (page: Page, ms = 1200) => page.waitForTimeout(ms);
const mark = (page: Page, label: string) => page.evaluate((l) => (window as unknown as { __flicker: { mark: (l: string) => void } }).__flicker.mark(l), label);
const step = async (page: Page, label: string, act: () => Promise<unknown>, ms?: number) => {
  await mark(page, label);
  try {
    await act();
  } catch (e) {
    // A step that can't run is listed and the flow goes on, so one missing control doesn't hide the rest.
    skipped.push(`${label}: ${String(e instanceof Error ? e.message : e).split("\n")[0]}`);
  }
  await settle(page, ms);
};
const clickAll = async (page: Page, selector: string, label: (text: string) => string, limit = 12) => {
  const rows = page.locator(selector);
  const n = Math.min(await rows.count(), limit);
  if (n === 0) skipped.push(`${label("")}: nothing matches ${selector}`);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    if (!(await row.isVisible())) continue;
    const text = ((await row.innerText({ timeout: STEP_MS }).catch(() => "")) || (await row.getAttribute("aria-label", { timeout: STEP_MS }).catch(() => "")) || `#${i}`)
      .split("\n")[0]!
      .trim()
      .slice(0, 30);
    await step(page, label(text), () => row.click({ timeout: STEP_MS }));
    if (await page.locator("dialog[open], [role=dialog]").count()) await step(page, "close the dialog", () => page.keyboard.press("Escape"), 800);
  }
};
const click = (page: Page, selector: string, options: { button?: "right"; last?: boolean; nth?: number } = {}) => {
  const all = page.locator(selector);
  const one = options.last ? all.last() : all.nth(options.nth ?? 0);
  return one.click({ timeout: STEP_MS, ...(options.button ? { button: options.button } : {}) });
};

type Flow = { name: string; shot: string; run: (page: Page) => Promise<void> };
const FLOWS: Flow[] = [
  { name: "cold open", shot: "channel", run: async () => {} },
  {
    name: "channel tabs",
    shot: "channel",
    run: async (page) => {
      await clickAll(page, ".rail .tile", (t) => `tab ${t}`);
      await step(page, "back to the first tab", () => click(page, ".rail .tile"));
    },
  },
  { name: "sidebar views", shot: "channel", run: (page) => clickAll(page, ".side-views .side-row", (t) => `view ${t}`) },
  {
    name: "rooms and people",
    shot: "channel",
    run: async (page) => {
      await clickAll(page, '.side section[aria-label="Rooms"] .side-row', (t) => `room ${t}`);
      await clickAll(page, '.side section[aria-label="People"] .side-row', (t) => `person ${t}`, 6);
      await clickAll(page, '.side section[aria-label="Agents"] .side-row', (t) => `agent ${t}`, 6);
    },
  },
  {
    name: "thread",
    shot: "channel",
    run: async (page) => {
      await step(page, "open a thread", () => click(page, ".main .msg-thread"));
      await step(page, "close it", () => page.keyboard.press("Escape"));
    },
  },
  {
    name: "type and send",
    shot: "channel",
    run: async (page) => {
      await step(page, "focus the composer", () => click(page, ".main .composer textarea"));
      await step(page, "type", () => page.keyboard.type("Checking how the feed takes a new message", { delay: 30 }));
      await step(page, "send", () => page.keyboard.press("Enter"), 2000);
    },
  },
  {
    name: "scroll the feed",
    shot: "long-feed",
    run: async (page) => {
      await page.mouse.move(700, 450);
      await step(page, "wheel up", async () => {
        for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400).then(() => page.waitForTimeout(60));
      });
      await step(page, "wheel down", async () => {
        for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400).then(() => page.waitForTimeout(60));
      });
    },
  },
  {
    name: "settings",
    shot: "channel",
    run: async (page) => {
      await step(page, "open settings", () => click(page, ".rail-gear"));
      await clickAll(page, ".side .side-row", (t) => `settings ${t}`, 10);
      await step(page, "back to the channel", () => click(page, ".rail .tile"));
    },
  },
  {
    name: "menus",
    shot: "channel",
    run: async (page) => {
      await step(page, "right-click a message", () => click(page, ".main article.msg", { button: "right", last: true }));
      await step(page, "Escape", () => page.keyboard.press("Escape"));
      await step(page, "right-click a room", () => click(page, '.side section[aria-label="Rooms"] .side-row', { button: "right", nth: 1 }));
      await step(page, "Escape", () => page.keyboard.press("Escape"));
    },
  },
  { name: "thread doc", shot: "thread-doc", run: async () => {} },
  { name: "tasks", shot: "task-working", run: async () => {} },
  { name: "specs", shot: "specs-general", run: async () => {} },
  { name: "needs you", shot: "needs-panel", run: async () => {} },
  { name: "channel settings", shot: "channel-settings", run: async () => {} },
];

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const all: Hit[] = [];
const frames: Record<string, number> = {};
if (out) mkdirSync(out, { recursive: true });
try {
  for (const flow of FLOWS.filter((f) => !only || f.name === only)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "UTC", locale: "en-US" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(recorder);
    try {
      await page.goto(`${base}?shot=${flow.shot}&theme=dark${live ? "" : "&frozen"}`);
      await page.waitForSelector(".side, .main, dialog[open]", { state: "attached", timeout: 15000 }).catch(() => skipped.push(`${flow.name}: no .side, .main or dialog after 15 s`));
      await settle(page, 1500);
      const before = skipped.length;
      await flow.run(page);
      await settle(page, 800);
      if (out && skipped.length > before) await page.screenshot({ path: join(out, `${flow.name.replaceAll(" ", "-")}-${engine}.png`) });
      const log = await page.evaluate(() => (window as unknown as { __flicker: { take: () => Log } }).__flicker.take());
      frames[flow.name] = log.times.length;
      const hits = hitsOf(flow.name, log);
      all.push(...hits);
      console.log(
        `${flow.name}: ${log.times.length} frames over ${(log.times.at(-1) ?? 0) - (log.times[0] ?? 0)} ms, ${hits.length} hits${errors.length ? `, page errors: ${errors.join("; ")}` : ""}`,
      );
    } catch (e) {
      // A flow that breaks is reported and the sweep goes on with the next one.
      console.log(`${flow.name}: broke: ${String(e instanceof Error ? e.message : e).split("\n")[0]}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}

const short = (key: string) => key.split(">").slice(-2).join(">");
const what = (h: Hit) => {
  if (h.from === "-") return "appears";
  if (h.via[0] === "-") return "disappears";
  const a = h.from.split("|");
  const b = (h.via[0] ?? "").split("|");
  return ["box", "opacity", "background", "colour", "text"].filter((_, i) => a[i] !== b[i]).join("+");
};
const shift = (h: Hit) => {
  const [a, b] = [nums(h.from.split("|")[0] ?? ""), nums((h.via[0] ?? "").split("|")[0] ?? "")];
  return a.length === 4 && b.length === 4 ? `${b[0]! - a[0]!},${b[1]! - a[1]!}` : "";
};
const events = new Map<string, Hit[]>();
for (const h of all) {
  const id = `${h.flow}|${h.frame}|${h.kind}|${what(h)}|${what(h) === "box" ? shift(h) : ""}`;
  events.set(id, [...(events.get(id) ?? []), h]);
}
const lines = [...events.values()].map((hs) => {
  const h = hs[0]!;
  const keys = [...new Set(hs.map((x) => x.key))].sort((x, y) => x.length - y.length);
  const texts = [...new Set(hs.map((x) => (x.from === "-" ? x.via[0] : x.from)?.split("|")[TEXT] ?? "").filter(Boolean))].slice(0, 3);
  const move = what(h) === "box" ? ` by ${shift(h)} px` : "";
  return {
    size: hs.length,
    text: `${h.flow} · ${h.step} · at ${h.t} ms · ${hs.length} element${hs.length === 1 ? "" : "s"} ${h.kind === "return" ? "change and come back" : "pass through a state"}: ${what(h)}${move} for ${h.ms} ms\n     ${keys.slice(0, 2).map(short).join("  ")}${texts.length ? `  "${texts.join('", "')}"` : ""}\n     ${h.from.slice(0, 110)}\n  -> ${h.via.map((v) => v.slice(0, 110)).join(" -> ")}\n  -> ${h.to.slice(0, 110)}`,
  };
});
if (skipped.length) console.log(`\nskipped:\n${skipped.map((s) => `  ${s}`).join("\n")}`);
console.log(`\n${all.length} hits in ${events.size} events (${engine}${live ? ", live demo" : ", frozen demo"})`);
for (const l of lines.sort((a, b) => b.size - a.size)) console.log(l.text);
if (out) writeFileSync(join(out, `flicker-${engine}.json`), JSON.stringify({ engine, live, frames, skipped, hits: all }, null, 1));
