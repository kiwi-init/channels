import { clockOf, nudgesDue, skipsDue, type NudgeDue } from "@kiwi/core/clock.ts";
import { channelOwner } from "@kiwi/core/mover.ts";
import type { Event } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import { QUIET_MS, UNREAD_MS, wakeSeen } from "@kiwi/core/state/clocks.ts";
import type { Member, Task, Woke } from "@kiwi/core/state/types.ts";
import { spanText } from "@kiwi/core/steps.ts";
import type { DocWakeItem } from "../config/doc-wakes.ts";

type Nudge = Extract<Event, { op: "task.nudge" }>;
type Wake = Extract<Event, { op: "task.wake" }>;

export const clockBlock = (task: number, since: number): string => `clock:T${task}:${since}`;
const toldBlock = (task: number, since: number, step: 2 | 3): string => `${clockBlock(task, since)}:${step}`;
const WAKE_BLOCK = /^clock:T\d+:\d+$/;

function toldItem(task: Task, due: NudgeDue & { step: 2 | 3 }, name: string, wake: string, at: number): DocWakeItem {
  return {
    key: `task:${task.id}`,
    th: "",
    block: toldBlock(task.id, due.since, due.step),
    author: "kiwi",
    text: `T${task.id} is still quiet with ${name} (${wake}), and it is yours to chase`,
    context: "",
    selection: null,
    at,
    clock: { task: task.id, mover: due.mover, since: due.since, told: due.step },
  };
}

export function clockWakeItem(task: Task, mover: string, since: number, quiet: number, at: number): DocWakeItem {
  return {
    key: `task:${task.id}`,
    th: "",
    block: clockBlock(task.id, since),
    author: "kiwi",
    text: `T${task.id} has been quiet ${spanText(quiet)} and it's your move`,
    context: "",
    selection: null,
    at,
    clock: { task: task.id, mover, since },
  };
}

export interface ClockSeat {
  agent: string;
  posts: () => boolean;
  hosts: (name: string) => boolean;
  wakes: () => Promise<boolean>;
  reachable: (name: string) => boolean;
  stateOf: () => Promise<ChannelState | null>;
  nudge: (ev: Nudge, to: string | undefined) => Promise<number | null>;
  got: (ev: Wake) => Promise<void>;
  pending: () => DocWakeItem[];
  told: (block: string) => boolean;
  add: (item: DocWakeItem) => void;
  drop: (blocks: string[]) => void;
  wake: () => void;
}

export interface ClockWatcher {
  look: () => Promise<void>;
  refresh: (delay?: number) => void;
  delivered: () => void;
  holds: (block: string) => boolean;
  stop: () => void;
}

const EVERY_MS = 30_000;
const SOON_MS = 2_000;
const AGAIN_MS = 60_000;

interface Armed {
  block: string;
  task: number;
  mover: string;
  since: number;
}

const keyOf = (d: Pick<NudgeDue, "task" | "since" | "step" | "day">): string => `${d.task}:${d.since}:${d.step}:${d.day ?? ""}`;

function wakeWords(woke: Woke | undefined): string {
  if (!woke) return "no wake attempted";
  return `wake attempted, ${woke.delivered === undefined ? "not delivered" : "delivered"}, ${woke.read === undefined ? "not read" : "read"}`;
}

const human = (m: Member | undefined): string | undefined => m?.sponsor?.user;

function evaluates(state: ChannelState, me: string, mover: string): boolean {
  const mine = state.members.get(me);
  if (!mine?.active) return false;
  const owner = channelOwner(state);
  const parties = [mover, state.lead, owner].filter((n): n is string => !!n);
  if (parties.includes(me)) return true;
  const sponsor = human(mine);
  if (!sponsor) return false;
  return parties.some((n) => human(state.members.get(n)) === sponsor);
}

