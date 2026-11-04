#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type BrowserContext, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { firstRun, letIn, newChannel } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const num = (name: string, fallback: number): number => Number(arg(name) ?? fallback);
const DIST = harnessDist(arg("dist"));
const ENGINE = process.argv.includes("--chromium") ? "chromium" : "webkit";
const SEED = num("seed", Math.floor(Math.random() * 2 ** 31));
const STEPS = num("steps", 200);
const WINDOWS = num("windows", 3);
const AGENTS = num("agents", 2);
const MAX_LAG = num("max-lag", 2000);
const KEY_MIN = num("key-min", 5);
const KEY_MAX = num("key-max", 10);
const DROPS = process.argv.includes("--no-drops") ? 0 : num("drop-every", 40);
const SEND = arg("send-key") ?? "Enter";
const TRACE = arg("trace") ?? `doc-fuzz-${SEED}.txt`;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
const LETTERS = "abcdefghijklmnopqrstuvwxyz      ";
const word = (n: number): string => Array.from({ length: n }, () => pick([...LETTERS])).join("");

const data = mkdtempSync(join(tmpdir(), "kiwi-doc-fuzz-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const cliEnv = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };

const kiwi = (args: string[]): Promise<string> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => void (out += d.toString("utf8"));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ").slice(0, 60)} exited ${code}: ${out.trim().split("\n").pop()}`)))));
};

const trace: string[] = [];
const log = (line: string): void => void trace.push(`${new Date().toISOString().slice(11, 23)} ${line}`);

interface Lag {
  ms: number;
  jitter: number;
  closers: (() => void)[];
}

interface Win {
  label: string;
  page: Page;
  lag: Lag;
  line: string | null;
  want: string;
  sent: string[];
}

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const errors: string[] = [];

async function laggy(context: BrowserContext, label: string): Promise<Lag> {
  const lag: Lag = { ms: 0, jitter: 0, closers: [] };
  await context.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    let upAt = 0;
    let downAt = 0;
    const later = (last: number, send: () => void): number => {
      const at = Math.max(last, Date.now() + lag.ms + Math.floor(rand() * (lag.jitter + 1)));
      setTimeout(send, at - Date.now());
      return at;
    };
    ws.onMessage((m) => void (upAt = later(upAt, () => server.send(m))));
    server.onMessage((m) => void (downAt = later(downAt, () => ws.send(m))));
    lag.closers.push(() => void ws.close().catch(() => undefined));
    log(`${label} socket opened`);
  });
  return lag;
}

async function windowOf(label: string, from?: BrowserContext): Promise<Win> {
  const storageState = from ? await from.storageState({ indexedDB: true }) : undefined;
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState });
  const lag = await laggy(context, label);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(BASE);
  if (!from) await firstRun(page, "jow");
  return { label, page, lag, line: null, want: "", sent: [] };
}

async function general(w: Win): Promise<void> {
  await w.page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: /general/ })
    .click();
  await w.page.locator(".thread-doc .ProseMirror").first().waitFor({ timeout: 30000 });
}

interface Here {
  id: string;
  by: string;
  text: string;
}

async function here(w: Win): Promise<Here | null> {
  return w.page.evaluate(() => {
    const at = getSelection()?.anchorNode ?? null;
    const el = at instanceof Element ? at : (at?.parentElement ?? null);
    const section = el?.closest<HTMLElement>(".thread-doc section.blk");
    if (!section) return null;
    const attrs = (section as unknown as { pmViewDesc?: { node?: { attrs: Record<string, unknown>; textContent: string } } }).pmViewDesc?.node;
    return { id: String(attrs?.attrs.id ?? section.dataset.block ?? ""), by: String(attrs?.attrs.by ?? ""), text: attrs?.textContent ?? "" };
  });
}

let failed: string | null = null;
const fail = (why: string): void => {
  if (failed) return;
  failed = why;
  log(`FAIL ${why}`);
};

async function writes(w: Win): Promise<string> {
  const got = await w.page.evaluate(() => (globalThis as unknown as { __ow?: unknown[] }).__ow?.slice(-40) ?? []);
  return got.map((e) => `      ${JSON.stringify(e)}`).join("\n");
}

async function startLine(w: Win): Promise<void> {
  await w.page.locator(".thread-doc .doc-tail").last().click();
  const h = await here(w);
  w.line = h?.id ?? null;
  w.want = h?.text ?? "";
  log(`${w.label} starts line ${w.line} by ${h?.by} with ${JSON.stringify(w.want)}`);
}

