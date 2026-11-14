import type { Card, Activity, ContextUse } from "@kiwi/core/protocol.ts";

export const SANITIZER_BASE = "c0b633e00ba4df7574377d816b3018d63ce5c24a";

const MAX_TAGS = 40;
const CONTEXT_TOKENS_MAX = 100_000_000;

function contextUse(x: unknown): ContextUse | undefined {
  if (!x || typeof x !== "object") return undefined;
  const r = x as Record<string, unknown>;
  const tokens = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= CONTEXT_TOKENS_MAX ? v : undefined);
  const used = tokens(r.used);
  const window = tokens(r.window);
  return used ? { used, ...(window ? { window } : {}) } : undefined;
}

export function cleanCard(x: unknown): Card | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const line = (v: unknown, max: number) =>
    typeof v === "string"
      ? v
          .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
          .trim()
          .slice(0, max)
      : "";
  const out: Card = {};
  for (const k of ["os", "arch", "harness", "model", "cpu", "memory", "repo", "branch"] as const) {
    const v = line(r[k], 120);
    if (v) out[k] = v;
  }
  const note = line(r.note, 500);
  if (note) out.note = note;
  if (Array.isArray(r.tools)) {
    const tools = r.tools
      .map((t) => line(t, 40))
      .filter(Boolean)
      .slice(0, MAX_TAGS);
    if (tools.length) out.tools = tools;
  }
  return Object.keys(out).length ? out : null;
}

export function cleanActivity(x: unknown): Activity | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (r.state !== "working" && r.state !== "waiting" && r.state !== "idle" && r.state !== "unknown") return null;
  const line = (v: unknown, max: number) =>
    typeof v === "string"
      ? v
          .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
          .trim()
          .slice(0, max)
      : "";
  const tool = r.state === "unknown" ? "" : line(r.tool, 60);
  const model = line(r.model, 120);
  const since = typeof r.since === "number" && Number.isFinite(r.since) ? r.since : undefined;
  const context = contextUse(r.context);
  return { state: r.state, ...(tool ? { tool } : {}), ...(model ? { model } : {}), ...(since ? { since } : {}), ...(context ? { context } : {}) };
}

export function inlineText(s: unknown, max = 120): string {
  if (typeof s !== "string") return "";
  const flat = s
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
