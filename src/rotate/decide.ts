import { CONTEXT_LINE } from "@kiwi/core/protocol.ts";
import { openRound, type ChannelState } from "@kiwi/core/state.ts";

export const ROTATE_FLOOR = 100_000;

export type Rotation = { kind: "rotate"; why: string } | { kind: "stay"; why: string };

export function rotationAt(state: ChannelState, me: string, used: number | undefined, nudgedAfter: number | null): Rotation {
  if (used === undefined) return { kind: "stay", why: "its context size is unknown" };
  if (state.openAsks.some((m) => m.from === me)) return { kind: "stay", why: "a question of its to a person is open" };
  const open = [...state.tasks.values()].filter((t) => t.state !== "done" && !t.archived);
  if (open.some((t) => t.review === me && openRound(t))) return { kind: "stay", why: "a review round it judges is open" };
  const owned = open.filter((t) => t.owner === me);
  if (owned.length) {
    if (used < CONTEXT_LINE) return { kind: "stay", why: "its open tasks and a context under the line" };
    const saved = nudgedAfter !== null && owned.every((t) => (t.notes.findLast((n) => n.checkpoint)?.seq ?? 0) > nudgedAfter);
    return saved ? { kind: "rotate", why: "past the line, with a checkpoint on each open task since the nudge" } : { kind: "stay", why: "past the line, waiting for a checkpoint on each open task" };
  }
  if (state.lead === me) return used >= CONTEXT_LINE ? { kind: "rotate", why: "the lead, past the line" } : { kind: "stay", why: "the lead, under the line" };
  return used >= ROTATE_FLOOR ? { kind: "rotate", why: "between tasks" } : { kind: "stay", why: "between tasks, with a small context" };
}