async function keys(w: Win, text: string): Promise<void> {
  for (const ch of text) {
    await w.page.keyboard.type(ch);
    await Bun.sleep(int(KEY_MIN, KEY_MAX));
  }
}

async function check(w: Win, after: string): Promise<void> {
  const h = await here(w);
  log(`  ${w.label} in ${h?.id} ${JSON.stringify(h?.text)}`);
  if (!h) return fail(`${w.label} after ${after}: its caret left the doc`);
  if (h.id !== w.line) return fail(`${w.label} after ${after}: its caret moved from line ${w.line} to ${h.id} (${JSON.stringify(h.text)})`);
  if (h.text !== w.want) return fail(`${w.label} after ${after}: its line reads ${JSON.stringify(h.text)}, typed ${JSON.stringify(w.want)}`);
}

type Op = (w: Win) => Promise<string>;

const ops: [number, Op][] = [
  [
    50,
    async (w) => {
      const t = word(int(1, 12));
      await keys(w, t);
      w.want += t;
      return `types ${JSON.stringify(t)}`;
    },
  ],
  [
    15,
    async (w) => {
      const n = int(1, Math.min(6, w.want.length || 1));
      for (let i = 0; i < n && w.want.length; i++) {
        await w.page.keyboard.press("Backspace");
        w.want = w.want.slice(0, -1);
        await Bun.sleep(int(KEY_MIN, KEY_MAX));
      }
      return `presses Backspace ${n}x`;
    },
  ],
  [
    8,
    async (w) => {
      const t = word(int(5, 40));
      await w.page.evaluate((text) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, t);
      w.want += t;
      return `pastes ${JSON.stringify(t)}`;
    },
  ],
  [
    6,
    async (w) => {
      if (!w.want) return "skips a line replace on an empty line";
      for (let i = 0; i < w.want.length; i++) await w.page.keyboard.press("Shift+ArrowLeft");
      const t = word(int(1, 8)).trim() || "x";
      await keys(w, t);
      w.want = t;
      return `selects its line and types ${JSON.stringify(t)} over it`;
    },
  ],
  [
    10,
    async (w) => {
      if (!w.want.trim()) return "skips sending an empty line";
      await w.page.keyboard.press(SEND);
      w.sent.push(w.want.trim());
      log(`${w.label} sends ${JSON.stringify(w.want)} with ${SEND}`);
      await startLine(w);
      return `sends its line with ${SEND}`;
    },
  ],
  [
    6,
    async (w) => {
      w.lag.ms = int(0, MAX_LAG);
      w.lag.jitter = int(0, Math.floor(MAX_LAG / 4));
      return `relay lag set to ${w.lag.ms} ms ± ${w.lag.jitter}`;
    },
  ],
];
if (DROPS)
  ops.push([
    Math.max(1, Math.round(100 / DROPS)),
    async (w) => {
      for (const close of w.lag.closers.splice(0)) close();
      return "drops its socket";
    },
  ]);
const total = ops.reduce((s, [n]) => s + n, 0);
function nextOp(): Op {
  let r = rand() * total;
  for (const [n, op] of ops) if ((r -= n) < 0) return op;
  return ops[0]![1];
}

let agentsOn = true;
async function agent(name: string): Promise<void> {
  let n = 0;
  while (agentsOn) {
    n++;
    const sent = await kiwi(["-c", "fuzz", "--as", name, "send", "--to", "#general", `${name} line ${n}: building`]).catch((e: unknown) => (errors.push(String(e)), ""));
    const seq = /#(\d+)/.exec(sent)?.[1];
    for (let k = 1; seq && agentsOn && k <= 3; k++) await kiwi(["-c", "fuzz", "--as", name, "edit", seq, `${name} line ${n}: building, step ${k} of 3`]).catch((e: unknown) => errors.push(String(e)));
  }
}

async function docLines(): Promise<string[]> {
  const out = await kiwi(["-c", "fuzz", "--as", "bot1", "show", "general"]);
  return out.split("\n").map((l) => l.trim());
}

function inOrder(lines: readonly string[], sent: readonly string[]): string | null {
  let at = 0;
  for (const s of sent) {
    const i = lines.findIndex((l, k) => k >= at && l === `jow: ${s}`);
    if (i < 0) return s;
    at = i + 1;
  }
  return null;
}

async function dump(w: Win): Promise<string> {
  return w.page.evaluate(() =>
    [...document.querySelectorAll(".thread-doc section.blk")]
      .map((s) => {
        const a = (s as unknown as { pmViewDesc?: { node?: { attrs: Record<string, unknown>; textContent: string } } }).pmViewDesc?.node;
        return `      ${String(a?.attrs.id)} ${String(a?.attrs.author)} by=${String(a?.attrs.by)} sent=${String(a?.attrs.sent)} posted=${String(a?.attrs.posted)} ${JSON.stringify(a?.textContent)}`;
      })
      .slice(-8)
      .join("\n"),
  );
}

