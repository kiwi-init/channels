// What this agent is and has, read from the machine it runs on: the card it shows the channel, so
// people can see who runs where and with what. Only coarse facts: the OS, the CPU, which harness
// runs it, which tools are on PATH, and the git repository and branch it's in. Nothing from files,
// and nothing the person didn't put there.

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { home } from "./config.ts";
import type { Runs } from "./membership.ts";
import type { Card } from "./protocol.ts";

/** Tools worth showing, as the binary that shows each one is here. */
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

/**
 * The variables an agent's harness sets on the commands its agent runs (the same set hooks.ts reads a
 * session from). Not CURSOR_TRACE_ID or CODEX_SANDBOX: a person's own terminal in those apps may carry them.
 */
export const AGENT_COMMAND_ENV = ["CLAUDECODE", "CODEX_THREAD_ID", "GEMINI_CLI", "CURSOR_AGENT", "GROK_SESSION_ID"] as const;

/** Whether an agent is running this command: what keeps admin (and the owner key) away from agents. */
export function inAgentHarness(env: Record<string, string | undefined> = process.env): boolean {
  return AGENT_COMMAND_ENV.some((k) => !!env[k]);
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

// ---------- what runs this agent ----------
//
// A harness tells its shell commands which session they belong to, never which model answers. The
// model is readable where each harness keeps it: Claude Code writes it on every assistant line of the
// session's transcript (its hooks are handed the transcript's path, which noteTranscript keeps for the
// shell), Codex keeps it in its config. KIWI_MODEL (or `kiwi join --model`) says it for any other.

/** Where a hook noted a session's transcript path, for `kiwi join` run from that session's shell. */
function transcriptNote(session: string): string {
  return join(home(), "hook-state", `${encodeURIComponent(session)}.transcript`);
}

/** Keep a session's transcript path (from a hook's input) where its shell commands can find it. */
export function noteTranscript(session: string, path: string): void {
  try {
    mkdirSync(join(home(), "hook-state"), { recursive: true, mode: 0o700 });
    writeFileSync(transcriptNote(session), path, { mode: 0o600 });
  } catch {
    // A note that can't be written costs a `--model` later, nothing more.
  }
}

/** The model a Claude Code transcript last answered with: its newest assistant line names it. */
export function modelInTranscript(file: string): string | undefined {
  let fd: number | undefined;
  try {
    // The tail is enough: the newest assistant message is the model in use now.
    const size = statSync(file).size;
    const n = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(n);
    fd = openSync(file, "r");
    readSync(fd, buf, 0, n, size - n);
    const text = buf.toString("utf8");
    let last: string | undefined;
    // "<synthetic>" marks a message the harness made up itself, not one a model answered.
    for (const m of text.matchAll(/"model":"([^"\\]{1,80})"/g)) if (!m[1]!.startsWith("<")) last = m[1];
    return last;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** A Claude Code session's transcript: what a hook noted, else the file named after the session under its projects folder. */
function claudeTranscript(session: string, env: Record<string, string | undefined>): string | undefined {
  try {
    const noted = readFileSync(transcriptNote(session), "utf8").trim();
    if (noted && existsSync(noted)) return noted;
  } catch {}
  const root = join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
  try {
    for (const d of readdirSync(root)) {
      const f = join(root, d, `${session}.jsonl`);
      if (existsSync(f)) return f;
    }
  } catch {}
  return undefined;
}

/** Codex's model from its config (`model = "…"`): the one its sessions start with. */
function codexModel(env: Record<string, string | undefined>): string | undefined {
  try {
    const m = /^\s*model\s*=\s*"([^"]{1,80})"/m.exec(readFileSync(join(env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"), "utf8"));
    return m?.[1];
  } catch {
    return undefined;
  }
}

/**
 * The model behind this process, where its harness leaves it readable: KIWI_MODEL first (said
 * outright), then Claude Code's transcript for this session, then Codex's config. Undefined when
 * nothing says; `kiwi join` then asks for --model.
 */
export function detectModel(env: Record<string, string | undefined> = process.env): string | undefined {
  const said = env.KIWI_MODEL?.trim();
  if (said) return said.slice(0, 80);
  if (env.CLAUDECODE && env.CLAUDE_CODE_SESSION_ID) {
    const file = claudeTranscript(env.CLAUDE_CODE_SESSION_ID, env);
    return file ? modelInTranscript(file) : undefined;
  }
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX) return codexModel(env);
  return undefined;
}

/**
 * What runs this process, as `kiwi join` declares it: the harness (detected, or `harness` given)
 * and the model (detected, or `model` given). Undefined while either is unknown.
 */
export function detectRuns(env: Record<string, string | undefined> = process.env, given: { harness?: string; model?: string } = {}): Runs | undefined {
  const harness = given.harness?.trim().toLowerCase() || env.KIWI_HARNESS?.trim().toLowerCase() || detectHarness(env);
  const model = given.model?.trim() || detectModel(env);
  return harness && model ? { harness: harness.slice(0, 40), model: model.slice(0, 60) } : undefined;
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
