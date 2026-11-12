#!/usr/bin/env bun
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as Effect from "effect/Effect";
import { chromium, type Page } from "playwright-core";
import { AgentSession, oneLook, runAgent } from "../src/agent.ts";
import { loadConfig } from "../src/config.ts";
import { daemonSock } from "../src/daemon/protocol.ts";
import { stopDaemon } from "../src/daemon/rpc.ts";
import { startLocalRelay } from "./local-relay.ts";
import { firstRun, letIn, newChannel, say } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";
import { pageErrors } from "./page-errors.ts";

if (process.argv.includes("--help")) {
  console.log(`A channel's needs-you badge on the rail moves while you sit in another channel. Three channels; an agent in alpha.
With gamma open, the agent asks Jonatas in alpha: alpha's tile shows 1 need you. Into alpha and back to gamma, it still shows
exactly 1, and only alpha and gamma open sockets (beta keeps its follower). The agent closes the ask: the badge goes. --shot PATH saves the rail as it is once the ask has arrived.

  bun scripts/ui-harness.ts && bun scripts/ui-rail-needs.ts [--dist=ui/dist-harness] [--shot rail.png]`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const shotAt = process.argv.indexOf("--shot");
const SHOT = shotAt > 0 ? process.argv[shotAt + 1] : undefined;
const WAIT_MS = 10000;
const data = mkdtempSync(join(tmpdir(), "kiwi-rail-needs-"));
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

const failures: string[] = [];
const check = (what: string, why: string | null): void => {
  if (why) failures.push(`${what}: ${why}`);
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
};

const tileLabel = (page: Page, title: string): Promise<string | null> =>
  page.evaluate(
    (t) =>
      [...document.querySelectorAll<HTMLElement>('nav[aria-label="Channels"] button.tile')].find((b) => (b.getAttribute("aria-label") ?? "").split(",")[0] === t)?.getAttribute("aria-label") ?? null,
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

async function until(page: Page, title: string, want: (label: string) => boolean): Promise<{ ms: number | null; label: string | null }> {
  const t0 = Date.now();
  let label: string | null = null;
  while (Date.now() - t0 < WAIT_MS) {
    label = await tileLabel(page, title);
    if (label !== null && want(label)) return { ms: Date.now() - t0, label };
    await page.waitForTimeout(100);
  }
  return { ms: null, label };
}

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined }).catch((err: unknown) => {
  relay.kill();
  throw err;
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pageErrors(page, (e) => console.log(`page error: ${e}`));
  await page.goto(BASE);
  await firstRun(page, "Jonatas");
  const code = await newChannel(page, "alpha");
  let joined = 0;
  const joining = kiwi(["join", code, "bee", "--as", "asker", "--model", "claude-opus-5-5", "--relay", BASE]).then(() => void joined++);
  await letIn(page, () => joined < 1);
  await joining;
  const asker = await AgentSession.open("bee", loadConfig().channels["bee"]!, "asker");
  await say(page, "Pick the button colour, please");
  await newChannel(page, "beta");
  await say(page, "beta line");
  await newChannel(page, "gamma");
  await say(page, "gamma line");
  await switchTo(page, "gamma");

  const head = await runAgent(oneLook(Effect.map(asker.state(), ({ state }) => Math.max(...state.askHeads.keys()))));
  if (!Number.isFinite(head)) throw new Error("no message of Jonatas's in alpha for the ask to hold");
  const ask = await runAgent(
    oneLook(Effect.map(asker.escalate("Which colour for the button, blue or green?", undefined, undefined, { choices: ["A: blue", "B: green"], holds: [head] }), (sent) => sent.seq)),
  );
  const arrived = await until(page, "alpha", (l) => l.includes("1 need you"));
  check("an ask in alpha shows 1 need you on alpha's tile while gamma is open", arrived.ms === null ? `after ${WAIT_MS / 1000} s the tile reads "${arrived.label}"` : null);
  if (SHOT) await page.locator('nav[aria-label="Channels"]').screenshot({ path: SHOT });

  const opened: string[] = [];
  page.on("websocket", (ws) => void opened.push(ws.url()));
  await switchTo(page, "alpha");
  await switchTo(page, "gamma");
  const back = await until(page, "alpha", (l) => l.includes("1 need you"));
  await page.waitForTimeout(2000);
  const rooms = new Set(opened.map((u) => /\/rooms\/([^/]+)\/ws/.exec(u)?.[1] ?? u));
  check("into alpha and back to gamma, only those two channels open sockets: beta keeps its follower", rooms.size > 2 ? `${rooms.size} rooms reconnected: ${opened.join(", ")}` : null);
  check("into alpha and back to gamma, alpha's tile still shows exactly 1 need you", back.ms === null ? `after ${WAIT_MS / 1000} s the tile reads "${back.label}"` : null);

  await runAgent(asker.closeAsk(ask, "settled elsewhere"));
  const cleared = await until(page, "alpha", (l) => !l.includes("need you"));
  check("the agent closes the ask and alpha's badge goes while gamma is open", cleared.ms === null ? `after ${WAIT_MS / 1000} s the tile reads "${cleared.label}"` : null);
} finally {
  await browser.close();
  for (const p of running) p.kill();
  await stopDaemon(daemonSock(join(cli, "home")));
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
