import type { DutyNote, OffDuty } from "./types.ts";

export const DUTY_SAID_MAX = 160;

const tickedBoxes = (text: string): Set<string> =>
  new Set(
    text
      .split("\n")
      .filter((line) => /^\s*- \[[xX]\]/.test(line))
      .map((line) => line.replace(/^\s*- \[[xX]\]\s*/, "").trim()),
  );

export function newlyTicked(before: string, after: string): number {
  const was = tickedBoxes(before);
  return [...tickedBoxes(after)].filter((box) => !was.has(box)).length;
}

export function keptOffDuty(left: ReadonlyMap<string, number>, notes: readonly DutyNote[]): OffDuty | null {
  if (!left.size) return null;
  const floor = Math.min(...left.values());
  return { left: [...left], notes: notes.filter((n) => n.seq > floor) };
}
