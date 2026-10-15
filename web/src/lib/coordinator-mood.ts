// What the coordinator's head shows: one face for what it's doing right now, read from the channel.
// What it reads (moodInputs) and how that maps to a face (coordinatorMood) each live in one small
// function, so both can be read, and tested, in one place.

import { ignored, type Message } from "../../../src/protocol.ts"
import { isPerson, type ChannelState } from "../../../src/state.ts"

type HeadState = "idle" | "thinking" | "speaking" | "working" | "error" | "sleeping"

export interface Mood {
  state: HeadState
  /** Frozen: the channel is on hold, so even its sleep doesn't breathe. */
  paused?: boolean
}

export interface MoodInput {
  /** Listening right now. */
  online: boolean
  /** The owner has every agent on hold. */
  hold: boolean
  now: number
  /** When it last said something (its newest chat message), if ever. */
  saidAt: number | null
  /** When its last action was refused or failed (a rejected event, a refused message), if ever. */
  failedAt: number | null
  /** A person's question to it, or an escalation it's handling, is still open. */
  answering: boolean
  /** It has a task in progress, or agents are working tasks it coordinates. */
  working: boolean
}

/** How long a just-sent message keeps it speaking, and a refusal keeps it showing the error. */
export const SPEAKING_MS = 4_000
export const ERROR_MS = 6_000

export function coordinatorMood(i: MoodInput): Mood {
  if (i.hold) return { state: "sleeping", paused: true }
  if (!i.online) return { state: "sleeping" }
  if (i.failedAt !== null && i.now - i.failedAt >= 0 && i.now - i.failedAt < ERROR_MS) return { state: "error" }
  if (i.saidAt !== null && i.now - i.saidAt >= 0 && i.now - i.saidAt < SPEAKING_MS) return { state: "speaking" }
  if (i.answering) return { state: "thinking" }
  if (i.working) return { state: "working" }
  return { state: "idle" }
}

/**
 * What the head reads from the channel, about the coordinator `coord`:
 * - said: its newest chat message (its time, and its seq: the latest run of its bubbles moves);
 * - failed: its newest chat message a client refused (not allowed, or rejected); an event that only
 *   lost a race (two claims of one task) isn't a failure;
 * - answering: a person's question, or an escalation, to it that's still open;
 * - working: a task in progress whose owner is listening, or one it owns itself.
 */
export function moodInputs(
  state: Pick<ChannelState, "members" | "tasks" | "trust" | "rejected" | "openAsks">,
  messages: Message[],
  online: { has: (name: string) => boolean },
  coord: string
): Pick<MoodInput, "saidAt" | "failedAt" | "answering" | "working"> & { last: number } {
  let saidAt: number | null = null
  let failedAt: number | null = null
  let last = 0
  for (const m of messages) {
    if (m.from !== coord || m.kind === "event") continue
    const at = m.rts ?? m.ts
    if (state.trust.get(m.seq) === "refused" || ignored(state.trust.get(m.seq)) || state.rejected.has(m.seq)) failedAt = at
    else {
      saidAt = at
      last = m.seq
    }
  }
  const asker = (m: Message) => state.members.get(m.from)
  const answering = state.openAsks.some((m) => !!m.to?.includes(coord) && (!!m.esc || (!!asker(m) && isPerson(asker(m)!))))
  const working = [...state.tasks.values()].some((t) => t.state === "doing" && !!t.owner && (t.owner === coord || online.has(t.owner)))
  return { saidAt, failedAt, answering, working, last }
}
