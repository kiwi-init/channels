#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type CDPSession } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, docOpen, firstRun, newChannel, say, switchTo } from "./perf-ui.ts";

if (process.argv.includes("--help")) {
  console.log(`What a thread doc's updates cost the page, by the length of the thread. Two windows of jow in one channel with
--lines lines already sent (40). The writer sends --sends more lines (20), each one a block added to the shared doc, and the
reader, at the bottom of the same thread, is measured: main-thread script, style, layout and task time (CDP Performance.getMetrics),
the React components rendered and the commits, the frames it received and its long tasks, per line. Then the reader types
--chars characters (200) in its own composer and is measured per key. Run it at two lengths to see whether the cost grows with
the thread. Last, the reader reloads: how long until the thread's last line and its doc are back, the long tasks on the
way, the blocks the doc holds and the heap after. Chromium only.

  bun scripts/perf-doc-updates.ts [--lines=40] [--sends=20] [--chars=200] [--json=out.json] [--dist=ui/dist-harness]

Needs bun scripts/ui-harness.ts first.`);
  process.exit(0);
}

const flag = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIST = harnessDist(flag("dist"));
const LINES = Number(flag("lines") ?? 40);
const CHARS = Number(flag("chars") ?? 200);
const SENDS = Number(flag("sends") ?? 20);
const OUT = flag("json");

const data = mkdtempSync(join(tmpdir(), "kiwi-perf-doc-updates-"));
mkdirSync(join(data, "relay"));
const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

function watch(): void {
  const counted = { commits: 0, renders: 0, long: [] as number[] };
  const rendering = new Set([0, 1, 11, 14, 15]);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) counted.long.push(Math.round(e.duration));
  }).observe({ type: "longtask", buffered: true });
  Object.assign(window, {
    __counted: counted,
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      onCommitFiberRoot: (_: number, root: { current: object }) => {
        counted.commits += 1;
        type Fiber = { tag: number; flags: number; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null };
        const walk = (fiber: Fiber | null): void => {
          for (let f = fiber; f; f = f.sibling) {
            if (rendering.has(f.tag) && f.flags & 1) counted.renders += 1;
            if (!f.alternate || f.child !== f.alternate.child) walk(f.child);
          }
        };
        walk(root.current as Fiber);
      },
    },
  });
}

interface Sample {
  scriptMs: number;
  styleMs: number;
  layoutMs: number;
  taskMs: number;
  commits: number;
  renders: number;
  long: number;
  frames: number;
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}

async function profile(cdp: CDPSession, per: number, run: () => Promise<unknown>): Promise<{ self: string[]; whole: string[] }> {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await run();
  const { profile: prof } = (await cdp.send("Profiler.stop")) as { profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] } };
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const name = (n: ProfileNode) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/^.*\//, "")}:${n.callFrame.lineNumber}`;
  const own = new Map<number, number>();
  prof.samples.forEach((id, i) => own.set(id, (own.get(id) ?? 0) + (prof.timeDeltas[i] ?? 0)));
  const within = new Map<number, number>();
  const total = (id: number): number => {
    const known = within.get(id);
    if (known !== undefined) return known;
    const sum = (own.get(id) ?? 0) + (byId.get(id)?.children ?? []).reduce((n, child) => n + total(child), 0);
    within.set(id, sum);
    return sum;
  };
  const self = new Map<string, number>();
  const whole = new Map<string, number>();
  for (const n of prof.nodes) {
    self.set(name(n), (self.get(name(n)) ?? 0) + (own.get(n.id) ?? 0));
    whole.set(name(n), (whole.get(name(n)) ?? 0) + total(n.id));
  }
  const top = (by: Map<string, number>, count: number) =>
    [...by.entries()]
      .filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)") && !k.startsWith("(root)"))
      .sort((x, y) => y[1] - x[1])
      .slice(0, count)
      .map(([k, v]) => `${(v / 1000 / per).toFixed(2)}ms  ${k}`);
  return { self: top(self, 25), whole: top(whole, 45) };
}

const TEXT = "the relay deploy is done and the numbers are in, p50 is flat and p95 dropped by a third. ";
const typed = (n: number): string => TEXT.repeat(Math.ceil(n / TEXT.length)).slice(0, n);
const round = (n: number): number => Math.round(n * 100) / 100;

