import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Permission } from "@kiwi/core/launch-options.ts";
import { codexTurn } from "../harness.ts";

type Env = Record<string, string | undefined>;

export interface CodexStart {
  bin: string;
  model?: string;
  effort?: string;
  permission?: Permission;
  context?: number;
  prompt: string;
}

export const CODEX_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];
export const CODEX_CONTEXTS = [128_000, 272_000, 400_000, 1_000_000];

const CODEX_PERMISSIONS: Record<Permission, string[]> = {
  default: [],
  "accept-edits": ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"],
  plan: ["--sandbox", "read-only", "--ask-for-approval", "on-request"],
  bypass: ["--dangerously-bypass-approvals-and-sandbox"],
};

export type CodexThread = { thread: string; rollout: string };

const THREAD = /-([0-9a-f]{8})-([0-9a-f]{4})-(7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const CLOCK_MS = 2_000;

export function codexArgv({ bin, model, effort, permission, context, prompt }: CodexStart): string[] {
  return [
    bin,
    ...(model ? ["-m", model] : []),
    ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
    ...(context ? ["-c", `model_context_window=${context}`] : []),
    ...(permission ? CODEX_PERMISSIONS[permission] : []),
    "--",
    prompt,
  ];
}

function codexHome(env: Env): string {
  return env.CODEX_HOME || join(homedir(), ".codex");
}

function dayDir(sessions: string, at: number): string {
  const d = new Date(at);
  return join(sessions, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // No rollout written on that day yet.
    return [];
  }
}

function holds(file: string, nonce: string): boolean {
  try {
    return readFileSync(file, "utf8").includes(nonce);
  } catch {
    // Gone or unreadable between the listing and the read: not this launch's thread.
    return false;
  }
}

export function codexThread(nonce: string, since: number, now = Date.now(), env: Env = process.env): CodexThread | null {
  const sessions = join(codexHome(env), "sessions");
  const dirs = [...new Set([dayDir(sessions, since - CLOCK_MS), dayDir(sessions, now)])];
  for (const dir of dirs) {
    for (const name of names(dir)) {
      const m = THREAD.exec(name);
      if (!m || Number.parseInt(m[1]! + m[2]!, 16) < since - CLOCK_MS) continue;
      const rollout = join(dir, name);
      if (holds(rollout, nonce)) return { thread: `${m[1]}-${m[2]}-${m[3]}`, rollout };
    }
  }
  return null;
}

export function codexIdle(rollout: string): { idle: boolean; since: number | null } {
  const since = statSync(rollout, { throwIfNoEntry: false })?.mtimeMs ?? null;
  return { idle: codexTurn(rollout)?.state === "idle", since };
}
