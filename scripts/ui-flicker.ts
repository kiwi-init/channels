import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};

if (process.argv.includes("--help")) {
  console.log(`Drives the app's main flows and lists every flicker: an element whose box, opacity, colours or text changes and comes
back within a few frames (a return), or holds a state for a few frames between two steady ones that is not on the way from
the first to the second (a detour). Each frame is read in requestAnimationFrame, so a state that never reached a frame is not
counted.

  bun scripts/ui-flicker.ts --dist ui/dist --browser webkit|chromium [--flow NAME] [--live] [--out DIR] [--frames 6]`);
  process.exit(0);
}

const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const only = flag("--flow");
const live = process.argv.includes("--live");
const out = flag("--out");
const SHORT = Number(flag("--frames") ?? 6);
const STEADY = 3;

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

type Log = { frames: number[]; labels: [number, string][]; changes: Record<string, [number, string][]> };

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
  const log: Log = { frames: [], labels: [[0, "load"]], changes: {} };
  let frame = 0;
  const read = () => {
    const w = innerWidth;
    const h = innerHeight;
    const seen = new Map<string, string>();
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
      seen.set(key, `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}|${cs.opacity}|${cs.backgroundColor}|${cs.color}|${text}`);
    }
    return seen;
  };
  const tick = () => {
    if (document.body) {
      frame++;
      log.frames.push(Math.round(performance.now()));
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
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  Object.assign(window, {
    __flicker: {
      mark: (label: string) => void log.labels.push([frame + 1, label]),
      take: () => log,
    },
  });
};

type Hit = { flow: string; step: string; key: string; kind: "return" | "detour"; frames: number; ms: number; from: string; via: string[]; to: string };

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
  const end = log.frames.length + 1;
  const stepAt = (f: number) => log.labels.filter(([at]) => at <= f).at(-1)?.[1] ?? "load";
  const msAt = (a: number, b: number) => (log.frames[b - 1] ?? 0) - (log.frames[a - 1] ?? 0);
  const hits: Hit[] = [];
  for (const [key, list] of Object.entries(log.changes)) {
    const segs = list.map(([at, state], i) => ({ at, state, len: (list[i + 1]?.[0] ?? end) - at }));
    if (list[0] && list[0][0] > 1) segs.unshift({ at: 1, state: "-", len: list[0][0] - 1 });
    for (let i = 0; i + 2 < segs.length; i++) {
      const a = segs[i]!;
      if (a.len < STEADY) continue;
      let span = 0;
      for (let j = i + 1; j < segs.length; j++) {
        const b = segs[j]!;
        if (b.state === a.state) {
          if (span <= SHORT && j > i + 1)
            hits.push({
              flow,
              step: stepAt(segs[i + 1]!.at),
              key,
              kind: "return",
              frames: span,
              ms: msAt(segs[i + 1]!.at, b.at),
              from: a.state,
              via: segs.slice(i + 1, j).map((s) => s.state),
              to: b.state,
            });
          break;
        }
        span += b.len;
        if (span > SHORT) break;
      }
      const b = segs[i + 1]!;
      const c = segs[i + 2]!;
      if (b.len <= SHORT && c.len >= STEADY && c.state !== a.state && !between(a.state, b.state, c.state))
        hits.push({ flow, step: stepAt(b.at), key, kind: "detour", frames: b.len, ms: msAt(b.at, c.at), from: a.state, via: [b.state], to: c.state });
    }
  }
  return hits;
};

const settle = (page: Page, ms = 1200) => page.waitForTimeout(ms);
const mark = (page: Page, label: string) => page.evaluate((l) => (window as unknown as { __flicker: { mark: (l: string) => void } }).__flicker.mark(l), label);
const step = async (page: Page, label: string, act: () => Promise<unknown>, ms?: number) => {
  await mark(page, label);
  await act();
  await settle(page, ms);
};
const clickAll = async (page: Page, selector: string, label: (text: string) => string, limit = 12) => {
  const rows = page.locator(selector);
  const n = Math.min(await rows.count(), limit);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    if (!(await row.isVisible())) continue;
    const text = ((await row.innerText().catch(() => "")) || (await row.getAttribute("aria-label")) || `#${i}`).split("\n")[0]!.trim().slice(0, 30);
    await step(page, label(text), () => row.click({ timeout: 3000 }).catch(() => undefined));
  }
};