export function watchClock(seat: ClockSeat, now: () => number = Date.now, every: number = EVERY_MS): ClockWatcher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let again = false;
  let ended = false;
  let armed: Armed | null = null;
  let reached: Armed | null = null;
  const tried = new Set<string>();
  const sent = new Map<string, number>();

  const schedule = (delay: number): void => {
    if (timer || ended) return;
    timer = setTimeout(() => {
      timer = null;
      void look().catch(() => {});
    }, delay);
  };

  const current = (state: ChannelState, item: DocWakeItem, at: number): boolean => {
    const t = item.clock ? state.tasks.get(item.clock.task) : undefined;
    const clock = t ? clockOf(state, t, at) : undefined;
    return !!clock && clock.epoch === item.clock?.since && (item.clock.told !== undefined || clock.mover === seat.agent);
  };

  const sweep = (state: ChannelState, at: number): void => {
    const stale = seat
      .pending()
      .filter((w) => w.clock && !current(state, w, at))
      .map((w) => w.block);
    if (!stale.length) return;
    if (armed && stale.includes(armed.block)) armed = null;
    if (reached && stale.includes(reached.block)) reached = null;
    seat.drop(stale);
  };

  const receipts = async (state: ChannelState, at: number): Promise<void> => {
    const got = reached;
    reached = null;
    if (got) await seat.got({ op: "task.wake", task: got.task, mover: got.mover, since: got.since, got: "delivered" });
    for (const t of state.tasks.values()) {
      const clock = clockOf(state, t, at);
      const woke = clock?.woke;
      if (!clock || !woke || woke.by !== seat.agent || clock.mover !== seat.agent || woke.read !== undefined) continue;
      if (!seat.told(clockBlock(t.id, clock.epoch))) continue;
      if (armed?.block === clockBlock(t.id, clock.epoch)) armed = null;
      if (woke.delivered === undefined && got?.block !== clockBlock(t.id, clock.epoch)) await seat.got({ op: "task.wake", task: t.id, mover: clock.party, since: clock.epoch, got: "delivered" });
      await seat.got({ op: "task.wake", task: t.id, mover: clock.party, since: clock.epoch, got: "read" });
    }
  };

  const attempt = async (state: ChannelState, due: NudgeDue, at: number): Promise<void> => {
    const key = keyOf(due);
    if (tried.has(key)) return;
    if (!(await seat.wakes())) return;
    tried.add(key);
    const seq = await seat.nudge({ op: "task.nudge", task: due.task, mover: due.mover, since: due.since, step: 1 }, undefined);
    if (seq === null || ended) return;
    const after = await seat.stateOf();
    const t = after?.tasks.get(due.task);
    const clock = after && t ? clockOf(after, t, now()) : undefined;
    if (!t || !clock || clock.epoch !== due.since || clock.woke?.seq !== seq || clock.mover !== seat.agent) return;
    const item = clockWakeItem(t, due.mover, due.since, clock.quiet, at);
    armed = { block: item.block, task: t.id, mover: due.mover, since: due.since };
    seat.add(item);
    seat.wake();
  };

  const skipsNow = async (state: ChannelState, due: NudgeDue, at: number): Promise<boolean> => {
    if (due.wake !== "none") return true;
    const t = state.tasks.get(due.task);
    const clock = t ? clockOf(state, t, at) : undefined;
    if (!clock) return false;
    if (clock.mover === seat.agent) return !(await seat.wakes());
    if (clock.quiet >= QUIET_MS + UNREAD_MS) return true;
    return !seat.hosts(clock.mover) && !seat.reachable(clock.mover);
  };

  const moverOf = (state: ChannelState, due: NudgeDue, at: number): string => {
    const t = state.tasks.get(due.task);
    return (t ? clockOf(state, t, at)?.mover : undefined) ?? due.mover;
  };

  const tell = async (state: ChannelState, due: NudgeDue, at: number): Promise<void> => {
    const key = keyOf(due);
    if (at - (sent.get(key) ?? -AGAIN_MS) < AGAIN_MS) return;
    const t = state.tasks.get(due.task);
    const clock = t ? clockOf(state, t, at) : undefined;
    const label = due.step === 2 ? (due.wake ?? wakeSeen(clock?.woke)) : undefined;
    sent.set(key, at);
    if (t && clock && due.to === seat.agent && (due.step === 2 || due.step === 3)) {
      seat.add(toldItem(t, { ...due, step: due.step }, clock.mover, wakeWords(clock.woke), at));
      seat.wake();
    }
    await seat.nudge(
      { op: "task.nudge", task: due.task, mover: due.mover, since: due.since, step: due.step, ...(due.day !== undefined ? { day: due.day } : {}), ...(label ? { wake: label } : {}) },
      due.to,
    );
  };

  const look = async (): Promise<void> => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const state = await seat.stateOf();
      if (!state || ended) return;
      const at = now();
      sweep(state, at);
      await receipts(state, at);
      const due = nudgesDue(state, at);
      const live = new Set<string>();
      for (const d of due) {
        if (d.step === 1) {
          if (d.to === seat.agent) await attempt(state, d, at);
          continue;
        }
        live.add(keyOf(d));
        if (seat.posts() && evaluates(state, seat.agent, moverOf(state, d, at))) await tell(state, d, at);
      }
      for (const d of skipsDue(state, at)) {
        live.add(keyOf(d));
        const mover = moverOf(state, d, at);
        if (mover !== seat.agent && !(seat.posts() && evaluates(state, seat.agent, mover))) continue;
        if (await skipsNow(state, d, at)) await tell(state, d, at);
      }
      for (const key of sent.keys()) if (!live.has(key)) sent.delete(key);
    } finally {
      busy = false;
      if (!ended) schedule(again ? SOON_MS : every);
      again = false;
    }
  };

  return {
    look,
    refresh: (delay = SOON_MS) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      schedule(delay);
    },
    delivered: () => {
      if (!armed) return;
      reached = armed;
      armed = null;
      if (timer) clearTimeout(timer);
      timer = null;
      schedule(0);
    },
    holds: (block) => WAKE_BLOCK.test(block) && block !== armed?.block,
    stop: () => {
      ended = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
