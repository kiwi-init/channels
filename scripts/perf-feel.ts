import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import { chromium, type CDPSession, type Page, type Request, type WebSocket as PageSocket } from "playwright-core";
import { daemonSock } from "../src/daemon/protocol.ts";
import { stopDaemon } from "../src/daemon/rpc.ts";
import { startLocalRelay } from "./local-relay.ts";
import { firstRun, letIn, newChannel, panel, ROWS, view } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";

if (process.argv.includes("--help")) {
  console.log(`What a person feels, measured: one channel with PERF_MESSAGES messages (400) and PERF_TASKS tasks (12), behind a relay PERF_RTT_MS away (0).
Times sending (Enter to the composer emptied, and to the bubble on screen), opening a task, switching views, scrolling the whole channel (frames over 33 ms, blank frames),
typing, and a reload to the first screen and to a live composer, each PERF_REPS times (5), plus every layout shift. --shots DIR saves a filmstrip of the reload and the send.

  bun scripts/ui-harness.ts && bun scripts/perf-feel.ts [--json out.json] [--shots DIR]

Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium (or SMOKE_CHROMIUM=<Chrome binary>).`);
  process.exit(0);
}

const frame = (m: string | Buffer): string | Uint8Array<ArrayBuffer> => (typeof m === "string" ? m : new Uint8Array(m));
const ROOT = resolve(import.meta.dir, "..");
const MESSAGES = Number(process.env.PERF_MESSAGES ?? 400);
const TASKS = Number(process.env.PERF_TASKS ?? 12);
const RTT = Number(process.env.PERF_RTT_MS ?? 0);
const REPS = Number(process.env.PERF_REPS ?? 5);
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const OUT = flag("--json");
const SHOTS = flag("--shots");
const TRACE = process.argv.includes("--trace");
const data = mkdtempSync(join(tmpdir(), "kiwi-perf-feel-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const running: ChildProcess[] = [];
function kiwi(argv: string[]): Promise<string> {
  const env = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
  const p = spawn("bun", ["src/cli/main.ts", ...argv], { cwd: ROOT, env });
  running.push(p);
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  return new Promise((ok, fail) =>
    p.on("exit", (code) => {
      running.splice(running.indexOf(p), 1);
      if (code === 0) ok(out);
      else fail(new Error(`kiwi ${argv.join(" ")} exited ${code}: ${out.trim().split("\n").pop()}`));
    }),
  );
}
const atlas = async (argv: string[]): Promise<string> => {
  for (;;) {
    try {
      return await kiwi(["-c", "feel", "--as", "atlas", ...argv]);
    } catch (e) {
      if (!String(e).includes("too many")) throw e;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const log = (...xs: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...xs);

const { relay, port: relayPort } = await startLocalRelay(join(data, "relay"), harnessDist(), { rateLimits: false });
const UPSTREAM = `http://127.0.0.1:${relayPort}`;
const half = RTT / 2;
interface Pipe {
  path: string;
  protocols: string[];
  upstream?: WebSocket;
  queue: (string | Buffer)[];
}
const proxy = Bun.serve<Pipe>({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (req.headers.get("upgrade") === "websocket") {
      const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const ok = server.upgrade(req, { data: { path: url.pathname + url.search, protocols, queue: [] }, headers: protocols[0] ? { "Sec-WebSocket-Protocol": protocols[0] } : {} });
      return ok ? undefined : new Response("upgrade failed", { status: 400 });
    }
    await later(half);
    const headers = new Headers(req.headers);
    headers.delete("host");
    const res = await fetch(UPSTREAM + url.pathname + url.search, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    });
    const body = await res.arrayBuffer();
    await later(half);
    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(body, { status: res.status, headers: out });
  },
  websocket: {
    open(ws: ServerWebSocket<Pipe>) {
      const up = new WebSocket(`ws://127.0.0.1:${relayPort}${ws.data.path}`, ws.data.protocols);
      up.binaryType = "arraybuffer";
      ws.data.upstream = up;
      up.onopen = () => {
        for (const m of ws.data.queue.splice(0)) up.send(frame(m));
      };
      up.onmessage = (e) => setTimeout(() => ws.readyState === 1 && ws.send(typeof e.data === "string" ? e.data : Buffer.from(e.data as ArrayBuffer)), half);
      up.onclose = (e) => setTimeout(() => ws.readyState === 1 && ws.close(e.code === 1005 ? 1000 : e.code, e.reason), half);
    },
    message(ws: ServerWebSocket<Pipe>, m: string | Buffer) {
      setTimeout(() => {
        const up = ws.data.upstream;
        if (up?.readyState === WebSocket.OPEN) up.send(frame(m));
        else ws.data.queue.push(m);
      }, half);
    },
    close(ws: ServerWebSocket<Pipe>) {
      ws.data.upstream?.close();
    },
  },
});
const BASE = `http://localhost:${proxy.port}/`;

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

const WATCH = () => {
  const w = window as unknown as { __shifts: { at: number; value: number; input: boolean; moved: string[] }[]; __long: { at: number; ms: number }[]; __keys: number[] };
  w.__shifts = [];
  w.__long = [];
  w.__keys = [];
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("open", () => ((window as unknown as { __live?: number }).__live ??= performance.now()), { once: true });
    }
  };
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => {
      const s = e as PerformanceEntry & { value: number; hadRecentInput: boolean; sources: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] };
      const moved = s.sources.map((x) => {
        const el = x.node instanceof Element ? x.node : x.node?.parentElement;
        const name = el ? `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}.${String(el.className).split(" ").slice(0, 3).join(".")}` : "?";
        return `${name} ${Math.round(x.previousRect.y)}→${Math.round(x.currentRect.y)} h${Math.round(x.previousRect.height)}→${Math.round(x.currentRect.height)}`;
      });
      w.__shifts.push({ at: Math.round(s.startTime), value: s.value, input: s.hadRecentInput, moved });
    }),
  ).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }))).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => {
      if (e.name.startsWith("key")) w.__keys.push(e.duration);
    }),
  ).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
};

