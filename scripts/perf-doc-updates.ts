#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type CDPSession, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, docOpen, firstRun, newChannel, say } from "./perf-ui.ts";

if (process.argv.includes("--help")) {
  console.log(`What a thread doc's updates cost the page, by the length of the thread. Two windows of jow in one channel with
--lines lines already sent (40). The writer sends --sends more lines (20), each one a block added to the shared doc, and the
reader, at the bottom of the same thread, is measured: main-thread script, style, layout and task time (CDP Performance.getMetrics),
the React components rendered and the commits, the frames it received and its long tasks, per line. Then the reader types
--chars characters (200) in its own composer and is measured per key. Run it at two lengths to see whether the cost grows with
the thread. Chromium only.

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

async function switchTo(page: Page, name: string): Promise<void> {
  await page.evaluate((title) => {
    const tile = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Channels"] button.tile')].find((b) => (b.getAttribute("aria-label") ?? "").split(",")[0] === title);
    if (!tile) throw new Error(`no ${title} tile in the rail`);
    tile.click();
  }, name);
  await page.waitForFunction((title) => document.querySelector('nav[aria-label="Channels"] button.tile[aria-current="page"]')?.getAttribute("aria-label")?.split(",")[0] === title, name, {
    timeout: 15000,
  });
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
  await a.waitForFunction((want) => document.querySelector(".main .feed-list")?.textContent?.includes(want), `line ${LINES} of ${LINES}`, { timeout: 60000 });
  await b.waitForFunction((want) => document.querySelector(".main .feed-list")?.textContent?.includes(want), `line ${LINES} of ${LINES}`, { timeout: 60000 });
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
  const perKeyTyped = await during(CHARS, () => composer(a).pressSequentially(typed(CHARS), { delay: 30 }));
  const result = { lines: LINES, sends: SENDS, chars: CHARS, idlePerLine, perLineSent, perKeyTyped };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
