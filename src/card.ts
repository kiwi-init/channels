// What this agent is and has, read from the machine it runs on: the card it shows the channel, so
// work that needs Windows, a GPU or a given repo goes to someone who has it. Only coarse facts:
// the OS, the CPU, which harness runs it, which tools are on PATH, and the git checkout it's in
// (already visible in its claims). Nothing from files, and nothing the person didn't put there.

import { execFileSync } from "node:child_process";
import type { Card, Handoff } from "./protocol.ts";

/** Tools worth routing by, as the binary that shows each one is here. */
const TOOLS: [tag: string, bin: string][] = [
  ["git", "git"],
  ["docker", "docker"],
  ["node", "node"],
  ["bun", "bun"],
  ["deno", "deno"],
  ["python", "python3"],
  ["go", "go"],
  ["rust", "cargo"],
  ["java", "java"],
  ["dotnet", "dotnet"],
  ["swift", "swift"],
  ["xcode", "xcodebuild"],
  ["android", "adb"],
  ["kubectl", "kubectl"],
  ["terraform", "terraform"],
  ["gh", "gh"],
  ["gpu", "nvidia-smi"],
];

/** Tags this file detects; any other tool on a card was said by hand, and stays until said otherwise. */
export const DETECTED_TOOLS = new Set(TOOLS.map(([tag]) => tag));

/**
 * The card to show: what's detected now, plus what was said by hand before (a model, a note, tools it
 * can't detect), unless said again.
 */
export function mergeCard(detected: Card, was: Card | undefined, given: { model?: string; note?: string; tools?: string[] } = {}): Card {
  const kept = (was?.tools ?? []).filter((t) => !DETECTED_TOOLS.has(t));
  const tools = [...new Set([...(detected.tools ?? []), ...kept, ...(given.tools ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)])];
  const model = given.model ?? was?.model;
  const note = given.note ?? was?.note;
  return { ...detected, ...(model ? { model } : {}), ...(tools.length ? { tools } : {}), ...(note ? { note } : {}) };
}

/** The harness running this process, from the markers each one sets for its shell commands. */
export function detectHarness(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.CLAUDECODE) return "claude-code";
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX) return "codex";
  if (env.GEMINI_CLI) return "gemini";
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) return "cursor";
  if (env.GROK_SESSION_ID) return "grok";
  return undefined;
}

function git(args: string[], cwd = process.cwd()): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000 }).trim() || null;
  } catch {
    return null;
  }
}

/** "owner/repo" from a remote URL (https or ssh), or null. */
export function repoName(url: string | null): string | null {
  const m = url && /[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  return m ? m[1]! : null;
}

/** This machine's card, as far as it can tell. */
export function detectCard(env: Record<string, string | undefined> = process.env): Card {
  const os = ({ darwin: "macos", win32: "windows", linux: "linux" } as Record<string, string>)[process.platform] ?? process.platform;
  const tools = TOOLS.filter(([, bin]) => !!Bun.which(bin)).map(([tag]) => tag);
  const repo = repoName(git(["remote", "get-url", "origin"]));
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const harness = detectHarness(env);
  return {
    os,
    arch: process.arch,
    ...(harness ? { harness } : {}),
    ...(tools.length ? { tools } : {}),
    ...(repo ? { repo } : {}),
    ...(branch && branch !== "HEAD" ? { branch } : {}),
  };
}

/** Whether two cards say the same thing (tool order aside). */
export function sameCard(a: Card | undefined, b: Card): boolean {
  if (!a) return false;
  const keys: (keyof Card)[] = ["os", "arch", "harness", "model", "repo", "branch", "note"];
  if (keys.some((k) => (a[k] ?? undefined) !== (b[k] ?? undefined))) return false;
  const ta = [...(a.tools ?? [])].sort().join(",");
  const tb = [...(b.tools ?? [])].map((t) => t.toLowerCase()).sort().join(",");
  return ta === tb;
}

/**
 * Where the work stands in this checkout, for handing it over: the branch, its commit, and the files
 * changed (uncommitted, and committed since it left its upstream). Plus whether the commit is pushed,
 * since the next owner can only fetch what's pushed.
 */
export function handoffHere(cwd = process.cwd()): { handoff: Handoff; pushed: boolean | null } {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const commit = git(["rev-parse", "--short", "HEAD"], cwd);
  const dirty = (git(["status", "--porcelain"], cwd) ?? "").split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);
  const ahead = upstream ? (git(["diff", "--name-only", `${upstream}...HEAD`], cwd) ?? "").split("\n").filter(Boolean) : [];
  const files = [...new Set([...ahead, ...dirty.map((f) => f.split(" -> ").pop()!)])].slice(0, 200);
  const unpushed = upstream ? Number(git(["rev-list", "--count", `${upstream}..HEAD`], cwd) ?? "0") : null;
  return {
    handoff: { ...(branch && branch !== "HEAD" ? { branch } : {}), ...(commit ? { commit } : {}), ...(files.length ? { files } : {}) },
    pushed: commit ? (unpushed === null ? false : unpushed === 0) : null,
  };
}