async function drain(page: Page): Promise<{ shifts: number; shiftsNoInput: number; worstShift: number; moved: string[]; longTasks: number; longMs: number; worstLongMs: number; keys: number[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __shifts: { at: number; value: number; input: boolean; moved: string[] }[]; __long: { at: number; ms: number }[]; __keys: number[] };
    const shifts = w.__shifts.splice(0);
    const long = w.__long.splice(0);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return {
      shifts: r(shifts.reduce((a, s) => a + s.value, 0)),
      shiftsNoInput: r(shifts.filter((s) => !s.input).reduce((a, s) => a + s.value, 0)),
      worstShift: r(Math.max(0, ...shifts.map((s) => s.value))),
      moved: [...new Set(shifts.filter((s) => s.value > 0.005).flatMap((s) => s.moved))].slice(0, 8),
      longTasks: long.length,
      longMs: long.reduce((a, l) => a + l.ms, 0),
      worstLongMs: Math.max(0, ...long.map((l) => l.ms)),
      keys: w.__keys.splice(0),
    };
  });
}

async function filmstrip(cdp: CDPSession, name: string, run: () => Promise<unknown>): Promise<void> {
  if (!SHOTS) {
    await run();
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  const frames: { at: number; data: string }[] = [];
  const t0 = Date.now();
  const onFrame = (f: { data: string; sessionId: number }) => {
    frames.push({ at: Date.now() - t0, data: f.data });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  };
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 960, maxHeight: 600, everyNthFrame: 1 });
  await run();
  await later(300);
  await cdp.send("Page.stopScreencast");
  cdp.off("Page.screencastFrame", onFrame);
  frames.forEach((f, i) => writeFileSync(join(SHOTS, `${name}-${String(i).padStart(3, "0")}-${f.at}ms.jpg`), Buffer.from(f.data, "base64")));
}

