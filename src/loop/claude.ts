import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export interface ClaudeStart {
  bin: string;
  model?: string;
  effort?: string;
  prompt: string;
}

export type ClaudeSession = { sessionId: string; idle: boolean; since: number | null };

export function claudeArgv({ bin, model, effort, prompt }: ClaudeStart): string[] {
  return [bin, ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), "--", prompt];
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
