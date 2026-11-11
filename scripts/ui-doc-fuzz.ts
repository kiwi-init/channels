#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type BrowserContext, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, firstRun, letIn, newChannel } from "./perf-ui.ts";
import { inOrder } from "./doc-oracle.ts";

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
const SEND = arg("send-key") ?? "ControlOrMeta+Enter";
const SELECTS = !process.argv.includes("--no-select");
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
const LIVE = process.argv.includes("--live");
const log = (line: string): void => {
  const stamped = `${new Date().toISOString().slice(11, 23)} ${line}`;
  trace.push(stamped);
  if (LIVE && !line.startsWith("  ")) console.log(stamped);
};

interface Lag {
  ms: number;
  jitter: number;
  closers: (() => void)[];
  sockets: { url: string; upIn: number; up: number; downIn: number; down: number; lastDown: number; closed: boolean; errors: number }[];
}

interface Win {
  label: string;
  page: Page;
  lag: Lag;
  want: string;
  sent: string[];
}

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const errors: string[] = [];

async function laggy(context: BrowserContext, label: string): Promise<Lag> {
  const lag: Lag = { ms: 0, jitter: 0, closers: [], sockets: [] };
  await context.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    const seen = {
      url: ws
        .url()
        .replace(/^.*\/\/[^/]+/, "")
        .slice(0, 60),
      upIn: 0,
      up: 0,
      downIn: 0,
      down: 0,
      lastDown: 0,
      closed: false,
      errors: 0,
    };
    lag.sockets.push(seen);
    ws.onClose(() => void (seen.closed = true));
    server.onClose(() => void (seen.closed = true));
    const pipe = (): ((send: () => void) => void) => {
      const q: { at: number; send: () => void }[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const pump = (): void => {
        timer = null;
        while (q.length && q[0]!.at <= Date.now()) q.shift()!.send();
        if (q.length) timer = setTimeout(pump, q[0]!.at - Date.now());
      };
      return (send) => {
        const at = Math.max(q.at(-1)?.at ?? 0, Date.now() + lag.ms + Math.floor(rand() * (lag.jitter + 1)));
        q.push({ at, send });
        if (!timer) timer = setTimeout(pump, Math.max(0, at - Date.now()));
      };
    };
    const safely = (send: () => void): void => {
      try {
        send();
      } catch {
        // A message for a socket that already closed: count it, the app reconnects.
        seen.errors++;
      }
    };
    const up = pipe();
    const down = pipe();
    ws.onMessage((m) => {
      seen.upIn++;
      up(() => safely(() => (server.send(m), seen.up++)));
    });
    server.onMessage((m) => {
      seen.downIn++;
      down(() => safely(() => (ws.send(m), seen.down++, (seen.lastDown = Date.now()))));
    });
    lag.closers.push(() => void ws.close().catch(() => undefined));
    log(`${label} socket opened`);
  });
  return lag;
}

