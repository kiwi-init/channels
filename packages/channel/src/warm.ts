import type { RoomsSetting } from "@kiwi/core/client.ts";
import type { JoinRequest, Member } from "@kiwi/core/membership.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState, FoldBase, GuardFloor } from "@kiwi/core/state.ts";
import { planReload } from "./history-plan.ts";
import type { Marks } from "@kiwi/core/receipts.ts";

export interface Folded {
  state: ChannelState;
  messages: Message[];
  roster: Member[];
  guardFloor: GuardFloor | null;
  roomsFloor: RoomsSetting | null;
  base: FoldBase | null;
  until: number | null;
}

export const foldedFor = (w: Warm | undefined, now: number): Folded | null => {
  const f = w?.folded;
  if (!w || !f) return null;
  const same = f.messages === w.messages && f.roster === w.roster && f.guardFloor === w.guardFloor && f.roomsFloor === w.roomsFloor && f.base === w.base;
  return same && (f.until === null || now < f.until) ? f : null;
};

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
  partial: boolean;
  folded?: Folded | undefined;
}

export const WARM_FULL = 2;
export const WARM_LIGHT = 12;
export const LIGHT = 50;
export const LEAN = 1_600;

const full = new Map<string, Warm>();
const light = new Map<string, Warm>();

export const warmOf = (code: string): Warm | undefined => full.get(code) ?? light.get(code);

let lean: typeof import("./lean.ts") | null = null;

export const leanNow = (): typeof import("./lean.ts") | null => lean;

export const leanLoaded = (): Promise<typeof import("./lean.ts")> => import("./lean.ts").then((m) => (lean = m));

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
    const ready = leanNow();
    if (ready) keepLight(old, ready.lighter(was));
    else
      void leanLoaded().then((l) => {
        if (!full.has(old)) keepLight(old, l.lighter(was));
      });
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
