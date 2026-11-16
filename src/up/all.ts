import type { Config, SeatRecord } from "../config.ts";
import { printedLine, seatArgv, type Launcher } from "./launch.ts";
import type { SeatPlan, Startable } from "./plan.ts";
import type { Report } from "./ready.ts";
import { SEAT_TOKEN, type Reservation } from "../hold.ts";

export type Outcome = { plan: SeatPlan; result: "restored" | "running" | "failed" | "skipped"; why: string } | { plan: Startable; result: "printed"; line: string };

export interface UpDeps {
  load: () => Config;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  newId: () => string;
  report: (id: string) => Report | null;
  forget: (id: string) => void;
  token: () => string;
  keyOf: (token: string) => string;
  reserve: (p: Startable, token: string) => Reservation;
  abandon: (p: Startable, token: string) => void;
}

const POLL_MS = 500;

function recordsOf(cfg: Config, p: SeatPlan): SeatRecord[] {
  return Object.values(cfg.bindings ?? {})
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((b) => b.alias === p.alias && b.as === p.as);
}

type Pending = { plan: Startable; at: number; id: string; token: string | null };

function settled(cfg: Config, w: Pending, deps: UpDeps): Outcome | null {
  if (w.plan.kind === "loop") {
    const key = w.token === null ? null : deps.keyOf(w.token);
    const back = recordsOf(cfg, w.plan).some((b) => (b.hold && !b.hold.up && b.hold.key === key) || (b.loop && !b.hold && (b.at ?? 0) >= w.at));
    return back ? { plan: w.plan, result: "restored", why: "its kiwi loop runs again" } : null;
  }
  const r = deps.report(w.id);
  return r ? { plan: w.plan, ...r } : null;
}

export async function upAll(plans: readonly SeatPlan[], launcher: Launcher | null, kiwi: readonly string[], bindSeconds: number, waitMs: number, deps: UpDeps): Promise<Outcome[]> {
  const done = new Map<SeatPlan, Outcome>();
  const pending: Pending[] = [];
  for (const plan of plans) {
    switch (plan.kind) {
      case "running":
        done.set(plan, { plan, result: "running", why: plan.why });
        break;
      case "unsupported":
      case "unknown":
      case "skipped":
        done.set(plan, { plan, result: "skipped", why: plan.why });
        break;
      case "idle":
        done.set(plan, { plan, result: "skipped", why: `${plan.why}; to bring it back: ${printedLine(plan.start)}` });
        break;
      case "restore":
      case "loop": {
        if (!launcher) {
          done.set(plan, { plan, result: "printed", line: printedLine(plan) });
          break;
        }
        const at = deps.now();
        const id = deps.newId();
        const token = plan.kind === "loop" ? deps.token() : null;
        const reserved = token === null ? null : deps.reserve(plan, token);
        if (reserved && reserved.kind !== "held") {
          done.set(
            plan,
            reserved.kind === "running" || reserved.kind === "starting"
              ? { plan, result: "running", why: "another kiwi up or loop has it" }
              : { plan, result: "skipped", why: reserved.kind === "unknown" ? reserved.why : "its seat is gone" },
          );
          break;
        }
        const failed = launcher.open(plan, seatArgv(kiwi, plan, { bindSeconds, report: id }), token === null ? {} : { [SEAT_TOKEN]: token });
        if (failed) {
          if (token !== null) deps.abandon(plan, token);
          done.set(plan, { plan, result: "failed", why: `${launcher.name} didn't open its window: ${failed}` });
        } else pending.push({ plan, at, id, token });
        break;
      }
    }
  }
  const deadline = deps.now() + waitMs;
  let open = pending;
  while (open.length) {
    const cfg = deps.load();
    for (const w of open) {
      const outcome = settled(cfg, w, deps);
      if (outcome) done.set(w.plan, outcome);
    }
    open = open.filter((w) => !done.has(w.plan));
    if (!open.length) break;
    if (deps.now() >= deadline) {
      for (const w of open) if (w.token !== null) deps.abandon(w.plan, w.token);
      for (const w of open)
        done.set(w.plan, { plan: w.plan, result: "failed", why: `it didn't come back within ${Math.round(waitMs / 1000)}s; its ${launcher?.name ?? ""} window (${w.plan.as}) shows why` });
      break;
    }
    await deps.sleep(POLL_MS);
  }
  for (const w of pending) deps.forget(w.id);
  return plans.flatMap((p) => {
    const outcome = done.get(p);
    return outcome ? [outcome] : [];
  });
}

export function outcomeLine(o: Outcome): string {
  const seat = `${o.plan.as} in ${o.plan.alias} (${o.plan.dir})`;
  return o.result === "printed" ? o.line : `${o.result.padEnd(8)} ${seat}: ${o.why}`;
}
