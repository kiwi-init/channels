import { createHash, randomBytes } from "node:crypto";
import { omit } from "@kiwi/core/omit.ts";
import { updateConfig, type Config, type SeatRecord } from "./config/file.ts";
import { pidAlive, processStart } from "./pid.ts";

export type SeatHarness = NonNullable<SeatRecord["harness"]>;

const HARNESSES: readonly SeatHarness[] = ["claude", "codex", "gemini", "cursor", "grok", "opencode", "kimi", "mimo", "grok-bot", "pi", "zcode", "agy"];

export const SEAT_TOKEN = "KIWI_SEAT_TOKEN";

type Env = Record<string, string | undefined>;

export type HeldSession = { harness: Exclude<SeatHarness, "kimi" | "grok-bot">; session: string; pid?: number } | { harness: "kimi"; pid: number; served?: string };

export type HoldChange = { kind: "changed"; seats: number } | { kind: "no-seat" } | { kind: "not-held" } | { kind: "other-holder" };

export type StaleRelease = { kind: "changed"; seats: number } | { kind: "no-seat" } | { kind: "not-held" } | { kind: "alive"; pid: number } | { kind: "unknown" };

export function isSeatHarness(v: string | undefined): v is SeatHarness {
  return HARNESSES.some((h) => h === v);
}

export function newSeatToken(): string {
  return randomBytes(32).toString("base64url");
}

export function keyOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function holdsSeat(b: SeatRecord, env: Env = process.env): boolean {
  const token = env[SEAT_TOKEN];
  return !!b.hold && !!token && keyOf(token) === b.hold.key;
}

type Hold = NonNullable<SeatRecord["hold"]>;

export function holderGone(hold: Hold): boolean {
  if (!hold.holder) return false;
  if (!pidAlive(hold.holder.pid)) return true;
  const started = processStart(hold.holder.pid);
  return started !== null && started !== hold.holder.started;
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
  const started = pid === undefined ? null : processStart(pid);
  const holder = pid !== undefined && started !== null ? { holder: { pid, started } } : {};
  return rewrite(alias, as, token, false, (b) => {
    const kept = b.hold?.key === key ? b.hold : undefined;
    return { ...omit(b, "session", "pid", "harnessSession", "started", "upKey"), hold: { key, at: kept?.at ?? now, ...holder }, holds: (b.holds ?? 0) + (kept ? 0 : 1) };
  });
}

export function bindHeldSeat(alias: string, as: string, token: string, to: HeldSession, by: "loop" | "person", now = Date.now()): HoldChange {
  const bound =
    to.harness === "kimi"
      ? { harness: to.harness, session: `kimi-pid-${to.pid}`, pid: to.pid, ...(to.served ? { harnessSession: to.served } : {}) }
      : { harness: to.harness, session: to.session, ...(to.pid ? { pid: to.pid } : {}) };
  return rewrite(alias, as, token, true, (b) => ({
    ...omit(b, "hold", "session", "pid", "harnessSession", "loop", "started", "upKey"),
    ...bound,
    ...(by === "loop" ? { loop: true } : {}),
    at: now,
    seen: now,
  }));
}

export function releaseSeat(alias: string, as: string, token: string): HoldChange {
  return rewrite(alias, as, token, true, (b) => omit(b, "hold", "loop"));
}

export function releaseStale(alias: string, as: string, force = false): StaleRelease {
  let outcome: StaleRelease = { kind: "no-seat" };
  updateConfig((cfg) => {
    const records = recordsOf(cfg, alias, as);
    if (!records.length) return;
    const held = records.flatMap((b) => (b.hold ? [b.hold] : []));
    if (!held.length) {
      outcome = { kind: "not-held" };
      return;
    }
    const live = held.find((h) => h.holder && !holderGone(h));
    if (live?.holder) {
      outcome = { kind: "alive", pid: live.holder.pid };
      return;
    }
    if (!force && held.some((h) => !h.holder)) {
      outcome = { kind: "unknown" };
      return;
    }
    const mine = (b: SeatRecord) => b.alias === alias && b.as === as && !!b.hold;
    cfg.bindings = Object.fromEntries(
      Object.entries(cfg.bindings ?? {}).map(([dir, v]) => [dir, Array.isArray(v) ? v.map((b) => (mine(b) ? omit(b, "hold", "loop") : b)) : mine(v) ? omit(v, "hold", "loop") : v]),
    );
    outcome = { kind: "changed", seats: held.length };
  });
  return outcome;
}

export const UP_LAUNCH = "KIWI_UP";

export function upLaunch(env: Env = process.env): string | null {
  const token = env[SEAT_TOKEN];
  return env[UP_LAUNCH] === "1" && token ? keyOf(token) : null;
}

export type Liveness = { kind: "alive" } | { kind: "dead" } | { kind: "unknown"; why: string };

export interface PlacedSeat {
  dir: string;
  record: SeatRecord;
}

