import type { NudgeStep } from "../protocol.ts";
import { taskId } from "./tasks.ts";
import type { Task } from "./types.ts";

export const QUIET_MS = 20 * 60_000;
export const QUEUE_MS = 24 * 60 * 60_000;
const NUDGES_KEPT = 12;

type Key = { mover: string; since: number; step: NudgeStep };

export const nudgedAt = (t: Pick<Task, "nudged">, key: Key): boolean => !!t.nudged?.some((n) => n.mover === key.mover && n.since === key.since && n.step === key.step);

export const nudgedUpTo = (t: Pick<Task, "nudged">, mover: string, since: number): number =>
  Math.max(0, ...(t.nudged ?? []).filter((n) => n.mover === mover && n.since === since && n.step > 0).map((n) => n.step));

export function nudgeRefusal(task: Task, key: Key, at: number): string | null {
  const id = taskId(task.id);
  if (task.state === "done") return `${id} is already done`;
  if (key.since > at) return `${id}'s clock can't start after the event that reads it`;
  if (key.step > 0 && at - key.since < key.step * QUIET_MS) return `${id} hasn't been quiet long enough for step ${key.step} of its clock`;
  return null;
}

export function recordNudge(task: Task, key: Key, mark: { seq: number; by: string; at: number }): void {
  if (nudgedAt(task, key)) return;
  task.nudged = [...(task.nudged ?? []), { mover: key.mover, since: key.since, step: key.step, seq: mark.seq, by: mark.by, at: mark.at }].slice(-NUDGES_KEPT);
}