try {
  const reader = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await reader.addInitScript(watch);
  const a = await reader.newPage();
  let frames = 0;
  a.on("websocket", (ws) => ws.on("framereceived", () => void frames++));
  await a.goto(BASE);
  await firstRun(a, "jow");
  await newChannel(a, "long");
  await docOpen(a);
  const writer = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState: await reader.storageState({ indexedDB: true }) });
  const b = await writer.newPage();
  await b.goto(BASE);
  await switchTo(b, "long");
  await docOpen(b);
  for (let n = 1; n <= LINES; n++) await say(a, `line ${n} of ${LINES}: a sent line, so the thread has a past`);
  await a.waitForFunction((want) => document.querySelector(".main .feed-list")?.textContent?.includes(want), `line ${LINES} of ${LINES}`, { timeout: 600000 });
  await b.waitForFunction((want) => document.querySelector(".main .feed-list")?.textContent?.includes(want), `line ${LINES} of ${LINES}`, { timeout: 600000 });
  await a.waitForTimeout(4000);

  const cdp: CDPSession = await reader.newCDPSession(a);
  await cdp.send("Performance.enable");
  const sample = async (): Promise<Sample> => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const of = (name: string) => (metrics.find((m) => m.name === name)?.value ?? 0) * 1000;
    const counted = await a.evaluate(() => (window as unknown as { __counted: { commits: number; renders: number; long: number[] } }).__counted);
    return {
      scriptMs: of("ScriptDuration"),
      styleMs: of("RecalcStyleDuration"),
      layoutMs: of("LayoutDuration"),
      taskMs: of("TaskDuration"),
      commits: counted.commits,
      renders: counted.renders,
      long: counted.long.length,
      frames,
    };
  };
  const during = async (per: number, act: () => Promise<void>): Promise<Record<string, number>> => {
    const from = await sample();
    await act();
    await a.waitForTimeout(1500);
    const to = await sample();
    return {
      scriptMs: round((to.scriptMs - from.scriptMs) / per),
      styleMs: round((to.styleMs - from.styleMs) / per),
      layoutMs: round((to.layoutMs - from.layoutMs) / per),
      taskMs: round((to.taskMs - from.taskMs) / per),
      renders: round((to.renders - from.renders) / per),
      commits: round((to.commits - from.commits) / per),
      frames: round((to.frames - from.frames) / per),
      longTasks: to.long - from.long,
    };
  };
  const idlePerLine = await during(SENDS, () => a.waitForTimeout(SENDS * 400));
  const perLineSent = await during(SENDS, async () => {
    for (let n = 1; n <= SENDS; n++) {
      await say(b, `measured line ${n} of ${SENDS}, sent by the other window`);
      await b.waitForTimeout(400);
    }
    await a.waitForFunction((want) => document.querySelector(".main .feed-list")?.textContent?.includes(want), `measured line ${SENDS} of ${SENDS}`, { timeout: 30000 });
  });
  const profiled = await profile(cdp, SENDS, async () => {
    for (let n = 1; n <= SENDS; n++) {
      await say(b, `profiled line ${n} of ${SENDS}, sent by the other window`);
      await b.waitForTimeout(400);
    }
    await a.waitForFunction((want) => document.querySelector(".main .feed-list")?.textContent?.includes(want), `profiled line ${SENDS} of ${SENDS}`, { timeout: 30000 });
  });
  console.log(`per line sent, self time:\n${profiled.self.join("\n")}\nper line sent, with what it calls:\n${profiled.whole.join("\n")}`);
  const perKeyTyped = await during(CHARS, () => composer(a).pressSequentially(typed(CHARS), { delay: 30 }));
  await a.waitForTimeout(3000);
  const last = `profiled line ${SENDS} of ${SENDS}`;
  const from = performance.now();
  await a.reload();
  await a.waitForFunction((want) => document.querySelector(".main .feed-list")?.textContent?.includes(want), last, { timeout: 120000 });
  const feedMs = Math.round(performance.now() - from);
  await docOpen(a);
  const docMs = Math.round(performance.now() - from);
  await a.waitForTimeout(3000);
  const opened = await a.evaluate(() => {
    const long = (window as unknown as { __counted: { long: number[] } }).__counted.long;
    const mark = (name: string) => Math.round(performance.getEntriesByName(name, "mark")[0]?.startTime ?? -1);
    return {
      firstMessageMarkMs: mark("kiwi:first-message"),
      liveMarkMs: mark("kiwi:live"),
      longTasks: long.length,
      longMs: long.reduce((n, d) => n + d, 0),
      worstLongMs: Math.max(0, ...long),
      docBlocks: document.querySelectorAll(".thread-doc section.blk").length,
    };
  });
  await cdp.send("HeapProfiler.collectGarbage");
  const heapMB = Math.round((((await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1048576) * 10) / 10;
  const reopen = { lastLineShownMs: feedMs, docAttachedMs: docMs, ...opened, heapMBAfter: heapMB };
  const result = { lines: LINES, sends: SENDS, chars: CHARS, idlePerLine, perLineSent, perKeyTyped, reopen };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
