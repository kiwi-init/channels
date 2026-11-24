import type { Config, SeatRecord } from "../config.ts";
import type { UpOutcome } from "@kiwi/core/up-outcome.ts";
import { holderGone, OLDER_LOOP, type Liveness } from "../hold.ts";
import { printedLine } from "./launch.ts";
import { isLoopHarness, type LoopHarness } from "../loop/recipes.ts";

export interface SeatAt {
  alias: string;
  as: string;
  dir: string;
}

export type SeatPlan =
  | (SeatAt & { kind: "restore"; harness: "claude" })
  | (SeatAt & { kind: "loop"; harness: LoopHarness; staleHold: boolean })
  | (SeatAt & { kind: "running"; why: string })
  | (SeatAt & { kind: "unsupported"; why: string })
  | (SeatAt & { kind: "unknown"; why: string })
  | (SeatAt & { kind: "idle"; why: string; start: Startable })
  | (SeatAt & { kind: "skipped"; why: string; reason: "left" | "unverified" });

export type Startable = Extract<SeatPlan, { kind: "restore" | "loop" }>;

export type Chooser = (p: Startable, b: SeatRecord) => string | null;

export type Membership = { kind: "member" } | { kind: "left" } | { kind: "unverified"; why: string };

type Placed = SeatAt & { record: SeatRecord };

function placed(cfg: Config): Placed[] {
  return Object.entries(cfg.bindings ?? {}).flatMap(([dir, v]) => (Array.isArray(v) ? v : [v]).map((record) => ({ alias: record.alias, as: record.as, dir, record })));
}

function primary(first: Placed, rest: readonly Placed[]): Placed {
  return rest.reduce((best, p) => (best.record.hold ? best : p.record.hold || (p.record.at ?? 0) > (best.record.at ?? 0) ? p : best), first);
}

function planOne(at: SeatAt, b: SeatRecord, live: (b: SeatRecord) => Liveness): SeatPlan {
  if (b.hold && !b.hold.holder) return { ...at, kind: "unknown", why: OLDER_LOOP };
  if (b.hold && !holderGone(b.hold)) return { ...at, kind: "running", why: b.hold.up ? "another kiwi up is starting it" : "its kiwi loop holds it" };
  if (b.hold && !b.hold.up)
    return b.harness && isLoopHarness(b.harness)
      ? { ...at, kind: "loop", harness: b.harness, staleHold: true }
      : { ...at, kind: "unsupported", why: `its loop ran ${b.harness ?? "an unknown harness"}` };
  const state = live(b);
  if (state.kind === "alive") return { ...at, kind: "running", why: "its session is still running" };
  const start = startOf(at, b);
  return state.kind === "unknown" && start.kind !== "unsupported" ? { ...at, kind: "unknown", why: state.why } : start;
}

function startOf(at: SeatAt, b: SeatRecord): SeatPlan {
  if (b.loop)
    return b.harness && isLoopHarness(b.harness)
      ? { ...at, kind: "loop", harness: b.harness, staleHold: false }
      : { ...at, kind: "unsupported", why: `its loop ran ${b.harness ?? "an unknown harness"}` };
  if (b.plain) return { ...at, kind: "unsupported", why: "it was joined from a plain terminal, not an agent's session" };
  if (!b.harness) return { ...at, kind: "unsupported", why: "it records no harness to start" };
  if (b.harness === "claude") return { ...at, kind: "restore", harness: "claude" };
  return { ...at, kind: "unsupported", why: `kiwi up doesn't restore ${b.harness} seats yet: start it yourself in its folder` };
}

export function planUp(cfg: Config, live: (b: SeatRecord) => Liveness, choose: Chooser = () => null): SeatPlan[] {
  const groups = new Map<string, [Placed, ...Placed[]]>();
  for (const p of placed(cfg)) {
    if (!cfg.channels[p.alias]) continue;
    const key = `${p.alias}\u0000${p.as}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.values()].map(([first, ...rest]) => {
    const { record, ...at } = primary(first, rest);
    const plan = planOne(at, record, live);
    if (plan.kind !== "restore" && plan.kind !== "loop") return plan;
    const why = choose(plan, record);
    return why === null ? plan : { alias: plan.alias, as: plan.as, dir: plan.dir, kind: "idle", why, start: plan };
  });
}

const keyOfSeat = (s: { alias: string; as: string }): string => `${s.alias}\u0000${s.as}`;

export const NO_SAMPLE = "kiwi up has no record of which seats ran before this restart (the daemon starts keeping one once this version runs)";

export function runningAtShutdown(seats: readonly { alias: string; as: string }[] | null): Chooser {
  if (seats === null) return () => NO_SAMPLE;
  const ran = new Set(seats.map(keyOfSeat));
  return (p) => (ran.has(keyOfSeat(p)) ? null : "it wasn't running when this computer went down");
}

export function usedSince(after: number, used: (b: SeatRecord) => number): Chooser {
  return (_p, b) => {
    const last = used(b);
    return last >= after ? null : `idle since ${new Date(last).toISOString().slice(0, 10)}`;
  };
}

export function planJson(p: SeatPlan, before: boolean): UpOutcome {
  const at = { channel: p.alias, handle: p.as, folder: p.dir, before };
  switch (p.kind) {
    case "restore":
    case "loop":
      return { ...at, result: "planned", why: printedLine(p) };
    case "running":
      return { ...at, result: "running", why: p.why };
    case "unsupported":
      return { ...at, result: "skipped", why: p.why, skip: "unsupported" };
    case "unknown":
      return { ...at, result: "skipped", why: p.why, skip: "unknown" };
    case "idle":
      return { ...at, result: "skipped", why: `${p.why}; to bring it back: ${printedLine(p.start)}`, skip: "idle" };
    case "skipped":
      return { ...at, result: "skipped", why: p.why, skip: p.reason };
  }
}

export function withMembers(plans: readonly SeatPlan[], member: (alias: string, as: string) => Membership): SeatPlan[] {
  return plans.map((p) => {
    if (p.kind !== "restore" && p.kind !== "loop" && p.kind !== "idle" && p.kind !== "unsupported") return p;
    const m = member(p.alias, p.as);
    if (m.kind === "member") return p;
    return m.kind === "left"
      ? { alias: p.alias, as: p.as, dir: p.dir, kind: "skipped", why: "it left the channel or was removed", reason: "left" }
      : { alias: p.alias, as: p.as, dir: p.dir, kind: "skipped", why: `its membership couldn't be checked: ${m.why}`, reason: "unverified" };
  });
}