export type Reservation =
  | { kind: "held"; prior: PlacedSeat[] }
  | { kind: "no-seat" }
  | { kind: "running"; session: string | null }
  | { kind: "starting"; up: boolean }
  | { kind: "unknown"; why: string };

const listOf = (v: SeatRecord | SeatRecord[] | undefined): SeatRecord[] => (Array.isArray(v) ? v : v ? [v] : []);

function placedOf(cfg: Config, alias: string, as: string): PlacedSeat[] {
  return Object.entries(cfg.bindings ?? {}).flatMap(([dir, v]) => listOf(v).flatMap((record) => (record.alias === alias && record.as === as ? [{ dir, record }] : [])));
}

export const OLDER_LOOP = "it's held by a loop from an older Kiwi, which records no process: check no kiwi loop runs for it, then kiwi seat release --stale --force";

export function reserveSeat(alias: string, as: string, token: string, live: (b: SeatRecord) => Liveness, now = Date.now(), pid = process.pid): Reservation {
  const key = keyOf(token);
  const started = processStart(pid);
  if (started === null) return { kind: "unknown", why: "kiwi up couldn't read its own process's start time, so no later run could tell whether it still runs" };
  let outcome: Reservation = { kind: "no-seat" };
  updateConfig((cfg) => {
    const prior = placedOf(cfg, alias, as);
    if (!prior.length) return;
    const held = prior.find(({ record }) => record.hold && !holderGone(record.hold))?.record.hold;
    if (held) {
      outcome = held.holder ? { kind: "starting", up: !!held.up } : { kind: "unknown", why: OLDER_LOOP };
      return;
    }
    for (const { record } of prior) {
      const state = live(record);
      if (state.kind === "alive") {
        outcome = { kind: "running", session: record.session ?? null };
        return;
      }
      if (state.kind === "unknown") {
        outcome = state;
        return;
      }
    }
    const hold = { key, at: now, holder: { pid, started }, up: true as const };
    const ours = (b: SeatRecord) => b.alias === alias && b.as === as;
    cfg.bindings = Object.fromEntries(
      Object.entries(cfg.bindings ?? {}).map(([dir, v]) => [
        dir,
        Array.isArray(v) ? v.map((b) => (ours(b) ? { ...b, hold, holds: (b.holds ?? 0) + 1 } : b)) : ours(v) ? { ...v, hold, holds: (v.holds ?? 0) + 1 } : v,
      ]),
    );
    outcome = { kind: "held", prior };
  });
  return outcome;
}

export function bindReserved(alias: string, as: string, token: string, to: { harness: SeatHarness; session: string; pid: number }, now = Date.now()): HoldChange {
  const started = processStart(to.pid);
  const key = keyOf(token);
  return rewrite(alias, as, token, true, (b) => ({
    ...omit(b, "hold", "session", "pid", "harnessSession", "loop", "started", "upKey"),
    harness: to.harness,
    session: to.session,
    pid: to.pid,
    ...(started !== null ? { started } : {}),
    upKey: key,
    at: now,
    seen: now,
  }));
}

export const UP_LOOP = "KIWI_UP_LOOP";

export function adoptReserved(alias: string, as: string, token: string, now = Date.now(), pid = process.pid): HoldChange {
  const key = keyOf(token);
  const started = processStart(pid);
  let outcome: HoldChange = { kind: "not-held" };
  if (started === null) return outcome;
  updateConfig((cfg) => {
    const ours = (b: SeatRecord) => b.alias === alias && b.as === as && b.hold?.key === key && !!b.hold.up;
    const count = placedOf(cfg, alias, as).filter(({ record }) => ours(record)).length;
    if (!count) return;
    const adopt = (b: SeatRecord): SeatRecord => (ours(b) ? { ...omit(b, "session", "pid", "harnessSession", "started", "upKey"), hold: { key, at: b.hold?.at ?? now, holder: { pid, started } } } : b);
    cfg.bindings = Object.fromEntries(Object.entries(cfg.bindings ?? {}).map(([dir, v]) => [dir, Array.isArray(v) ? v.map(adopt) : adopt(v)]));
    outcome = { kind: "changed", seats: count };
  });
  return outcome;
}

export function abandonReserved(alias: string, as: string, token: string): HoldChange {
  return rewrite(alias, as, token, true, (b) => (b.hold?.up ? omit(b, "hold") : b));
}

export function unbindReserved(alias: string, as: string, token: string, prior: readonly PlacedSeat[]): number {
  const key = keyOf(token);
  let restored = 0;
  updateConfig((cfg) => {
    for (const { dir, record } of prior) {
      const at = listOf(cfg.bindings?.[dir]);
      const i = at.findIndex((b) => b.alias === alias && b.as === as && b.upKey === key);
      if (i < 0) continue;
      const kept = at.map((b, j) => (j === i ? omit(record, "hold") : b));
      cfg.bindings = { ...cfg.bindings, [dir]: kept.length === 1 ? omit(record, "hold") : kept };
      restored++;
    }
  });
  return restored;
}
