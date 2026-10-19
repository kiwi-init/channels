// What this agent is and has, read from the machine it runs on: the card it shows the channel, so
// people can see who runs where and with what. Only coarse facts: the OS, the CPU and memory, which
// harness runs it (and its model, when given or the harness says), which tools are on PATH, and the
// git repository and branch it's in. Nothing from files, and nothing the person didn't put there.

import { execFileSync } from "node:child_process";
import { cpus, hostname, totalmem } from "node:os";

import { kimiCodePid, mimoHere, piHere, type ProcessTree } from "./ancestry.ts";
import { harnessModel } from "./harness.ts";
import type { Runs } from "@kiwi/core/membership.ts";
import type { Card } from "@kiwi/core/protocol.ts";
import { canonicalHarness, onGrokBot } from "./seats.ts";

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
const DETECTED_TOOLS = new Set(TOOLS.map(([tag]) => tag));

/**
 * The card to show: what's detected now, plus what was said by hand before (a model, a note, tools it
 * can't detect), unless said again.
 */
export function mergeCard(detected: Card, was: Card | undefined, given: { model?: string; note?: string; tools?: string[]; fresh?: number } = {}): Card {
  const kept = (was?.tools ?? []).filter((t) => !DETECTED_TOOLS.has(t));
  const tools = [...new Set([...(detected.tools ?? []), ...kept, ...(given.tools ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)])];
  const model = given.model ?? was?.model;
  const note = given.note ?? was?.note;
  const fresh = given.fresh ?? was?.fresh;
  return { ...detected, ...(model ? { model } : {}), ...(tools.length ? { tools } : {}), ...(note ? { note } : {}), ...(fresh !== undefined ? { fresh } : {}) };
}

/** The harness running this process, from the markers each one sets for its shell commands. */
export function detectHarness(env: Record<string, string | undefined> = process.env, tree: ProcessTree = {}, host: string = hostname()): string | undefined {
  if (piHere(env, tree)) return "pi";
  if (mimoHere(env, tree)) return "mimocode";
  if (kimiCodePid(env, tree)) return "kimi-code";
  if (env.GROK_SESSION_ID) return "grok";
  if (env.CLAUDECODE) return "claude-code";
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX) return "codex";
  if (env.GEMINI_CLI) return "gemini";
  if (onGrokBot({}, host)) return "grok-bot";
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) return "cursor";
  if (env.OPENCODE_SESSION_ID) return "opencode";
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

export type Where = Pick<Card, "repo" | "branch">;

export function detectWhere(cwd = process.cwd()): Where {
  const repo = repoName(git(["remote", "get-url", "origin"], cwd));
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return { ...(repo ? { repo } : {}), ...(branch && branch !== "HEAD" ? { branch } : {}) };
}

export function movedCard(was: Card, where: Where): Card {
  const card: Card = { ...was };
  delete card.repo;
  delete card.branch;
  return { ...card, ...where };
}

/** This machine's card, as far as it can tell. */
export function detectCard(env: Record<string, string | undefined> = process.env): Card {
  const os = ({ darwin: "macos", win32: "windows", linux: "linux" } as Record<string, string>)[process.platform] ?? process.platform;
  const tools = TOOLS.filter(([, bin]) => !!Bun.which(bin)).map(([tag]) => tag);
  const harness = detectHarness(env);
  const cores = cpus();
  const chip = cores[0]?.model.replace(/\s+/g, " ").trim();
  return {
    os,
    arch: process.arch,
    cpu: `${cores.length} cores${chip ? ` · ${chip}` : ""}`,
    memory: `${Math.round(totalmem() / 2 ** 30)} GB`,
    ...(harness ? { harness } : {}),
    ...(tools.length ? { tools } : {}),
    ...detectWhere(),
  };
}

/**
 * The model this agent runs on: KIWI_MODEL when set, else what its harness keeps on this machine
 * (harness.ts). Undefined when it can't be told: `kiwi join` then asks for --model.
 */
export async function detectModel(env: Record<string, string | undefined> = process.env): Promise<string | undefined> {
  const said = env.KIWI_MODEL?.trim();
  return said || (await harnessModel(env)) || (onGrokBot(env) ? "grok-bot" : undefined);
}

/**
 * What runs this process, as `kiwi join` declares it for the owner to sign into its seat: the harness
 * (given, KIWI_HARNESS, or detected) and the model (given, or detectModel). Undefined while either is
 * unknown: a plain terminal names its harness with --harness.
 */
export async function detectRuns(env: Record<string, string | undefined> = process.env, given: { harness?: string; model?: string } = {}): Promise<Runs | undefined> {
  const harness = canonicalHarness(given.harness?.trim().toLowerCase() || env.KIWI_HARNESS?.trim().toLowerCase() || detectHarness(env));
  const model = given.model?.trim() || (await detectModel(env)) || (harness === "grok-bot" ? "grok-bot" : undefined);
  return harness && model ? { harness: harness.slice(0, 40), model: model.slice(0, 60) } : undefined;
}

/** Whether two cards say the same thing (tool order aside). */
export function sameCard(a: Card | undefined, b: Card): boolean {
  if (!a) return false;
  const keys: (keyof Card)[] = ["os", "arch", "harness", "model", "cpu", "memory", "repo", "branch", "note", "fresh"];
  if (keys.some((k) => (a[k] ?? undefined) !== (b[k] ?? undefined))) return false;
  const ta = [...(a.tools ?? [])].sort().join(",");
  const tb = [...(b.tools ?? [])]
    .map((t) => t.toLowerCase())
    .sort()
    .join(",");
  return ta === tb;
}