async function shown(w: Win): Promise<string[]> {
  return w.page.evaluate(() =>
    [...document.querySelectorAll(".thread-doc section.blk")].map((s) => (s as unknown as { pmViewDesc?: { node?: { textContent: string } } }).pmViewDesc?.node?.textContent ?? ""),
  );
}

console.log(`seed ${SEED}: ${WINDOWS} windows of jow + ${AGENTS} agents, ${STEPS} steps, keys every ${KEY_MIN}-${KEY_MAX} ms, relay lag up to ${MAX_LAG} ms, in ${ENGINE}`);
const wins: Win[] = [];
try {
  const first = await windowOf("w1");
  const code = await newChannel(first.page, "fuzz");
  for (let i = 1; i <= AGENTS; i++) {
    let joined = false;
    const joining = kiwi(["join", code, "fuzz", "--relay", BASE, "--as", `bot${i}`]).then(() => void (joined = true));
    await letIn(first.page, () => !joined);
    await joining;
  }
  wins.push(first);
  for (let i = 2; i <= WINDOWS; i++) wins.push(await windowOf(`w${i}`, first.page.context()));
  for (const w of wins) await general(w);
  for (let i = 1; i <= AGENTS; i++) void agent(`bot${i}`);
  await Bun.sleep(1500);
  for (const w of wins) await startLine(w);
  for (let step = 1; step <= STEPS && !failed; step++) {
    const w = pick(wins);
    const op = nextOp();
    const did = await op(w);
    log(`step ${step}: ${w.label} ${did}`);
    for (const v of wins) await check(v, `step ${step} (${w.label} ${did})`);
    if (failed) for (const v of wins) log(`  ${v.label} doc:\n${await dump(v)}\n  ${v.label} own-writes log (local instrumented builds only):\n${await writes(v)}`);
    if (process.env.FUZZ_DUMP) for (const v of wins) log(`  ${v.label} doc:\n${await dump(v)}`);
    if (step % 25 === 0) console.log(`  step ${step} ok`);
  }
  if (!failed) {
    for (const w of wins) {
      if (w.want.trim()) {
        await w.page.keyboard.press(SEND);
        w.sent.push(w.want.trim());
      }
      w.lag.ms = 0;
      w.lag.jitter = 0;
    }
    agentsOn = false;
    const until = Date.now() + 30_000;
    let docs = await Promise.all(wins.map(shown));
    let lines = await docLines();
    while (Date.now() < until && (docs.some((d) => JSON.stringify(d) !== JSON.stringify(docs[0])) || wins.some((w) => inOrder(lines, w.sent)))) {
      await Bun.sleep(1000);
      docs = await Promise.all(wins.map(shown));
      lines = await docLines();
    }
    log(`drained: the CLI shows\n${lines.map((l) => `      ${l}`).join("\n")}`);
    for (const [i, d] of docs.entries()) log(`drained: ${wins[i]!.label} shows\n${d.map((l) => `      ${JSON.stringify(l)}`).join("\n")}`);
    for (const w of wins) {
      const lost = inOrder(lines, w.sent);
      if (lost) fail(`${w.label} sent ${JSON.stringify(lost)}, but the doc doesn't have it as a line of jow's, in order`);
    }
    for (const [i, d] of docs.entries()) if (JSON.stringify(d) !== JSON.stringify(docs[0])) fail(`${wins[i]!.label} shows a different doc than w1 after the relay drained`);
  }
} finally {
  agentsOn = false;
  await Bun.sleep(1000);
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
for (const e of errors.slice(0, 5)) log(`note: ${e}`);
writeFileSync(TRACE, `seed ${SEED}\n${failed ?? "pass"}\n\n${trace.join("\n")}\n`);
if (failed) {
  console.error(
    `✗ seed ${SEED}: ${failed}\n  trace: ${TRACE}\n  replay: bun scripts/ui-doc-fuzz.ts --seed=${SEED} --steps=${STEPS} --windows=${WINDOWS} --agents=${AGENTS} --max-lag=${MAX_LAG}${ENGINE === "chromium" ? " --chromium" : ""}`,
  );
  process.exitCode = 1;
} else console.log(`✓ seed ${SEED}: ${STEPS} steps, every window's line stayed its own and every sent line is in the doc, in order`);
