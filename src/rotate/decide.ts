import { CONTEXT_LINE } from "@kiwi/core/protocol.ts";
import { leadCheckpoint } from "@kiwi/core/reentry.ts";
import { openRound, type ChannelState } from "@kiwi/core/state.ts";

export const ROTATE_FLOOR = 100_000;

export type Rotation = { kind: "rotate"; why: string } | { kind: "stay"; why: string };

function onFinishedTask(state: ChannelState, seq: number): boolean {
  const place = state.placeOf.get(seq);
  const task = place?.kind === "task" ? state.tasks.get(place.task) : undefined;
  return !!task && (task.state === "done" || !!task.archived);
}

export function rotationAt(state: ChannelState, me: string, used: number | undefined, nudgedAfter: number | null): Rotation {
  if (used === undefined) return { kind: "stay", why: "its context size is unknown" };
  if (state.openAsks.some((m) => m.from === me && !onFinishedTask(state, m.seq))) return { kind: "stay", why: "a question of its to a person is open" };
  const open = [...state.tasks.values()].filter((t) => t.state !== "done" && !t.archived);
  if (open.some((t) => t.review === me && openRound(t))) return { kind: "stay", why: "a review round it judges is open" };
  const owned = open.filter((t) => t.owner === me);
  const lead = state.lead === me;
  if (!owned.length && !lead) return used >= ROTATE_FLOOR ? { kind: "rotate", why: "between tasks" } : { kind: "stay", why: "between tasks, with a small context" };
  if (used < CONTEXT_LINE) return { kind: "stay", why: lead ? "the lead, under the line" : "its open tasks and a context under the line" };
  const since = (seq: number | undefined) => nudgedAfter !== null && (seq ?? 0) > nudgedAfter;
  if (!owned.every((t) => since(t.notes.findLast((n) => n.checkpoint)?.seq))) return { kind: "stay", why: "past the line, waiting for a checkpoint on each open task" };
  if (lead && !since(leadCheckpoint(state, me)?.seq)) return { kind: "stay", why: "the lead, past the line, waiting for its lead checkpoint" };
  return { kind: "rotate", why: lead ? "the lead, past the line, with its lead checkpoint since the nudge" : "past the line, with a checkpoint on each open task since the nudge" };
}
