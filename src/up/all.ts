import type { Config, SeatRecord } from "../config.ts";
import { printedLine, seatArgv, type Launcher } from "./launch.ts";
import type { SeatPlan, Startable } from "./plan.ts";

export type Outcome = { plan: SeatPlan; result: "restored" | "running" | "failed" | "skipped"; why: string } | { plan: Startable; result: "printed"; line: string };

export interface UpDeps {
  load: () => Config;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const POLL_MS = 500;

function recordsOf(cfg: Config, p: SeatPlan): SeatRecord[] {
  return Object.values(cfg.bindings ?? {})
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((b) => b.alias === p.alias && b.as === p.as);
}

type Pending = { plan: Startable; at: number; sawHold: boolean };

function settled(cfg: Config, w: Pending): Outcome | null {
  const records = recordsOf(cfg, w.plan);
  if (w.plan.kind === "loop") {
    const back = records.some((b) => (b.hold && !b.hold.up && b.hold.at >= w.at) || (b.loop && !b.hold && (b.at ?? 0) >= w.at));
    return back ? { plan: w.plan, result: "restored", why: "its kiwi loop runs again" } : null;
  }
  if (records.some((b) => b.upKey && !b.hold && (b.at ?? 0) >= w.at)) return { plan: w.plan, result: "restored", why: "its session took the seat" };
  if (records.some((b) => b.hold?.up)) {
    w.sawHold = true;
    return null;
  }
  return w.sawHold ? { plan: w.plan, result: "failed", why: `its session didn't take the seat; its tmux window (${w.plan.as}) shows why` } : null;
}

export async function upAll(plans: readonly SeatPlan[], launcher: Launcher | null, kiwi: readonly string[], waitMs: number, deps: UpDeps): Promise<Outcome[]> {
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
        const failed = launcher.open(plan, seatArgv(kiwi, plan));
        if (failed) done.set(plan, { plan, result: "failed", why: `${launcher.name} didn't open its window: ${failed}` });
        else pending.push({ plan, at, sawHold: false });
        break;
      }
    }
  }
  const deadline = deps.now() + waitMs;
  let open = pending;
  while (open.length) {
    const cfg = deps.load();
    for (const w of open) {
      const outcome = settled(cfg, w);
      if (outcome) done.set(w.plan, outcome);
    }
    open = open.filter((w) => !done.has(w.plan));
    if (!open.length) break;
    if (deps.now() >= deadline) {
      for (const w of open)
        done.set(w.plan, { plan: w.plan, result: "failed", why: `it didn't come back within ${Math.round(waitMs / 1000)}s; its ${launcher?.name ?? ""} window (${w.plan.as}) shows why` });
      break;
    }
    await deps.sleep(POLL_MS);
  }
  return plans.flatMap((p) => {
    const outcome = done.get(p);
    return outcome ? [outcome] : [];
  });
}

export function outcomeLine(o: Outcome): string {
  const seat = `${o.plan.as} in ${o.plan.alias} (${o.plan.dir})`;
  return o.result === "printed" ? o.line : `${o.result.padEnd(8)} ${seat}: ${o.why}`;
}
