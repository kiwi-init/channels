import type { SeatAt } from "./plan.ts";

type Selector = { kind: "channel"; channel: string; text: string } | { kind: "seat"; channel: string; handle: string; text: string };

export type Selection = { kind: "every" } | { kind: "only"; selectors: readonly [Selector, ...Selector[]] };

function readSelector(text: string): Selector | null {
  const parts = text.split("/");
  if (parts.some((p) => p.trim() !== p || p === "")) return null;
  const [channel, handle, ...more] = parts;
  if (!channel || more.length) return null;
  return handle === undefined ? { kind: "channel", channel, text } : { kind: "seat", channel, handle, text };
}

export function readSelection(given: readonly string[] | undefined): Selection | string {
  if (given === undefined) return { kind: "every" };
  const selectors: Selector[] = [];
  for (const text of given) {
    const s = readSelector(text);
    if (!s) return `--only takes CHANNEL or CHANNEL/HANDLE, not "${text}"`;
    selectors.push(s);
  }
  const [first, ...rest] = selectors;
  return first ? { kind: "only", selectors: [first, ...rest] } : { kind: "every" };
}

const matches = (s: Selector, p: SeatAt): boolean => p.alias === s.channel && (s.kind === "channel" || p.as === s.handle);

export function pickSeats<P extends SeatAt>(plans: readonly P[], selection: Selection): P[] | string {
  if (selection.kind === "every") return [...plans];
  const missing = selection.selectors.filter((s) => !plans.some((p) => matches(s, p)));
  if (missing.length) return `--only ${missing.map((s) => `"${s.text}"`).join(", ")}: no seat on this computer matches, so nothing started`;
  return plans.filter((p) => selection.selectors.some((s) => matches(s, p)));
}
