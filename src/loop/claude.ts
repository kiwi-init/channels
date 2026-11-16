import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  resume?: string;
  prompt: string;
}

const CLAUDE_1M = 1_000_000;

const CLAUDE_MODES: Record<Permission, string | null> = { default: null, "accept-edits": "acceptEdits", plan: "plan", bypass: "bypassPermissions" };

export type ClaudeSession = { sessionId: string; idle: boolean; since: number | null };

export function claudeArgv({ bin, model, effort, permission, context, tools, resume, prompt }: ClaudeStart): string[] {
  const id = model && context === CLAUDE_1M ? `${model}[1m]` : model;
  const mode = permission ? CLAUDE_MODES[permission] : null;
  return [
    bin,
    ...(resume ? ["--resume", resume] : []),
    ...(id ? ["--model", id] : []),
    ...(effort ? ["--effort", effort] : []),
    ...(mode ? ["--permission-mode", mode] : []),
    ...(tools ? ["--allowedTools", tools] : []),
    "--",
    prompt,
  ];
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

const SESSION_ID = /^[\w-]{1,128}$/;

export function claudeTranscriptAt(sessionId: string, env: Env = process.env): number | null {
  if (!SESSION_ID.test(sessionId)) return null;
  const projects = join(claudeDir(env), "projects");
  try {
    const times = readdirSync(projects).flatMap((project) => {
      const file = join(projects, project, `${sessionId}.jsonl`);
      return existsSync(file) ? [statSync(file).mtimeMs] : [];
    });
    return times.length ? Math.max(...times) : null;
  } catch {
    // No projects folder, or a transcript gone between listing and reading: Claude Code has kept none here.
    return null;
  }
}

export function claudeTranscript(sessionId: string, env: Env = process.env): boolean {
  return claudeTranscriptAt(sessionId, env) !== null;
}
