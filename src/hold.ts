import { createHash, randomBytes } from "node:crypto";
import { omit } from "@kiwi/core/omit.ts";
import { updateConfig, type Config, type SeatRecord } from "./config/file.ts";

export type SeatHarness = NonNullable<SeatRecord["harness"]>;

const HARNESSES: readonly SeatHarness[] = ["claude", "codex", "gemini", "cursor", "grok", "opencode", "kimi", "mimo", "grok-bot", "pi"];

export const SEAT_TOKEN = "KIWI_SEAT_TOKEN";

type Env = Record<string, string | undefined>;

export type HeldSession = { harness: Exclude<SeatHarness, "kimi" | "grok-bot">; session: string; pid?: number } | { harness: "kimi"; pid: number; served?: string };

export type HoldChange = { kind: "changed"; seats: number } | { kind: "no-seat" } | { kind: "not-held" } | { kind: "other-holder" };

export function isSeatHarness(v: string | undefined): v is SeatHarness {
  return HARNESSES.some((h) => h === v);
}

export function newSeatToken(): string {
  return randomBytes(32).toString("base64url");
}

function keyOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function holdsSeat(b: SeatRecord, env: Env = process.env): boolean {
  const token = env[SEAT_TOKEN];
  return !!b.hold && !!token && keyOf(token) === b.hold.key;
}

export function heldAway(b: SeatRecord, env: Env = process.env): boolean {
  return !!b.hold && !holdsSeat(b, env);
}

function recordsOf(cfg: Config, alias: string, as: string): SeatRecord[] {
  return Object.values(cfg.bindings ?? {})
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((b) => b.alias === alias && b.as === as);
}

export function seatHeldAway(cfg: Config, alias: string, as: string, env: Env = process.env): boolean {
  return recordsOf(cfg, alias, as).some((b) => heldAway(b, env));
}

export function seatHolds(cfg: Config, alias: string, as: string): number {
  return Math.max(0, ...recordsOf(cfg, alias, as).map((b) => b.holds ?? 0));
}

export function heldText(alias: string, as: string): string {
  return `${as} in ${alias} is held by its loop between sessions: nothing reads its messages or moves its cursor until the loop hands it to a session`;
}

export function handedText(alias: string, as: string): string {
  return `${as} in ${alias} was held by its loop after this process opened it, and may be another session's now: this process reads nothing more for it`;
}

export function seatRefusal(cfg: Config, alias: string, as: string, opened: number, env: Env = process.env): string | null {
  const records = recordsOf(cfg, alias, as);
  if (records.some((b) => heldAway(b, env))) return heldText(alias, as);
  if (!records.some((b) => holdsSeat(b, env)) && seatHolds(cfg, alias, as) !== opened) return handedText(alias, as);
  return null;
}

function rewrite(alias: string, as: string, token: string, held: boolean, next: (b: SeatRecord) => SeatRecord): HoldChange {
  const key = keyOf(token);
  let outcome: HoldChange = { kind: "no-seat" };
  updateConfig((cfg) => {
    const all = Object.values(cfg.bindings ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v]));
    const seats = all.filter((b) => b.alias === alias && b.as === as);
    if (!seats.length) return;
    if (seats.some((b) => b.hold && b.hold.key !== key)) {
      outcome = { kind: "other-holder" };
      return;
    }
    const touched = (b: SeatRecord) => b.alias === alias && b.as === as && (!held || b.hold?.key === key);
    const count = seats.filter(touched).length;
    if (!count) {
      outcome = { kind: "not-held" };
      return;
    }
    cfg.bindings = Object.fromEntries(Object.entries(cfg.bindings ?? {}).map(([dir, v]) => [dir, Array.isArray(v) ? v.map((b) => (touched(b) ? next(b) : b)) : touched(v) ? next(v) : v]));
    outcome = { kind: "changed", seats: count };
  });
  return outcome;
}

export function holdSeat(alias: string, as: string, token: string, now = Date.now()): HoldChange {
  return rewrite(alias, as, token, false, (b) => ({ ...omit(b, "session", "pid", "harnessSession"), hold: { key: keyOf(token), at: b.hold?.at ?? now }, holds: (b.holds ?? 0) + (b.hold ? 0 : 1) }));
}

export function bindHeldSeat(alias: string, as: string, token: string, to: HeldSession, by: "loop" | "person", now = Date.now()): HoldChange {
  const bound =
    to.harness === "kimi"
      ? { harness: to.harness, session: `kimi-pid-${to.pid}`, pid: to.pid, ...(to.served ? { harnessSession: to.served } : {}) }
      : { harness: to.harness, session: to.session, ...(to.pid ? { pid: to.pid } : {}) };
  return rewrite(alias, as, token, true, (b) => ({ ...omit(b, "hold", "session", "pid", "harnessSession", "loop"), ...bound, ...(by === "loop" ? { loop: true } : {}), at: now, seen: now }));
}

export function releaseSeat(alias: string, as: string, token: string): HoldChange {
  return rewrite(alias, as, token, true, (b) => omit(b, "hold", "loop"));
}