function trace(page: Page, t0: number): () => string[] {
  const lines: { at: number; line: string }[] = [];
  const at = () => Math.round(performance.now() - t0);
  const started = new Map<object, number>();
  const onRequest = (r: Request) => started.set(r, at());
  const onDone = (r: Request) => {
    const path = new URL(r.url()).pathname.replace(/[A-Za-z0-9_-]{24,}/g, "…");
    if (!/\.(js|css|woff2?|png|svg|ico)$/.test(path)) lines.push({ at: started.get(r) ?? 0, line: `${r.method()} ${path} ${started.get(r) ?? 0}→${at()} ms` });
  };
  const onSocket = (ws: PageSocket) => {
    const opened = at();
    let frames = 0;
    lines.push({ at: opened, line: `ws ${new URL(ws.url()).pathname.replace(/[A-Za-z0-9_-]{24,}/g, "…")} from ${opened} ms` });
    ws.on("framereceived", () => {
      if (frames++ < 3) lines.push({ at: at(), line: `ws frame ${frames} at ${at()} ms` });
    });
  };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  page.on("websocket", onSocket);
  return () => {
    page.off("request", onRequest);
    page.off("requestfinished", onDone);
    page.off("requestfailed", onDone);
    page.off("websocket", onSocket);
    return lines.sort((a, b) => a.at - b.at).map((l) => l.line);
  };
}

async function send(page: Page, text: string): Promise<{ clearedMs: number; bubbleMs: number }> {
  const box = page.getByRole("textbox", { name: "Message" }).last();
  await box.fill(text);
  await page.evaluate(
    ([body, rows]) => {
      const w = window as unknown as { __sent?: Promise<{ clearedMs: number; bubbleMs: number }> };
      const area = document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Message"]');
      const el = area[area.length - 1]!;
      w.__sent = new Promise((done) => {
        const down = (e: KeyboardEvent) => {
          if (e.key !== "Enter") return;
          el.removeEventListener("keydown", down, true);
          const t0 = performance.now();
          let cleared = -1;
          let bubble = -1;
          const tick = () => {
            const now = performance.now();
            if (cleared < 0 && el.value === "") cleared = Math.round(now - t0);
            if (bubble < 0 && [...document.querySelectorAll(rows)].some((r) => r.textContent?.includes(body))) bubble = Math.round(now - t0);
            if ((cleared >= 0 && bubble >= 0) || now - t0 > 15000) return done({ clearedMs: cleared, bubbleMs: bubble });
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        };
        el.addEventListener("keydown", down, true);
      });
    },
    [text, ROWS] as const,
  );
  await box.press("Enter");
  return page.evaluate(() => (window as unknown as { __sent: Promise<{ clearedMs: number; bubbleMs: number }> }).__sent);
}

async function work(cdp: CDPSession): Promise<{ layout: number; style: number }> {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { layout: m.LayoutDuration ?? 0, style: m.RecalcStyleDuration ?? 0 };
}

async function details(page: Page, cdp: CDPSession, opening: boolean): Promise<{ ms: number; layoutMs: number; styleMs: number }> {
  const before = await work(cdp);
  const ms = await panel(page, opening);
  await later(400);
  const after = await work(cdp);
  return { ms, layoutMs: Math.round((after.layout - before.layout) * 1000), styleMs: Math.round((after.style - before.style) * 1000) };
}

async function openTask(page: Page, id: number, marker: string): Promise<number> {
  return page.evaluate(
    async ([task, text]) => {
      const row = [...document.querySelectorAll<HTMLElement>("main .board-row")].find((r) => r.querySelector(".board-meta")?.textContent?.startsWith(`T${task} `));
      if (!row) throw new Error(`no row for T${task} on the board`);
      const t0 = performance.now();
      row.click();
      const deadline = t0 + 15000;
      while (performance.now() < deadline) {
        await new Promise((r) => requestAnimationFrame(r));
        if (document.querySelector('aside[aria-label="Details"]')?.textContent?.includes(text)) break;
      }
      if (performance.now() >= deadline) throw new Error(`T${task} opened without “${text}”`);
      return Math.round(performance.now() - t0);
    },
    [id, marker] as const,
  );
}

async function scrollAll(page: Page): Promise<{ ms: number; frames: number; over33: number; over50: number; worstFrameMs: number; blankFrames: number; reachedTop: boolean }> {
  return page.evaluate(async (selector) => {
    const rows = document.querySelectorAll(selector);
    let el: HTMLElement | null = rows[rows.length - 1] as HTMLElement | null;
    while (el && !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== "visible")) el = el.parentElement;
    if (!el) throw new Error("no scrolling feed");
    const scroller = el;
    const box = scroller.getBoundingClientRect();
    const deltas: number[] = [];
    let blank = 0;
    let last = performance.now();
    const t0 = last;
    let still = 0;
    let prevTop = scroller.scrollTop;
    for (;;) {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
      scroller.scrollBy({ top: -120, behavior: "instant" });
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      deltas.push(now - last);
      last = now;
      const visible = [...scroller.querySelectorAll(selector)].some((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > box.top && b.top < box.bottom;
      });
      if (!visible) blank++;
      if (scroller.scrollTop === prevTop) still++;
      else still = 0;
      prevTop = scroller.scrollTop;
      if (still > 90 || now - t0 > 60000) break;
    }
    const ms = Math.round(performance.now() - t0);
    return {
      ms,
      frames: deltas.length,
      over33: deltas.filter((d) => d > 33).length,
      over50: deltas.filter((d) => d > 50).length,
      worstFrameMs: Math.round(Math.max(...deltas)),
      blankFrames: blank,
      reachedTop: scroller.scrollTop === 0,
    };
  }, ROWS);
}

