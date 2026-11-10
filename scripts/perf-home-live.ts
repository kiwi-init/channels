#!/usr/bin/env bun
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as Effect from "effect/Effect";
import { chromium, type CDPSession, type Page } from "playwright-core";
import { chooseThread } from "@kiwi/core/state.ts";
import { AgentSession, oneLook, runAgent } from "../src/agent.ts";
import { loadConfig } from "../src/config.ts";
import { daemonSock } from "../src/daemon/protocol.ts";
import { stopDaemon } from "../src/daemon/rpc.ts";
import { startLocalRelay } from "./local-relay.ts";
import { firstRun, letIn, newChannel, say } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";

if (process.argv.includes("--help")) {
  console.log(`What a needs-you badge costs and how fast it moves for a channel that isn't open. PERF_CHANNELS channels (20), each with
PERF_MESSAGES messages (20); an agent in the first one. Samples the page's JS heap after GC and the browser's open connections to
the relay: in a channel, on Home, and back in a channel. Then, with the last channel open, the agent asks in the first one and
closes the ask again: how long the first channel's rail tile takes to show the badge and to drop it.

  bun scripts/ui-harness.ts && bun scripts/perf-home-live.ts [--dist=ui/dist-harness] [--json out.json]`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const CHANNELS = Number(process.env.PERF_CHANNELS ?? 20);
const MESSAGES = Number(process.env.PERF_MESSAGES ?? 20);
const SETTLE_MS = 10000;
const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const jsonAt = process.argv.indexOf("--json");
const OUT = jsonAt > 0 ? process.argv[jsonAt + 1] : undefined;
const data = mkdtempSync(join(tmpdir(), "kiwi-home-live-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
process.env.KIWI_HOME = join(cli, "home");
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

const log = (...xs: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...xs);
const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const browserPid = browser.process?.()?.pid;

function browserConnections(): number {
  const ss = spawnSync("ss", ["-Htnp", "state", "established", `( dport = :${port} )`], { encoding: "utf8" });
  return ss.stdout
    .split("\n")
    .filter((l) => l.trim())
    .filter((l) => /chrom|headless/i.test(l) || (browserPid !== undefined && l.includes(`pid=${browserPid},`))).length;
}

async function sample(cdp: CDPSession, page: Page, phase: string): Promise<Record<string, number | string>> {
  await page.waitForTimeout(SETTLE_MS);
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const s = { phase, heapMB: mb(m.JSHeapUsedSize ?? 0), nodes: m.Nodes ?? 0, connections: browserConnections() };
  log(phase, JSON.stringify(s));
  return s;
}

const tileLabel = (page: Page, title: string): Promise<string | null> =>
  page.evaluate(
    (t) => [...document.querySelectorAll<HTMLElement>('nav[aria-label="Channels"] button.tile')].find((b) => (b.getAttribute("aria-label") ?? "").split(",")[0] === t)?.getAttribute("aria-label") ?? null,
    title,
  );

async function switchTo(page: Page, title: string): Promise<void> {
  await page.evaluate((t) => {
    const tile = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Channels"] button.tile')].find((b) => (b.getAttribute("aria-label") ?? "").split(",")[0] === t);
    if (!tile) throw new Error(`no ${t} tile in the rail`);
    tile.click();
  }, title);
  await page.waitForFunction((t) => document.querySelector('nav[aria-label="Channels"] button.tile[aria-current="page"]')?.getAttribute("aria-label")?.split(",")[0] === t, title, { timeout: 15000 });
}

async function until(page: Page, title: string, want: (label: string) => boolean, timeoutMs: number): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const label = await tileLabel(page, title);
    if (label !== null && want(label)) return Date.now() - t0;
    await page.waitForTimeout(100);
  }
  return null;
}

const report: Record<string, unknown> = { dist: DIST, channels: CHANNELS, messagesPerChannel: MESSAGES };
const samples: Record<string, number | string>[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => log(`page error: ${e.message}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(BASE);
  await firstRun(page, "Jonatas");

  const titles = Array.from({ length: CHANNELS }, (_, i) => `ch${i + 1}`);
  const [b, ...rest] = titles;
  const a = titles[titles.length - 1]!;
  const codeB = await newChannel(page, b!);
  let joined = 0;
  const joining = kiwi(["join", codeB, "bee", "--as", "asker", "--model", "claude-opus-5-5", "--relay", BASE]).then(() => void joined++);
  await letIn(page, () => joined < 1);
  await joining;
  const asker = await AgentSession.open("bee", loadConfig().channels["bee"]!, "asker");
  for (let n = 1; n <= MESSAGES; n++) await say(page, `${b} line ${n}`);
  for (const title of rest) {
    await newChannel(page, title);
    for (let n = 1; n <= MESSAGES; n++) await say(page, `${title} line ${n}`);
  }
  log(`${CHANNELS} channels made, ${MESSAGES} messages each, an agent in ${b}`);

  await switchTo(page, a);
  samples.push(await sample(cdp, page, `in ${a}`));
  await page.getByRole("button", { name: "Home", exact: true }).click();
  samples.push(await sample(cdp, page, "on Home"));
  await switchTo(page, a);
  samples.push(await sample(cdp, page, `in ${a}, after Home`));

  const ask = await runAgent(
    oneLook(
      Effect.gen(function* () {
        const { state } = yield* asker.state();
        const chosen = chooseThread(state, asker.me, {});
        if (typeof chosen === "string") return yield* Effect.fail(new Error(chosen));
        return yield* asker.send("Which colour for the button, blue or green?", { kind: "ask", ...(chosen.to ? { to: chosen.to } : {}) });
      }),
    ),
  );
  const arrivedMs = await until(page, b!, (l) => l.includes("need you"), 30000);
  log(`an ask in ${b} while ${a} is open: ${arrivedMs === null ? "no badge after 30 s" : `badge after ${arrivedMs} ms`}`);
  await runAgent(asker.closeAsk(ask, "settled elsewhere"));
  const clearedMs = arrivedMs === null ? null : await until(page, b!, (l) => !l.includes("need you"), 30000);
  log(`the ask closed: ${arrivedMs === null ? "nothing to clear" : clearedMs === null ? "badge still there after 30 s" : `badge gone after ${clearedMs} ms`}`);
  report.askArrivalBadgeMs = arrivedMs;
  report.askClosedBadgeGoneMs = clearedMs;

  await page.waitForTimeout(50000);
  samples.push(await sample(cdp, page, `in ${a}, a minute later`));
  report.samples = samples;
} finally {
  if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  for (const p of running) p.kill();
  await stopDaemon(daemonSock(join(cli, "home")));
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
