import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Permission } from "@kiwi/core/launch-options.ts";

type Env = Record<string, string | undefined>;

export interface ClaudeStart {
  bin: string;
  model?: string;
  effort?: string;
  permission?: Permission;
  context?: number;
  tools?: string;
  prompt: string;
}

export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const CLAUDE_1M = 1_000_000;

const CLAUDE_MODES: Record<Permission, string | null> = { default: null, "accept-edits": "acceptEdits", plan: "plan", bypass: "bypassPermissions" };
const LONG_CONTEXT = /^(?:opus|sonnet|fable|opusplan)$|^claude-(?:opus|sonnet|fable)-/;

export type ClaudeSession = { sessionId: string; idle: boolean; since: number | null };

export function claudeContextRefusal(model: string | undefined, context: number | undefined): string | null {
  if (context === undefined || (model && LONG_CONTEXT.test(model))) return null;
  return "Claude Code's 1M context needs an Opus, Sonnet or Fable model: add --model opus, sonnet, fable or a full id";
}

export function claudeArgv({ bin, model, effort, permission, context, tools, prompt }: ClaudeStart): string[] {
  const id = model && context === CLAUDE_1M ? `${model}[1m]` : model;
  const mode = permission ? CLAUDE_MODES[permission] : null;
  return [bin, ...(id ? ["--model", id] : []), ...(effort ? ["--effort", effort] : []), ...(mode ? ["--permission-mode", mode] : []), ...(tools ? ["--allowedTools", tools] : []), "--", prompt];
}

function claudeDir(env: Env): string {
  return env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

export function claudeSession(pid: number, env: Env = process.env): ClaudeSession | null {
  const file = join(claudeDir(env), "sessions", `${pid}.json`);
  if (!existsSync(file)) return null;
  try {
    const r: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof r !== "object" || r === null || !("sessionId" in r) || typeof r.sessionId !== "string" || !r.sessionId) return null;
    const status = "status" in r && typeof r.status === "string" ? r.status : "";
    const since = "statusUpdatedAt" in r && typeof r.statusUpdatedAt === "number" ? r.statusUpdatedAt : null;
    return { sessionId: r.sessionId, idle: status === "idle", since };
  } catch {
    // Claude Code rewrites the file in place; a half-written one reads as not there yet.
    return null;
  }
}
