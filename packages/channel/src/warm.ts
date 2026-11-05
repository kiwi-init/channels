import type { RoomsSetting } from "@kiwi/core/client.ts";
import type { JoinRequest, Member } from "@kiwi/core/membership.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { FoldBase, GuardFloor } from "@kiwi/core/state.ts";
import { foldRoster } from "./fold-roster.ts";
import { planReload } from "./history-plan.ts";
import { leanTail } from "./lean.ts";
import type { Marks } from "./receipts.ts";
import { trimmed } from "./trim.ts";

export interface Warm {
  messages: Message[];
  reach: Message[];
  unread: number[];
  roster: Member[];
  requests: JoinRequest[];
  marks: Marks;
  guardFloor: GuardFloor | null;
  roomsFloor: RoomsSetting | null;
  base: FoldBase | null;
}

export const WARM_FULL = 2;
export const WARM_LIGHT = 12;
export const LIGHT = 50;
export const LEAN = 1_600;

const full = new Map<string, Warm>();
const light = new Map<string, Warm>();

export const warmOf = (code: string): Warm | undefined => full.get(code) ?? light.get(code);

export function lighter(w: Warm, now = Date.now()): Warm {
  const base = trimmed(w.messages, foldRoster(w.roster.filter((m) => !m.unverified)), now, w.roomsFloor, w.guardFloor, w.base, LIGHT, 0);
  if (!base) return w;
  return {
    ...w,
    base,
    messages: w.messages.filter((m) => m.seq > base.n),
    unread: w.unread.filter((seq) => seq > base.n),
    reach: leanTail(
      w.reach,
      w.messages.filter((m) => m.seq <= base.n),
      LEAN,
    ),
  };
}

function keepLight(code: string, w: Warm): void {
  light.delete(code);
  light.set(code, w);
  for (const old of light.keys()) {
    if (light.size <= WARM_LIGHT) break;
    light.delete(old);
  }
}

export function keepWarm(code: string, w: Warm, kind: "full" | "light" = "full"): void {
  if (kind === "light") {
    if (!full.has(code)) keepLight(code, w);
    return;
  }
  light.delete(code);
  full.delete(code);
  full.set(code, w);
  for (const [old, was] of full) {
    if (full.size <= WARM_FULL) break;
    full.delete(old);
    keepLight(old, lighter(was));
  }
}

export function dropWarm(code: string): void {
  full.delete(code);
  light.delete(code);
}

/** Where to follow from when this session already holds the window: no cache read, no second verify. */
export function heldWindow(w: Warm | undefined, head: number, limit: number): { since: number; firstSeq: number } | null {
  if (!w?.messages.length) return null;
  const plan = planReload([...w.messages.map((m) => m.seq), ...w.unread], head, limit);
  return plan.keep.length ? { since: plan.since, firstSeq: plan.keep[0]! } : null;
}
