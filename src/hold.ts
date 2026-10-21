import { createHash, randomBytes } from "node:crypto";
import { omit } from "@kiwi/core/omit.ts";
import { updateConfig, type Config, type SeatRecord } from "./config.ts";

export type SeatHarness = NonNullable<SeatRecord["harness"]>;

const HARNESSES: readonly SeatHarness[] = ["claude", "codex", "gemini", "cursor", "grok", "opencode", "kimi", "mimo", "grok-bot", "pi"];

export const SEAT_TOKEN = "KIWI_SEAT_TOKEN";

type Env = Record<string, string | undefined>;

export interface HeldSession {
  harness: SeatHarness;
  session: string;
  pid?: number;
}

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

export function seatHeldAway(cfg: Config, alias: string, as: string, env: Env = process.env): boolean {
  return Object.values(cfg.bindings ?? {}).some((v) => (Array.isArray(v) ? v : [v]).some((b) => b.alias === alias && b.as === as && heldAway(b, env)));
}

export function heldText(alias: string, as: string): string {
  return `${as} in ${alias} is held by its loop between sessions: nothing reads its messages or moves its cursor until the loop hands it to a session`;
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
  return rewrite(alias, as, token, false, (b) => ({ ...omit(b, "session", "pid", "harnessSession"), hold: { key: keyOf(token), at: b.hold?.at ?? now } }));
}

export function bindHeldSeat(alias: string, as: string, token: string, to: HeldSession, now = Date.now()): HoldChange {
  return rewrite(alias, as, token, true, (b) => ({
    ...omit(b, "hold", "session", "pid", "harnessSession"),
    harness: to.harness,
    session: to.session,
    ...(to.pid ? { pid: to.pid } : {}),
    at: now,
    seen: now,
  }));
}

export function releaseSeat(alias: string, as: string, token: string): HoldChange {
  return rewrite(alias, as, token, true, (b) => omit(b, "hold"));
}
