import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Permission } from "@kiwi/core/launch-options.ts";

type Env = Record<string, string | undefined>;

export interface GrokStart {
  bin: string;
  model?: string;
  effort?: string;
  permission?: Permission;
  prompt: string;
}

export const GROK_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const GROK_MODES: Record<Permission, string | null> = { default: null, "accept-edits": "acceptEdits", plan: "plan", bypass: "bypassPermissions" };

export type GrokSession = { session: string; dir: string };

const SESSION = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK_MS = 2_000;
const TAIL_BYTES = 64 * 1024;
const WORKING = new Set(["tool_call", "tool_call_update", "agent_thought_chunk", "agent_message_chunk", "user_message_chunk", "plan"]);

export function grokArgv({ bin, model, effort, permission, prompt }: GrokStart): string[] {
  const mode = permission ? GROK_MODES[permission] : null;
  return [bin, ...(model ? ["-m", model] : []), ...(effort ? ["--reasoning-effort", effort] : []), ...(mode ? ["--permission-mode", mode] : []), "--", prompt];
}

function sessionsOf(cwd: string, env: Env): string {
  return join(env.GROK_HOME || join(homedir(), ".grok"), "sessions", encodeURIComponent(cwd));
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // No Grok session in this folder yet.
    return [];
  }
}

function holds(file: string, nonce: string): boolean {
  try {
    return readFileSync(file, "utf8").includes(nonce);
  } catch {
    // Not written yet, or gone between the listing and the read.
    return false;
  }
}

export function grokSession(nonce: string, since: number, cwd: string = process.cwd(), env: Env = process.env): GrokSession | null {
  const root = sessionsOf(cwd, env);
  for (const name of names(root)) {
    const m = SESSION.exec(name);
    if (!m || Number.parseInt(m[1]! + m[2]!, 16) < since - CLOCK_MS) continue;
    const dir = join(root, name);
    if (holds(join(dir, "chat_history.jsonl"), nonce) || holds(join(dir, "updates.jsonl"), nonce)) return { session: name, dir };
  }
  return null;
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
    // No update stream yet: nothing to read a turn from.
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function updateOf(line: string): { kind: string; event?: string } | null {
  try {
    const l: unknown = JSON.parse(line);
    const params = typeof l === "object" && l !== null && "params" in l ? l.params : null;
    const update = typeof params === "object" && params !== null && "update" in params ? params.update : null;
    if (typeof update !== "object" || update === null || !("sessionUpdate" in update) || typeof update.sessionUpdate !== "string") return null;
    const event = "event_name" in update && typeof update.event_name === "string" ? update.event_name : undefined;
    return { kind: update.sessionUpdate, ...(event ? { event } : {}) };
  } catch {
    // A line cut by the tail's start, or one still being written.
    return null;
  }
}

export function grokIdle(dir: string): { idle: boolean; since: number | null } {
  const file = join(dir, "updates.jsonl");
  const since = statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? null;
  for (const line of tail(file).reverse()) {
    const u = updateOf(line);
    if (!u) continue;
    if (u.kind === "turn_completed" || (u.kind === "hook_execution" && u.event === "stop")) return { idle: true, since };
    if (WORKING.has(u.kind)) return { idle: false, since };
  }
  return { idle: false, since };
}
