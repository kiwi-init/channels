import { createHash, randomBytes } from "node:crypto";
import { basename } from "node:path";
import { omit } from "@kiwi/core/omit.ts";
import { updateConfig, type Config, type SeatRecord } from "./config/file.ts";
import { pidAlive } from "./pid.ts";

export type SeatHarness = NonNullable<SeatRecord["harness"]>;

const HARNESSES: readonly SeatHarness[] = ["claude", "codex", "gemini", "cursor", "grok", "opencode", "kimi", "mimo", "grok-bot", "pi", "zcode"];

export const SEAT_TOKEN = "KIWI_SEAT_TOKEN";

type Env = Record<string, string | undefined>;

export type HeldSession = { harness: Exclude<SeatHarness, "kimi" | "grok-bot">; session: string; pid?: number } | { harness: "kimi"; pid: number; served?: string };

export type HoldChange = { kind: "changed"; seats: number } | { kind: "no-seat" } | { kind: "not-held" } | { kind: "other-holder" };

export type StaleRelease = { kind: "changed"; seats: number } | { kind: "no-seat" } | { kind: "not-held" } | { kind: "alive"; pid: number };

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

function holderGone(hold: NonNullable<SeatRecord["hold"]>): boolean {
  return hold.pid !== undefined && !pidAlive(hold.pid);
}

export function heldAway(b: SeatRecord, env: Env = process.env): boolean {
  return !!b.hold && !holdsSeat(b, env) && !holderGone(b.hold);
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
    if (seats.some((b) => b.hold && b.hold.key !== key && !holderGone(b.hold))) {
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

export function holdSeat(alias: string, as: string, token: string, now = Date.now(), pid?: number): HoldChange {
  const key = keyOf(token);
  return rewrite(alias, as, token, false, (b) => {
    const kept = b.hold?.key === key ? b.hold : undefined;
    return { ...omit(b, "session", "pid", "harnessSession"), hold: { key, at: kept?.at ?? now, ...(pid !== undefined ? { pid } : {}) }, holds: (b.holds ?? 0) + (kept ? 0 : 1) };
  });
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

export function releaseStale(alias: string, as: string, loopRunning: () => number | null = () => null): StaleRelease {
  let outcome: StaleRelease = { kind: "no-seat" };
  updateConfig((cfg) => {
    const held = recordsOf(cfg, alias, as).flatMap((b) => (b.hold ? [b.hold] : []));
    if (!recordsOf(cfg, alias, as).length) return;
    if (!held.length) {
      outcome = { kind: "not-held" };
      return;
    }
    const live = held.find((h) => h.pid !== undefined && pidAlive(h.pid))?.pid ?? (held.some((h) => h.pid === undefined) ? loopRunning() : null);
    if (live !== null) {
      outcome = { kind: "alive", pid: live };
      return;
    }
    const mine = (b: SeatRecord) => b.alias === alias && b.as === as && !!b.hold;
    const count = recordsOf(cfg, alias, as).filter(mine).length;
    cfg.bindings = Object.fromEntries(
      Object.entries(cfg.bindings ?? {}).map(([dir, v]) => [dir, Array.isArray(v) ? v.map((b) => (mine(b) ? omit(b, "hold", "loop") : b)) : mine(v) ? omit(v, "hold", "loop") : v]),
    );
    outcome = { kind: "changed", seats: count };
  });
  return outcome;
}

export function loopFor(name: string, procs: readonly { pid: number; args: string }[], me = process.pid): number | null {
  for (const p of procs) {
    if (p.pid === me) continue;
    const words = p.args.trim().split(/\s+/);
    const kiwi = words.some((w) => basename(w) === "kiwi" || basename(w) === "cli.ts");
    if (!kiwi || !words.includes("loop")) continue;
    const as = words.indexOf("--as");
    if (as < 0 || words[as + 1] === name) return p.pid;
  }
  return null;
}
