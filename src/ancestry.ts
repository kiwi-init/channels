import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

interface ProcInfo {
  ppid: number;
  name: string;
}

type ProcLookup = (pid: number) => ProcInfo | null;

function fromProc(pid: number): ProcInfo | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const open = stat.indexOf("(");
    const close = stat.lastIndexOf(")");
    if (open < 0 || close < open) return null;
    const ppid = Number(stat.slice(close + 2).split(" ")[1]);
    return Number.isInteger(ppid) ? { ppid, name: stat.slice(open + 1, close) } : null;
  } catch {
    return null;
  }
}

function fromPs(pid: number): ProcInfo | null {
  const r = spawnSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 });
  const m = r.status === 0 ? /^\s*(\d+)\s+(.+?)\s*$/.exec(r.stdout) : null;
  return m ? { ppid: Number(m[1]), name: basename(m[2] ?? "") } : null;
}

function procInfo(pid: number): ProcInfo | null {
  return process.platform === "linux" ? fromProc(pid) : fromPs(pid);
}

const HARNESS_PROCESSES: readonly string[] = ["claude", "codex", "opencode", "grok", "gemini", "cursor-agent", "mimo", "kimi-code", "kimi", "zcode-cli", "agy"];

const KIMI_PROCESSES: readonly string[] = ["kimi-code", "kimi"];

const GEMINI_PROCESSES: readonly string[] = ["gemini", "node"];

type ArgsLookup = (pid: number) => readonly string[] | null;

export interface ProcessTree {
  lookup?: ProcLookup;
  args?: ArgsLookup;
  from?: number;
}

function argsFromProc(pid: number): readonly string[] | null {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function argsFromPs(pid: number): readonly string[] | null {
  const r = spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 });
  return r.status === 0 ? r.stdout.trim().split(/\s+/) : null;
}

function procArgs(pid: number): readonly string[] | null {
  return process.platform === "linux" ? argsFromProc(pid) : argsFromPs(pid);
}

type Nearest = { kind: "harness"; pid: number; name: string } | { kind: "pid"; pid: number } | { kind: "unknown" };

function nearestHarness(tree: ProcessTree, mark: number | null, depth = 12, also: readonly string[] = []): Nearest {
  const lookup = tree.lookup ?? procInfo;
  let pid = tree.from ?? process.ppid;
  for (let i = 0; i < depth && pid > 1; i++) {
    if (pid === mark) return { kind: "pid", pid };
    const info = lookup(pid);
    if (!info) return { kind: "unknown" };
    if (HARNESS_PROCESSES.includes(info.name) || also.includes(info.name)) return { kind: "harness", pid, name: info.name };
    pid = info.ppid;
  }
  return { kind: "unknown" };
}

export function kimiCodePid(env: Record<string, string | undefined>, tree: ProcessTree = {}): number | null {
  if (env.TERM !== "dumb" || env.NO_COLOR !== "1") return null;
  return kimiAncestor(tree);
}

export function kimiAncestor(tree: ProcessTree = {}): number | null {
  const near = nearestHarness(tree, null);
  return near.kind === "harness" && KIMI_PROCESSES.includes(near.name) ? near.pid : null;
}

export function geminiAncestor(tree: ProcessTree = {}): number | null {
  const near = nearestHarness(tree, null, 12, GEMINI_PROCESSES);
  return near.kind === "harness" && GEMINI_PROCESSES.includes(near.name) ? near.pid : null;
}

let ownDeepcode: { pid: number | null } | undefined;

export function deepcodeAncestor(tree: ProcessTree = {}, depth = 12): number | null {
  if (tree.lookup || tree.args || tree.from !== undefined) return walkDeepcode(tree, depth);
  ownDeepcode ??= { pid: walkDeepcode(tree, depth) };
  return ownDeepcode.pid;
}

function walkDeepcode(tree: ProcessTree, depth: number): number | null {
  const lookup = tree.lookup ?? procInfo;
  const argv = tree.args ?? (tree.lookup ? () => null : procArgs);
  let pid = tree.from ?? process.ppid;
  for (let i = 0; i < depth && pid > 1; i++) {
    const info = lookup(pid);
    if (!info || HARNESS_PROCESSES.includes(info.name)) return null;
    if ((argv(pid) ?? []).slice(0, 2).some((a) => basename(a) === "deepcode")) return pid;
    pid = info.ppid;
  }
  return null;
}

export function zcodePid(env: Record<string, string | undefined>, tree: ProcessTree = {}): number | null {
  if (!env.ZCODE_RUNTIME_ENV) return null;
  const near = nearestHarness(tree, null);
  return near.kind === "harness" && near.name === "zcode-cli" ? near.pid : null;
}

export function agyHere(env: Record<string, string | undefined>, tree: ProcessTree = {}): { session: string; pid: number | null } | null {
  const session = env.ANTIGRAVITY_CONVERSATION_ID;
  if (env.ANTIGRAVITY_AGENT !== "1" || !session) return null;
  const near = nearestHarness(tree, null);
  if (near.kind !== "harness") return { session, pid: null };
  return near.name === "agy" ? { session, pid: near.pid } : null;
}

export function mimoHere(env: Record<string, string | undefined>, tree: ProcessTree = {}): { pid: number | null } | null {
  if (!env.MIMOCODE) return null;
  const pid = Number(env.MIMOCODE_PID);
  if (!Number.isInteger(pid) || pid <= 1) return env.GROK_SESSION_ID ? null : { pid: null };
  const near = nearestHarness(tree, pid);
  switch (near.kind) {
    case "pid":
    case "unknown":
      return { pid };
    case "harness":
      return near.name === "mimo" ? { pid: near.pid } : null;
  }
}

const OTHER_HARNESS_ENV: readonly string[] = ["CLAUDECODE", "CODEX_THREAD_ID", "GROK_SESSION_ID", "OPENCODE_SESSION_ID", "GEMINI_CLI", "CURSOR_AGENT", "MIMOCODE", "ANTIGRAVITY_AGENT"];

export function piHere(env: Record<string, string | undefined>, tree: ProcessTree = {}): { pid: number | null } | null {
  if (env.PI_CODING_AGENT !== "true") return null;
  const pid = Number(env.KIWI_PI_PID);
  if (!Number.isInteger(pid) || pid <= 1) return OTHER_HARNESS_ENV.some((k) => env[k]) ? null : { pid: null };
  return nearestHarness(tree, pid).kind === "harness" ? null : { pid };
}
