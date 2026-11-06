// Read receipts: under your newest message, whether the agents it went to have read it. Agents tell
// the relay how far they've read (a seq, never content: kiwi's listen and hooks do it as they
// hand messages on), the relay passes each mark to every client, and this works out what a message's
// own recipients have read. People don't send marks, so only agents are counted.

import type { Message, ReadMark } from "@kiwi/core/protocol.ts";
import { isPerson, threadMembers, type ChannelState } from "@kiwi/core/state.ts";

/**
 * A mark as this view heard it. One from the snapshot on connect (`snapshot`) says how far that member
 * had read by then, and when it got that far: not when it passed any earlier message.
 */
type Heard = ReadMark & { snapshot?: true };

/** The marks this view has heard for each key, oldest first (each further on than the last). */
export type Marks = Map<string, Heard[]>;

/** How many marks to keep per key: enough to date the messages on screen. */
const KEEP = 50;

/** Add marks heard live, or on connect (`snapshot`); a mark that doesn't move a key forward changes nothing. */
export function addMarks(prev: Marks, marks: readonly ReadMark[], snapshot = false): Marks {
  let next: Marks | null = null;
  for (const r of marks) {
    const list = (next ?? prev).get(r.pk) ?? [];
    if ((list.at(-1)?.seq ?? 0) >= r.seq) continue;
    next ??= new Map(prev);
    next.set(r.pk, [...list, snapshot ? { ...r, snapshot: true as const } : r].slice(-KEEP));
  }
  return next ?? prev;
}

/** Whether `pk` had read up to `seq`, and when, if this view heard the moment (a live mark): null if not yet. */
export function readAt(marks: Marks, pk: string | undefined, seq: number): { at: number | null } | null {
  if (!pk) return null;
  for (const r of marks.get(pk) ?? []) if (r.seq >= seq) return { at: r.snapshot ? null : r.at };
  return null;
}

/**
 * The agents a message went to: the ones it names, else a task's agents for a word in its thread,
 * else every agent. Only agents that were in the channel when it was sent, and never its sender.
 */
export function recipients(m: Message, state: Pick<ChannelState, "members" | "tasks" | "lead">): string[] {
  const named = m.to?.length && !m.to.includes("*") ? m.to : null;
  const base = named ? named : m.task !== undefined && state.tasks.has(m.task) ? threadMembers(state, { kind: "task", task: m.task }) : [...state.members.keys()];
  const at = m.rts ?? m.ts;
  return [...new Set(base)].filter((n) => {
    const who = state.members.get(n);
    return n !== m.from && !!who && who.active && !isPerson(who) && (who.kind as string | undefined) !== "computer" && who.joined <= at;
  });
}

const nickOf = (state: Pick<ChannelState, "members">, name: string): string => state.members.get(name)?.display || name;

/**
 * What sits under a message of yours: "Read 10:42", "Read by atlas, win", "Read by 2 of 5", or "Delivered".
 * Only recipients that have ever sent a mark count (an older kiwi never does, and would read as unread for
 * good); none of them: nothing. A time only when this view heard it happen.
 */
export function receipt(m: Message, state: Pick<ChannelState, "members" | "tasks" | "lead">, marks: Marks, pkOf: (name: string) => string | undefined, time: (ts: number) => string): string | null {
  const to = recipients(m, state).filter((n) => {
    const pk = pkOf(n);
    return !!pk && marks.has(pk);
  });
  if (!to.length) return null;
  const read = to.map((n) => ({ n, r: readAt(marks, pkOf(n), m.seq) })).filter((x): x is { n: string; r: { at: number | null } } => x.r !== null);
  if (!read.length) return "Delivered";
  const times = read.map((x) => x.r.at);
  // Only when every one of them was heard live: otherwise the newest time could be off.
  const when = times.every((t): t is number => t !== null) ? ` ${time(Math.max(...times))}` : "";
  if (to.length === 1) return `Read${when}`;
  if (read.length === to.length) return `Read by everyone${when}`;
  return read.length <= 3 ? `Read by ${read.map((x) => nickOf(state, x.n)).join(", ")}` : `Read by ${read.length} of ${to.length}`;
}

/** What an agent is doing now, as the app shows it: "thinking", "running Bash", and since when. */
export interface Busy {
  text: string;
  since?: number;
}

const ANSWERING = (seq: number): string => `answering #${seq}`;

function lasted(ms: number): string {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? "" : m < 60 ? ` ${m}m` : ` ${Math.floor(m / 60)}h`;
}

/**
 * Who has a message: the agent holding its `kiwi answering` claim, while it lasts, else a recipient that
 * was handed it (a read mark past it) and is busy now. Null once a recipient has replied in its thread.
 */
export function onIt(
  m: Message,
  state: Pick<ChannelState, "members" | "tasks" | "lead" | "facts">,
  marks: Marks,
  pkOf: (name: string) => string | undefined,
  busy: (name: string) => Busy | null,
  replied: (from: readonly string[]) => boolean,
  now: number,
): string | null {
  const to = recipients(m, state);
  if (!to.length || replied(to)) return null;
  const claim = state.facts.get(ANSWERING(m.seq));
  const held = claim && (claim.expires === undefined || claim.expires > now) && to.includes(claim.value) ? claim.value : null;
  const who = held ?? to.find((n) => readAt(marks, pkOf(n), m.seq) !== null && busy(n) !== null);
  if (!who) return null;
  const b = busy(who);
  const name = nickOf(state, who);
  return b ? `${name} is on it · ${b.text}${b.since ? lasted(now - b.since) : ""}` : `${name} is on it`;
}
