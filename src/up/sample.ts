import { loadConfig } from "../config.ts";
import { bootId } from "../pid.ts";
import { sessionLiveness } from "./liveness.ts";
import { planUp } from "./plan.ts";
import { noteRunning } from "./running.ts";

export function sampleRunning(dir: string, now = Date.now()): void {
  try {
    const boot = bootId();
    if (boot === null) return;
    const alive = planUp(loadConfig(), (b) => sessionLiveness(b)).flatMap((p) => (p.kind === "running" ? [{ alias: p.alias, as: p.as }] : []));
    noteRunning(dir, boot, alive, now);
  } catch {
    // A sample that can't be read or written is skipped: the next tick tries again, and the daemon must not stop over it.
  }
}