type Flow = { name: string; shot: string; run: (page: Page) => Promise<void> };
const FLOWS: Flow[] = [
  { name: "cold open", shot: "channel", run: async () => {} },
  {
    name: "channel tabs",
    shot: "channel",
    run: async (page) => {
      await clickAll(page, ".rail .tile", (t) => `tab ${t}`);
      await step(page, "back to the first tab", () => page.locator(".rail .tile").first().click());
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
      await step(page, "open a thread", () => page.locator(".main .msg-thread").first().click());
      await step(page, "close it", () => page.keyboard.press("Escape"));
    },
  },
  {
    name: "type and send",
    shot: "channel",
    run: async (page) => {
      const box = page.locator(".main .composer textarea").first();
      await step(page, "focus the composer", () => box.click());
      await step(page, "type", () => box.pressSequentially("Checking how the feed takes a new message", { delay: 30 }));
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
      await step(page, "open settings", () => page.locator(".rail-gear").first().click());
      await clickAll(page, "dialog[open] nav button, dialog[open] [role=tab], .settings-nav button", (t) => `settings ${t}`, 10);
      await step(page, "close settings", () => page.keyboard.press("Escape"));
    },
  },
  {
    name: "menus",
    shot: "channel",
    run: async (page) => {
      await step(page, "right-click a message", () => page.locator(".main article.msg").last().click({ button: "right" }));
      await step(page, "Escape", () => page.keyboard.press("Escape"));
      await step(page, "right-click a room", () => page.locator('.side section[aria-label="Rooms"] .side-row').nth(1).click({ button: "right" }));
      await step(page, "Escape", () => page.keyboard.press("Escape"));
    },
  },
  { name: "thread doc", shot: "thread-doc", run: async () => {} },
  { name: "tasks", shot: "task-working", run: async () => {} },
  { name: "specs", shot: "specs-general", run: async () => {} },
  { name: "needs you", shot: "needs-panel", run: async () => {} },
  { name: "channel settings", shot: "channel-settings", run: (page) => clickAll(page, "dialog[open] [role=tab], dialog[open] .tabs button", (t) => `tab ${t}`, 8) },
];

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const all: Hit[] = [];
const frames: Record<string, number> = {};
try {
  for (const flow of FLOWS.filter((f) => !only || f.name === only)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "UTC", locale: "en-US" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(recorder);
    await page.goto(`${base}?shot=${flow.shot}&theme=dark${live ? "" : "&frozen"}`);
    await page.waitForSelector(".side, .main, dialog[open]", { state: "attached", timeout: 15000 }).catch(() => undefined);
    await settle(page, 1500);
    await flow.run(page);
    await settle(page, 800);
    const log = await page.evaluate(() => (window as unknown as { __flicker: { take: () => Log } }).__flicker.take());
    frames[flow.name] = log.frames.length;
    const hits = hitsOf(flow.name, log);
    all.push(...hits);
    console.log(`${flow.name}: ${log.frames.length} frames, ${hits.length} hits${errors.length ? `, page errors: ${errors.join("; ")}` : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}

const short = (key: string) => key.split(">").slice(-3).join(">");
const what = (h: Hit) => {
  const a = h.from.split("|");
  const b = (h.via[0] ?? "").split("|");
  if (h.from === "-") return "appears";
  if (h.via[0] === "-") return "disappears";
  const names = ["box", "opacity", "background", "colour", "text"];
  return names.filter((_, i) => a[i] !== b[i]).join("+");
};
const groups = new Map<string, Hit[]>();
for (const h of all) {
  const id = `${h.flow} · ${h.step} · ${short(h.key)} · ${h.kind} · ${what(h)}`;
  groups.set(id, [...(groups.get(id) ?? []), h]);
}
console.log(`\n${all.length} hits in ${groups.size} groups (${engine}${live ? ", live demo" : ", frozen demo"})`);
for (const [id, hs] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const h = hs[0]!;
  console.log(`${hs.length}x ${id} · ${h.frames} frames ${h.ms} ms\n     ${h.from}\n  -> ${h.via.join(" -> ")}\n  -> ${h.to}`);
}
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `flicker-${engine}.json`), JSON.stringify({ engine, live, frames, hits: all }, null, 1));
}
