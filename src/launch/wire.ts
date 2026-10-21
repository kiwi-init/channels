import { isKnownHarness, type KnownHarness } from "@kiwi/core/harnesses.ts";
import { readLaunch } from "@kiwi/core/membership.ts";
import type { Placed } from "../terminals/plugin.ts";
import type { JoinLine } from "@kiwi/core/join-line.ts";

export interface LaunchRequest extends JoinLine {
  harness: KnownHarness;
  folder: string;
  launch?: string;
}

export type Launched =
  | { ok: true; launch: string; placed: Extract<Placed, { ok: true }> }
  | { ok: false; why: "bad-request" | "not-installed" | "no-recipe" | "no-place" | "not-allowed" | "failed"; detail: string };

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function readLaunchRequest(x: Record<string, unknown>): LaunchRequest | null {
  const folder = text(x.folder);
  const code = text(x.code);
  if (!isKnownHarness(x.harness) || !folder || !code) return null;
  const relay = text(x.relay);
  const nick = text(x.nick);
  const persona = text(x.persona);
  if (x.launch !== undefined && !readLaunch(x.launch)) return null;
  const launch = readLaunch(x.launch);
  return { harness: x.harness, folder, code, ...(relay ? { relay } : {}), ...(nick ? { nick } : {}), ...(persona ? { persona } : {}), ...(launch ? { launch } : {}) };
}

const PLACES: readonly string[] = ["rex", "tmux", "terminal"];
const WHYS: readonly string[] = ["bad-request", "not-installed", "no-recipe", "no-place", "not-allowed", "failed"];

export function readLaunched(x: unknown): Launched | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (r.ok === true) {
    const placed = r.placed as Record<string, unknown> | null;
    return text(r.launch) && placed?.ok === true && PLACES.includes(String(placed.place)) ? { ok: true, launch: String(r.launch), placed: placed as Extract<Placed, { ok: true }> } : null;
  }
  return r.ok === false && WHYS.includes(String(r.why)) ? { ok: false, why: r.why as Extract<Launched, { ok: false }>["why"], detail: text(r.detail) ?? "" } : null;
}

export function launchedText(r: Launched): string {
  if (!r.ok) return r.detail;
  const p = r.placed;
  const where = p.place === "rex" ? "a Rex window" : p.place === "tmux" ? `tmux window ${p.window} of session ${p.session} (tmux attach -t ${p.session})` : "a Terminal window";
  return `started in ${where}; it joins with launch ${r.launch}`;
}
