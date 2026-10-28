import { readHarnessOptions, type HarnessOptions } from "./launch-options.ts";
import { isWakeVia, type WakeHarness, type WakeVia } from "./wake.ts";

export const KNOWN_HARNESSES = ["claude", "codex", "gemini", "cursor", "grok", "opencode", "kimi", "mimo", "pi"] as const satisfies readonly WakeHarness[];

export type KnownHarness = (typeof KNOWN_HARNESSES)[number];

export interface HarnessRow {
  harness: KnownHarness;
  path: string | null;
  version: string | null;
  start: boolean;
  wake: WakeVia | null;
  why: string | null;
  options: HarnessOptions | null;
}

export const isKnownHarness = (v: unknown): v is KnownHarness => typeof v === "string" && (KNOWN_HARNESSES as readonly string[]).includes(v);

export const HOOK_HARNESSES = [...KNOWN_HARNESSES, "zcode"] as const satisfies readonly WakeHarness[];

export type HookHarness = (typeof HOOK_HARNESSES)[number];

export const isHookHarness = (v: unknown): v is HookHarness => typeof v === "string" && (HOOK_HARNESSES as readonly string[]).includes(v);

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const HOOK_STATES = ["installed", "partial", "outdated", "missing", "off", "absent"] as const;

export type HookState = (typeof HOOK_STATES)[number];

export interface HookRow {
  harness: HookHarness;
  state: HookState;
  text: string;
}

const isHookState = (v: unknown): v is HookState => typeof v === "string" && (HOOK_STATES as readonly string[]).includes(v);

export function readHookRow(x: unknown): HookRow | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!isHookHarness(r.harness) || !isHookState(r.state)) return null;
  return { harness: r.harness, state: r.state, text: text(r.text) ?? r.state };
}

export function readHarnessRow(x: unknown): HarnessRow | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!isKnownHarness(r.harness)) return null;
  return {
    harness: r.harness,
    path: text(r.path),
    version: text(r.version),
    start: r.start === true,
    wake: isWakeVia(r.wake) ? r.wake : null,
    why: text(r.why),
    options: readHarnessOptions(r.options),
  };
}