const report: Record<string, unknown> = { messages: MESSAGES, tasks: TASKS, rttMs: RTT, reps: REPS };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(WATCH);
  await context.addInitScript(() => {
    const w = window as unknown as { __falseScreens: string[] };
    const seen = new Set<string>();
    w.__falseScreens = [];
    const look = () => {
      if (document.querySelector('section[aria-label="Add an agent"]')) seen.add("Add an agent");
      if (document.querySelector(".empty-title")?.textContent === "No tasks yet.") seen.add("No tasks yet");
      if (document.querySelector(".feed-start")) seen.add("the start of the room");
      w.__falseScreens = [...seen];
    };
    const watch = new MutationObserver(look);
    watch.observe(document, { childList: true, subtree: true, characterData: true });
    setTimeout(() => watch.disconnect(), 5000);
  });
  await context.addInitScript(
    (marker: string) => {
      const w = window as unknown as { __firstScreen?: number };
      const seen = () => {
        if (w.__firstScreen === undefined && document.body?.textContent?.includes(marker)) w.__firstScreen = performance.now();
        return w.__firstScreen !== undefined;
      };
      new MutationObserver((_, obs) => seen() && obs.disconnect()).observe(document, { childList: true, subtree: true, characterData: true });
    },
    `M${MESSAGES - 1}: `,
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => log(`page error: ${e.message}`));
  const cdp = await context.newCDPSession(page);

  const coldAt = performance.now();
  await page.goto(BASE);
  await page.getByRole("textbox", { name: "Your name" }).waitFor();
  report["cold: first run, empty cache"] = {
    readyMs: Math.round(performance.now() - coldAt),
    ...(await page.evaluate(() => ({ fcpMs: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1) }))),
  };
  log("cold", JSON.stringify(report["cold: first run, empty cache"]));
  await firstRun(page, "Jonatas");
  const code = await newChannel(page, "feel");
  let joined = false;
  const joining = kiwi(["join", code, "feel", "--as", "atlas", "--model", "claude-opus-5-5", "--relay", `${UPSTREAM}/`]).then(() => void (joined = true));
  await letIn(page, () => !joined);
  await joining;
  await page.getByRole("textbox", { name: "Message" }).fill("Make it feel fast");
  await page.keyboard.press("Enter");

  let ask = "";
  while (!ask) {
    const said = (await atlas(["log", "-n", "20", "--json"])).split("\n").flatMap((line) => (line.trim().startsWith("{") ? [JSON.parse(line) as { seq: number; body?: string }] : []));
    ask = String(said.find((m) => m.body === "Make it feel fast")?.seq ?? "");
    if (!ask) await later(300);
  }
  const seedAt = Date.now();
  const tasks: number[] = [];
  for (let i = 0; i < TASKS; i++) {
    const out = await atlas(["task", "add", `Task ${i}: ${["speed up the switch", "fix the relay retry", "polish the sidebar"][i % 3]}`, "--ask", ask]);
    tasks.push(Number(/T(\d+)/.exec(out)?.[1] ?? 0));
  }
  const texts = [
    "Numbers are in:\n\n- p50 0.3ms, p95 1ms\n- no refusals in 800 rooms\n\nThe change is in `src/relay/route.ts`:\n\n```ts\nconst program = answer(dispatch(routes, guards, otherwise))\n```",
    "On it. I'll have win run the steady load first, then the cold runs.",
    "| step | before | after |\n|---|---|---|\n| first paint | 420ms | 180ms |\n| switch | 270ms | 26ms |",
    "PR is up: https://github.com/kiwi-init/channels/pull/417 — CI green, waiting on review.",
  ];
  for (let i = 0; i < MESSAGES; i += 10)
    await Promise.all(
      Array.from({ length: Math.min(10, MESSAGES - i) }, (_, j) => {
        const n = i + j;
        const task = n % 5 === 0 ? tasks[n % tasks.length] : undefined;
        return atlas(["send", ...(task ? ["--to", `T${task}`] : []), `M${n}: ${texts[n % texts.length]}`]);
      }),
    );
  for (const t of tasks) await atlas(["send", "--to", `T${t}`, `last word on T${t}`]);
  report.seedSeconds = Math.round((Date.now() - seedAt) / 1000);
  log(`seeded ${MESSAGES} messages and ${TASKS} tasks in ${report.seedSeconds}s`);
  await page
    .getByText(`M${MESSAGES - 1}: `)
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 60000 });
  await later(1500);
  await drain(page);

  const reloads: { firstScreenMs: number; firstScreenInPageMs: number; liveInPageMs: number; shifts: number; moved: string[]; falseScreens: string[] }[] = [];
  for (let i = 0; i < REPS; i++) {
    const at = performance.now();
    const run = async () => {
      await page.reload();
      await page
        .getByText(`M${MESSAGES - 1}: `)
        .filter({ visible: true })
        .first()
        .waitFor({ timeout: 60000 });
      const firstScreenMs = Math.round(performance.now() - at);
      await page.waitForFunction(() => (window as unknown as { __live?: number }).__live !== undefined, undefined, { timeout: 60000 });
      const inPage = await page.evaluate(() => {
        const w = window as unknown as { __live: number; __firstScreen?: number };
        return { firstScreenInPageMs: Math.round(w.__firstScreen ?? -1), liveInPageMs: Math.round(w.__live) };
      });
      return { firstScreenMs, ...inPage };
    };
    let r = { firstScreenMs: 0, firstScreenInPageMs: 0, liveInPageMs: 0 };
    if (i === 0) {
      const stop = TRACE ? trace(page, at) : null;
      await filmstrip(cdp, "reload", async () => (r = await run()));
      if (stop) report.reloadTrace = stop();
    } else r = await run();
    await later(1500);
    const d = await drain(page);
    const falseScreens = await page.evaluate(() => (window as unknown as { __falseScreens?: string[] }).__falseScreens ?? []);
    reloads.push({ ...r, shifts: d.shifts, moved: d.moved, falseScreens });
  }
  report.reload = {
    firstScreenMs: median(reloads.map((r) => r.firstScreenMs)),
    firstScreenInPageMs: median(reloads.map((r) => r.firstScreenInPageMs)),
    socketOpenInPageMs: median(reloads.map((r) => r.liveInPageMs)),
    layoutShift: median(reloads.map((r) => r.shifts)),
    falseScreens: reloads.reduce((n, r) => n + r.falseScreens.length, 0),
    runs: reloads,
  };
  log("reload", JSON.stringify(report.reload));

  await view(page, "# general", "M");
  await later(800);
  await drain(page);
  const sends: { clearedMs: number; bubbleMs: number }[] = [];
  for (let i = 0; i < REPS; i++) {
    let r = { clearedMs: 0, bubbleMs: 0 };
    const body = `Feel check ${i} ${Date.now()}`;
    if (i === 0) await filmstrip(cdp, "send", async () => (r = await send(page, body)));
    else r = await send(page, body);
    sends.push(r);
    await later(700);
  }
  const sentDrain = await drain(page);
  report.send = {
    composerEmptiedMs: median(sends.map((s) => s.clearedMs)),
    bubbleOnScreenMs: median(sends.map((s) => s.bubbleMs)),
    runs: sends,
    layoutShift: sentDrain.shifts,
    moved: sentDrain.moved,
    longTasks: sentDrain.longTasks,
    worstLongMs: sentDrain.worstLongMs,
  };
  log("send", JSON.stringify(report.send));

  const views: Record<string, number[]> = { Tasks: [], "# general": [] };
  for (let i = 0; i < REPS; i++) {
    views.Tasks!.push(await view(page, "Tasks", `Task ${TASKS - 1}:`));
    await later(500);
    let back = 0;
    if (i === 0) await filmstrip(cdp, "view-general", async () => (back = await view(page, "# general", `M${MESSAGES - 1}: `)));
    else back = await view(page, "# general", `M${MESSAGES - 1}: `);
    views["# general"]!.push(back);
    await later(500);
  }
  const viewDrain = await drain(page);
  report.views = {
    medianMs: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, median(v)])),
    runs: views,
    layoutShift: viewDrain.shifts,
    moved: viewDrain.moved,
    longTasks: viewDrain.longTasks,
    worstLongMs: viewDrain.worstLongMs,
  };
  log("views", JSON.stringify(report.views));

  await view(page, "Tasks", `Task ${TASKS - 1}:`);
  await later(500);
  const opens: number[] = [];
  for (let i = 0; i < REPS; i++) {
    const t = tasks[(i * 3) % tasks.length]!;
    let took = 0;
    if (i === 0) await filmstrip(cdp, "open-task", async () => (took = await openTask(page, t, `last word on T${t}`)));
    else took = await openTask(page, t, `last word on T${t}`);
    opens.push(took);
    await later(600);
  }
  const openDrain = await drain(page);
  report.openTask = { medianMs: median(opens), runs: opens, layoutShift: openDrain.shifts, moved: openDrain.moved, longTasks: openDrain.longTasks, worstLongMs: openDrain.worstLongMs };
  log("open task", JSON.stringify(report.openTask));

  await view(page, "# general", `M${MESSAGES - 1}: `);
  await later(800);
  await cdp.send("Performance.enable");
  await drain(page);
  const toggles: { open: { ms: number; layoutMs: number; styleMs: number }; close: { ms: number; layoutMs: number; styleMs: number } }[] = [];
  for (let i = 0; i < REPS; i++) toggles.push({ open: await details(page, cdp, true), close: await details(page, cdp, false) });
  const detailsDrain = await drain(page);
  report.details = {
    openMs: median(toggles.map((t) => t.open.ms)),
    openLayoutMs: median(toggles.map((t) => t.open.layoutMs)),
    closeLayoutMs: median(toggles.map((t) => t.close.layoutMs)),
    styleMs: median(toggles.map((t) => t.open.styleMs + t.close.styleMs)),
    layoutShift: detailsDrain.shifts,
  };
  log("details", JSON.stringify(report.details));

  await view(page, "# general", `M${MESSAGES - 1}: `);
  await later(1000);
  await drain(page);
  const scroll = await scrollAll(page);
  const scrollDrain = await drain(page);
  report.scroll = { ...scroll, layoutShift: scrollDrain.shifts, moved: scrollDrain.moved, longTasks: scrollDrain.longTasks, longMs: scrollDrain.longMs, worstLongMs: scrollDrain.worstLongMs };
  log("scroll", JSON.stringify(report.scroll));

  await view(page, "# general", `M${MESSAGES - 1}: `);
  await later(1000);
  const composer = page.getByRole("textbox", { name: "Message" }).last();
  await composer.click();
  await drain(page);
  for (let i = 0; i < 2; i++) {
    await composer.pressSequentially("the build is green and the switch is fast now ", { delay: 40 });
    await composer.fill("");
  }
  const idleKeys = (await drain(page)).keys.sort((a, b) => a - b);
  const posting = (async () => {
    for (let i = 0; i < 12; i++) await atlas(["send", `burst ${i}: ${texts[i % texts.length]}`]);
  })();
  const typing = (async () => {
    for (let i = 0; i < 3; i++) {
      await composer.pressSequentially("the build is green and the switch is fast now ", { delay: 40 });
      await composer.fill("");
    }
  })();
  await Promise.all([posting, typing]);
  const busyKeys = (await drain(page)).keys.sort((a, b) => a - b);
  const keyStats = (keys: number[]) => ({ keyEventsOver16ms: keys.length, over50ms: keys.filter((k) => k > 50).length, worstMs: Math.round(keys.at(-1) ?? 0) });
  report.typing = { idle: keyStats(idleKeys), whileAnAgentPosts: keyStats(busyKeys), keysTyped: 2 * 47 + 3 * 47 };
  log("typing", JSON.stringify(report.typing));

  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  else console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  for (const p of running) p.kill();
  await stopDaemon(daemonSock(join(cli, "home")));
  proxy.stop(true);
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
