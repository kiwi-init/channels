import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kimiHome } from "../kimi-server.ts";
import { runNow } from "../terminals/shared/run.ts";
import { tmuxNow } from "../terminals/shared/tmux.ts";

type Env = Record<string, string | undefined>;

export interface KimiStart {
  bin: string;
  model?: string;
}

export type KimiScreen = "ready" | "trust" | "starting";

export type KimiSession = { session: string; dir: string };

const CLOCK_MS = 2_000;
const TAIL_BYTES = 64 * 1024;
const READY = "one will be created on your first message";
const TRUST = "Trust this folder?";
const IDLE_EVENTS = new Set(["turn.ended", "prompt.completed"]);
const WORKING_EVENTS = new Set(["turn.prompt", "step.begin", "llm.request", "tool.call", "tool.result", "task.started"]);

export function kimiArgv({ bin, model }: KimiStart): string[] {
  return [bin, ...(model ? ["-m", model] : [])];
}

export function kimiScreen(text: string): KimiScreen {
  if (text.includes(TRUST)) return "trust";
  return text.includes(READY) ? "ready" : "starting";
}

export function paneText(socket: string, pane: string): string {
  return tmuxNow(socket, ["capture-pane", "-p", "-t", pane]) ?? "";
}

export function typeInto(socket: string, pane: string, text: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-loop-"));
  const buffer = `kiwi-loop-${process.pid}`;
  try {
    const file = join(dir, "prompt.txt");
    writeFileSync(file, text, { mode: 0o600 });
    if (tmuxNow(socket, ["load-buffer", "-b", buffer, file]) === null) return false;
    if (tmuxNow(socket, ["paste-buffer", "-p", "-d", "-b", buffer, "-t", pane]) === null) return false;
    return tmuxNow(socket, ["send-keys", "-t", pane, "Enter"]) !== null;
  } finally {
    tmuxNow(socket, ["delete-buffer", "-b", buffer]);
    rmSync(dir, { recursive: true, force: true });
  }
}

export function pasteBracketed(socket: string, pane: string): boolean {
  return tmuxNow(socket, ["display-message", "-p", "-t", pane, "#{bracket_paste_flag}"])?.trim() === "1";
}

export function clearPane(socket: string, pane: string): void {
  tmuxNow(socket, ["send-keys", "-R", "-t", pane]);
  tmuxNow(socket, ["clear-history", "-t", pane]);
}

export function paneIsOurs(socket: string, pane: string, procs: readonly Proc[] = processes()): boolean {
  const panePid = Number(tmuxNow(socket, ["display-message", "-p", "-t", pane, "#{pane_pid}"])?.trim());
  if (!Number.isInteger(panePid) || panePid <= 1) return false;
  const parent = new Map(procs.map((p) => [p.pid, p.ppid]));
  for (let pid: number | undefined = process.pid, hops = 0; pid !== undefined && pid > 1 && hops < 64; pid = parent.get(pid), hops++) {
    if (pid === panePid) return true;
  }
  return false;
}

function realDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    // A folder that can't be resolved is matched as given.
    return dir;
  }
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // No Kimi session written there yet.
    return [];
  }
}

function stateOf(dir: string): { cwd: string; createdAt: number } | null {
  try {
    const s: unknown = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    if (typeof s !== "object" || s === null || !("cwd" in s) || !("createdAt" in s)) return null;
    return typeof s.cwd === "string" && typeof s.createdAt === "number" ? { cwd: s.cwd, createdAt: s.createdAt } : null;
  } catch {
    // Not written yet, or Kimi is rewriting it.
    return null;
  }
}

function holds(file: string, nonce: string): boolean {
  try {
    return readFileSync(file, "utf8").includes(nonce);
  } catch {
    // The wire log isn't there yet.
    return false;
  }
}

export function kimiSession(nonce: string, since: number, cwd: string = process.cwd(), env: Env = process.env): KimiSession | null {
  const root = join(kimiHome(env), "sessions");
  const here = realDir(cwd);
  const found: { session: string; dir: string; at: number }[] = [];
  for (const wd of names(root).filter((n) => n.startsWith("wd_"))) {
    for (const name of names(join(root, wd)).filter((n) => n.startsWith("session_"))) {
      const dir = join(root, wd, name);
      const state = stateOf(dir);
      if (!state || realDir(state.cwd) !== here || state.createdAt < since - CLOCK_MS) continue;
      if (holds(join(dir, "agents", "main", "wire.jsonl"), nonce)) found.push({ session: name, dir, at: state.createdAt });
    }
  }
  const first = found.sort((a, b) => a.at - b.at)[0];
  return first ? { session: first.session, dir: first.dir } : null;
}

function tail(file: string): string[] {
  let fd: number | null = null;
  try {
    const size = statSync(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    fd = openSync(file, "r");
    readSync(fd, buf, 0, buf.length, from);
    const lines = buf.toString("utf8").split("\n");
    return from > 0 ? lines.slice(1) : lines;
  } catch {
    // No wire log yet: nothing to read a turn from.
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function mtimeOf(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    // No wire log yet, or one Kimi can't be read from.
    return null;
  }
}

function eventOf(line: string): string | null {
  try {
    const l: unknown = JSON.parse(line);
    return typeof l === "object" && l !== null && "type" in l && typeof l.type === "string" ? l.type : null;
  } catch {
    // A line cut by the tail's start, or one still being written.
    return null;
  }
}

export function kimiIdle(dir: string): { idle: boolean; since: number | null } {
  const file = join(dir, "agents", "main", "wire.jsonl");
  const since = mtimeOf(file);
  if (since === null) return { idle: false, since: null };
  for (const line of tail(file).reverse()) {
    const event = eventOf(line);
    if (event === null) continue;
    if (IDLE_EVENTS.has(event)) return { idle: true, since };
    if (WORKING_EVENTS.has(event)) return { idle: false, since };
  }
  return { idle: false, since };
}

export interface Proc {
  pid: number;
  ppid: number;
  start: string;
  args: string;
}

export type Stray = { pid: number; start: string };

const LISTENER = /(?:^|\s)(?:\S*\/)?kiwi(?:\s+-{1,2}[\w-]+(?:\s+[^-\s]\S*)?)*\s+(?:hook\s+)?listen(?:\s|$)/;

function processes(): Proc[] {
  const r = runNow(["ps", "-eo", "pid=,ppid=,lstart=,args="], 5_000);
  if (r.status !== 0) return [];
  return r.stdout.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), start: m[3]!, args: m[4]! }] : [];
  });
}

export function isListener(args: string): boolean {
  return LISTENER.test(args);
}

export function listenersUnder(pid: number, procs: readonly Proc[] = processes()): Stray[] {
  const under = new Set([pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of procs) {
      if (!under.has(p.pid) && under.has(p.ppid)) {
        under.add(p.pid);
        grew = true;
      }
    }
  }
  return procs.filter((p) => p.pid !== pid && under.has(p.pid) && isListener(p.args)).map((p) => ({ pid: p.pid, start: p.start }));
}

export const strayKey = (s: Stray) => `${s.pid}@${s.start}`;

export function stopStrays(recorded: ReadonlySet<string>, procs: readonly Proc[] = processes()): number {
  let stopped = 0;
  for (const p of procs) {
    if (!isListener(p.args) || !recorded.has(strayKey(p))) continue;
    try {
      process.kill(p.pid, "SIGTERM");
      stopped++;
    } catch {
      // Gone since the listing (ESRCH) or not this user's process (EPERM): not one of ours to stop.
    }
  }
  return stopped;
}