async function windowOf(label: string, from?: BrowserContext): Promise<Win> {
  const storageState = from ? await from.storageState({ indexedDB: true }) : undefined;
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState });
  const lag = await laggy(context, label);
  await context.addInitScript(() => {
    const Real = window.ResizeObserver;
    const calls: string[] = [];
    let n = 0;
    const name = (el: Element): string =>
      `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}`;
    window.ResizeObserver = class extends Real {
      constructor(cb: ResizeObserverCallback) {
        const id = ++n;
        const where = (new Error().stack ?? "")
          .split("\n")
          .slice(1, 4)
          .map((l) => l.replace(/https?:\/\/[^/]+\//, "").trim())
          .join(" < ");
        super((entries, obs) => {
          calls.push(
            `${performance.now().toFixed(1)} ro${id} [${where.slice(0, 160)}] ${entries
              .map((e) => `${name(e.target)} ${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`)
              .join(", ")
              .slice(0, 300)}`,
          );
          if (calls.length > 60) calls.shift();
          cb(entries, obs);
          const after = entries.map((e) => {
            const r = e.target.getBoundingClientRect();
            const el = e.target instanceof HTMLElement ? e.target : null;
            return `${Math.round(r.width)}x${Math.round(r.height)}${el?.style.paddingBottom ? ` pb=${el.style.paddingBottom}` : ""}${el && el.scrollHeight > el.clientHeight ? ` scroll=${Math.round(el.scrollTop)}/${el.scrollHeight - el.clientHeight}` : ""}`;
          });
          calls.push(`  after ro${id}: ${after.join(", ")}`);
          if (calls.length > 60) calls.shift();
        });
      }
    };
    window.addEventListener("error", (e) => {
      if (String(e.message).includes("ResizeObserver")) console.log(`RO-LOOP at ${performance.now().toFixed(1)}\n${calls.slice(-25).join("\n")}`);
    });
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.text().startsWith("RO-LOOP")) log(`${label} ${m.text()}`);
  });
  page.on("pageerror", (e) => {
    if (!live) return;
    errors.push(`${label}: ${e.message}`);
    log(`error ${label}: ${e.message}`);
  });
  await page.goto(BASE);
  if (!from) await firstRun(page, "jow");
  return { label, page, lag, want: "", sent: [] };
}

async function general(w: Win): Promise<void> {
  await w.page.locator('section[aria-label="Rooms"] button').filter({ hasText: "general" }).click();
  await w.page.locator(".thread-doc").first().waitFor({ state: "attached", timeout: 30000 });
}

let failed: string | null = null;
const fail = (why: string): void => {
  if (failed) return;
  failed = why;
  log(`FAIL ${why}`);
};

async function writes(w: Win): Promise<string> {
  const got = await w.page.evaluate(() =>
    ((globalThis as unknown as { __ow?: unknown[] }).__ow?.slice(-40) ?? []).map((e) => {
      try {
        return JSON.stringify(e);
      } catch {
        // A cyclic entry still shows what it is.
        return String(e);
      }
    }),
  );
  return got.map((e) => `      ${e}`).join("\n");
}

interface Stored {
  clocks: string;
  lines: string[];
}

async function stored(w: Win): Promise<Stored | null> {
  return w.page.evaluate(() => {
    interface YText {
      toString: () => string;
    }
    interface YEl {
      getAttribute: (k: string) => unknown;
      toArray: () => unknown[];
      nodeName?: string;
    }
    interface YDoc {
      store: { clients: Map<number, { id: { clock: number }; length: number }[]>; pendingStructs: { missing: Map<number, number> } | null; pendingDs: unknown };
      share: Map<string, { toArray: () => unknown[]; length: number }>;
    }
    const docs = [...((globalThis as unknown as { __ydocs?: Set<YDoc> }).__ydocs ?? [])];
    const thread = docs.map((d) => ({ d, f: d.share.get("thread") })).filter((x) => x.f && x.f.length > 0);
    const pick = thread.sort((a, b) => (b.f?.length ?? 0) - (a.f?.length ?? 0))[0];
    if (!pick?.f) return null;
    const textOf = (n: unknown): string => {
      const el = n as YEl;
      if (typeof el.toArray === "function" && typeof el.getAttribute === "function")
        return el
          .toArray()
          .map(textOf)
          .join(el.nodeName === "block" ? "\n" : "");
      return (n as YText).toString().replace(/<[^>]*>/g, "");
    };
    const clocks = [...pick.d.store.clients.entries()]
      .map(([c, structs]) => {
        const last = structs.at(-1);
        return `${c}:${last ? last.id.clock + last.length : 0}`;
      })
      .sort()
      .join(" ");
    const lines = pick.f.toArray().map((el) => {
      const e = el as YEl;
      return `${String(e.getAttribute("id")).slice(0, 6)} ${String(e.getAttribute("author"))} ${JSON.stringify(textOf(el))}`;
    });
    const pending = pick.d.store.pendingStructs;
    const waits = pending ? ` PENDING, waiting for ${[...pending.missing.entries()].map(([c, k]) => `${c}:${k}`).join(" ")}` : "";
    return { clocks: `${clocks}${waits}${pick.d.store.pendingDs ? " (pending deletes)" : ""}`, lines };
  });
}

async function focus(w: Win): Promise<void> {
  await composer(w.page).evaluate((el) => {
    if (!(el instanceof HTMLTextAreaElement) || el === document.activeElement) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
}

async function keys(w: Win, text: string): Promise<void> {
  for (const ch of text) {
    await w.page.keyboard.type(ch);
    await Bun.sleep(int(KEY_MIN, KEY_MAX));
  }
}

async function check(w: Win, after: string): Promise<void> {
  const value = await composer(w.page).inputValue();
  log(`  ${w.label} composer ${JSON.stringify(value)}`);
  if (value !== w.want) return fail(`${w.label} after ${after}: its composer reads ${JSON.stringify(value)}, typed ${JSON.stringify(w.want)}`);
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
      await w.page.keyboard.insertText(t);
      w.want += t;
      return `inserts ${JSON.stringify(t)} at once`;
    },
  ],
  [
    SELECTS ? 6 : 0,
    async (w) => {
      if (!w.want || w.want.includes("\n")) return "skips a line replace on an empty or broken line";
      for (let i = 0; i < w.want.length; i++) await w.page.keyboard.press("Shift+ArrowLeft");
      const picked = await composer(w.page).evaluate((el) => (el instanceof HTMLTextAreaElement ? el.value.slice(el.selectionStart, el.selectionEnd) : ""));
      if (picked !== w.want) fail(`${w.label} pressed Shift+← ${w.want.length} times over its line ${JSON.stringify(w.want)} and the selection is ${JSON.stringify(picked)}`);
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
      w.want = "";
      return `sends its line with ${SEND}`;
    },
  ],
  [
    8,
    async (w) => {
      if (!w.want || w.want.endsWith("\n")) return "skips Shift+Enter on an empty line";
      await w.page.keyboard.press("Shift+Enter");
      w.want += "\n";
      return "presses Shift+Enter, which only breaks the line";
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
let live = true;
const traffic = new Map<string, { sends: number; edits: number }>();
async function agent(name: string): Promise<void> {
  const did = { sends: 0, edits: 0 };
  traffic.set(name, did);
  const refused = (what: string) => (e: unknown) => void (agentsOn && errors.push(`${name} ${what}: ${String(e)}`));
  let n = 0;
  while (agentsOn) {
    n++;
    const sent = await kiwi(["-c", "fuzz", "--as", name, "send", "--to", "#general", `${name} line ${n}: building`]).catch(refused("send"));
    const seq = sent ? /#(\d+)/.exec(sent)?.[1] : undefined;
    if (sent && !seq && agentsOn) errors.push(`${name} send said no #seq: ${JSON.stringify(sent.trim())}`);
    if (seq) did.sends++;
    for (let k = 1; seq && agentsOn && k <= 3; k++) {
      const edited = await kiwi(["-c", "fuzz", "--as", name, "edit", seq, `${name} line ${n}: building, step ${k} of 3`]).then(
        () => true,
        (e: unknown) => (refused("edit")(e), false),
      );
      if (edited) did.edits++;
    }
  }
}

async function docText(): Promise<string> {
  return kiwi(["-c", "fuzz", "--as", "bot1", "show", "general"]);
}

async function dump(w: Win): Promise<string> {
  return w.page.evaluate(() =>
    [...document.querySelectorAll(".thread-doc section.blk")]
      .map((s) => {
        const a = (s as unknown as { pmViewDesc?: { node?: { attrs: Record<string, unknown>; textContent: string } } }).pmViewDesc?.node;
        return `      ${String(a?.attrs.id)} ${String(a?.attrs.author)} by=${String(a?.attrs.by)} sent=${String(a?.attrs.sent)} posted=${String(a?.attrs.posted)} ${JSON.stringify(a?.textContent)}`;
      })
      .slice(-20)
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
  for (let step = 1; step <= STEPS && !failed; step++) {
    const w = pick(wins);
    await focus(w);
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
        await composer(w.page).press(SEND);
        w.sent.push(w.want.trim());
      }
      w.lag.ms = 0;
      w.lag.jitter = 0;
    }
    agentsOn = false;
    const until = Date.now() + 30_000;
    let docs = await Promise.all(wins.map(shown));
    let out = await docText();
    while (Date.now() < until && (docs.some((d) => JSON.stringify(d) !== JSON.stringify(docs[0])) || wins.some((w) => inOrder(out, w.sent)))) {
      await Bun.sleep(1000);
      docs = await Promise.all(wins.map(shown));
      out = await docText();
    }
    live = false;
    log(
      `drained: the CLI shows\n${out
        .split("\n")
        .map((l) => `      ${l}`)
        .join("\n")}`,
    );
    const said = (await kiwi(["-c", "fuzz", "--as", "bot1", "log", "--json", "-n", "300"]).catch((e: unknown) => String(e))).split("\n").filter((l) => l.includes('"from":"jow"'));
    log(`drained: jow's messages in the log\n${said.map((l) => `      ${l.slice(0, 240)}`).join("\n")}`);
    for (const w of wins) log(`drained: ${w.label} doc lines\n${await dump(w)}`);
    for (const w of wins)
      log(
        `drained: ${w.label} sockets\n${w.lag.sockets.map((k) => `      ${k.url} up ${k.up}/${k.upIn} down ${k.down}/${k.downIn} last down ${k.lastDown ? `${Math.round((Date.now() - k.lastDown) / 1000)} s ago` : "never"}${k.closed ? " closed" : " open"}${k.errors ? ` ${k.errors} send errors` : ""}`).join("\n")}`,
      );
    const ys = await Promise.all(wins.map(stored));
    for (const [i, y] of ys.entries())
      log(`drained: ${wins[i]!.label} Yjs (local instrumented builds only) clocks ${y?.clocks ?? "(not exposed)"}\n${(y?.lines ?? []).map((l) => `      ${l}`).join("\n")}`);
    if (ys.every((y) => y)) {
      const sameY = ys.every((y) => y!.clocks === ys[0]!.clocks && JSON.stringify(y!.lines) === JSON.stringify(ys[0]!.lines));
      log(`drained: the windows' Yjs docs ${sameY ? "match" : "DIFFER"}; their screens ${docs.every((d) => JSON.stringify(d) === JSON.stringify(docs[0])) ? "match" : "DIFFER"}`);
      console.log(`  Yjs docs ${sameY ? "match" : "differ"} across windows after the drain`);
    }
    for (const [i, d] of docs.entries()) log(`drained: ${wins[i]!.label} shows\n${d.map((l) => `      ${JSON.stringify(l)}`).join("\n")}`);
    for (const w of wins) {
      const lost = inOrder(out, w.sent);
      if (lost) fail(`${w.label} sent ${JSON.stringify(lost)}, but the doc doesn't have that whole line as jow's, in order`);
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
for (const e of errors.slice(0, 10)) log(`error: ${e}`);
if (!failed && errors.length) fail(`${errors.length} error(s) while the windows and agents ran, first: ${errors[0]}`);
for (const [name, did] of traffic) if (!failed && did.sends === 0) fail(`${name} never got a line into #general, so the run had no agent traffic`);
if (!failed && traffic.size < AGENTS) fail(`only ${traffic.size} of ${AGENTS} agents ran`);
writeFileSync(TRACE, `seed ${SEED}\n${failed ?? "pass"}\n\n${trace.join("\n")}\n`);
if (failed) {
  console.error(
    `✗ seed ${SEED}: ${failed}\n  trace: ${TRACE}\n  replay: bun scripts/ui-doc-fuzz.ts --seed=${SEED} --steps=${STEPS} --windows=${WINDOWS} --agents=${AGENTS} --max-lag=${MAX_LAG}${ENGINE === "chromium" ? " --chromium" : ""}`,
  );
  process.exitCode = 1;
} else console.log(`✓ seed ${SEED}: ${STEPS} steps, every window's composer kept what it typed and every sent line is in the doc, in order`);
