import { isWakeVia, type WakeHarness, type WakeVia } from "./wake.ts";

export const KNOWN_HARNESSES = ["claude", "codex", "gemini", "cursor", "grok", "opencode", "kimi", "mimo", "pi"] as const satisfies readonly WakeHarness[];

export type KnownHarness = (typeof KNOWN_HARNESSES)[number];

export interface HarnessRow {
  harness: KnownHarness;
  path: string | null;
  version: string | null;
  wake: WakeVia | null;
  why: string | null;
}

const isKnown = (v: unknown): v is KnownHarness => typeof v === "string" && (KNOWN_HARNESSES as readonly string[]).includes(v);

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function readHarnessRow(x: unknown): HarnessRow | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!isKnown(r.harness)) return null;
  return { harness: r.harness, path: text(r.path), version: text(r.version), wake: isWakeVia(r.wake) ? r.wake : null, why: text(r.why) };
}
