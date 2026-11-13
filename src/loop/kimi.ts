import { names, holds, tailLines } from "./fs.ts";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Permission } from "@kiwi/core/launch-options.ts";
import { kimiHome } from "../kimi-server.ts";
import { processes, tmuxNow, type Proc } from "./tmux.ts";
import { realDir } from "./sqlite.ts";
export { paneText, typeInto, pasteBracketed, clearPane, paneIsOurs, processes, type Proc } from "./tmux.ts";

type Env = Record<string, string | undefined>;

export interface KimiStart {
  bin: string;
  model?: string;
  permission?: Permission;
}

export type KimiScreen = "ready" | "trust" | "starting";

export type KimiSession = { session: string; dir: string };

const CLOCK_MS = 2_000;
const READY = "one will be created on your first message";
const TRUST = "Trust this folder?";
const IDLE_EVENTS = new Set(["turn.ended", "prompt.completed"]);
const WORKING_EVENTS = new Set(["turn.prompt", "step.begin", "llm.request", "tool.call", "tool.result", "task.started"]);

const KIMI_MODES: Record<Permission, string | null> = { default: null, "accept-edits": "--yolo", plan: "--plan", bypass: "--auto" };

export function kimiArgv({ bin, model, permission }: KimiStart): string[] {
  const mode = permission ? KIMI_MODES[permission] : null;
  return [bin, ...(model ? ["-m", model] : []), ...(mode ? [mode] : [])];
}

export function kimiScreen(text: string): KimiScreen {
  if (text.includes(TRUST)) return "trust";
  return text.includes(READY) ? "ready" : "starting";
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
  for (const line of tailLines(file).reverse()) {
    const event = eventOf(line);
    if (event === null) continue;
    if (IDLE_EVENTS.has(event)) return { idle: true, since };
    if (WORKING_EVENTS.has(event)) return { idle: false, since };
  }
  return { idle: false, since };
}

export type Stray = { pid: number; start: string };

const VALUE_FLAGS = new Set(["-c", "--channel", "--as", "--relay", "--timeout", "--thread", "--room", "-n"]);
const TMUX_PASTE_FLAG = [3, 7] as const;

export function isListener(args: string): boolean {
  const words = args.split(/\s+/).filter(Boolean);
  const at = words.findIndex((w) => w === "kiwi" || w.endsWith("/kiwi"));
  if (at < 0) return false;
  const rest: string[] = [];
  for (let i = at + 1; i < words.length; i++) {
    const w = words[i]!;
    if (!w.startsWith("-")) rest.push(w);
    else if (VALUE_FLAGS.has(w)) i++;
    if (rest.length === 2) break;
  }
  return rest[0] === "listen" || rest[0] === "join" || (rest[0] === "hook" && rest[1] === "listen");
}

export function tmuxPastesFlag(version: string): boolean {
  const m = /(\d+)\.(\d+)/.exec(version);
  if (!m) return /\bmaster\b/.test(version);
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > TMUX_PASTE_FLAG[0] || (major === TMUX_PASTE_FLAG[0] && minor >= TMUX_PASTE_FLAG[1]);
}

export function tmuxVersion(socket: string): string {
  return tmuxNow(socket, ["display-message", "-p", "#{version}"])?.trim() ?? "";
}

export function descendantsOf(pid: number, procs: readonly Proc[] = processes()): Proc[] {
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
  return procs.filter((p) => p.pid !== pid && under.has(p.pid));
}

export function listenersUnder(pid: number, procs: readonly Proc[] = processes()): Stray[] {
  return descendantsOf(pid, procs)
    .filter((p) => isListener(p.args))
    .map((p) => ({ pid: p.pid, start: p.start }));
}

export const strayKey = (s: Stray) => `${s.pid}@${s.start}`;

export function stopStrays(recorded: ReadonlySet<string>, procs: readonly Proc[] = processes(), kill: (pid: number) => void = (pid) => process.kill(pid, "SIGTERM")): number {
  let stopped = 0;
  for (const p of procs) {
    if (!isListener(p.args) || !recorded.has(strayKey(p))) continue;
    try {
      kill(p.pid);
      stopped++;
    } catch {
      // Gone since the listing (ESRCH) or not this user's process (EPERM): not one of ours to stop.
    }
  }
  return stopped;
}
