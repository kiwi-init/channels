import { personaAnswers } from "@kiwi/core/personality.ts";
import { isDirectedAt, isForAgent } from "@kiwi/core/client.ts";
import { GENERAL_ROOM, ignored, type Message } from "@kiwi/core/protocol.ts";
import { openRound, threadMembers, type ChannelState, type Task } from "@kiwi/core/state.ts";
import type { Delivery } from "./shared.ts";

import { mentionsOf } from "@kiwi/core/changes.ts";

export function narrows(d: Delivery): boolean {
  return d.thread !== undefined || d.room !== undefined || !!d.forMe || !!d.loop;
}

export function waitingTask(state: ChannelState, me: string): number | undefined {
  return [...state.tasks.values()].find((t) => t.owner === me && t.state !== "done" && t.review !== me && !!openRound(t))?.id;
}

function endsMyWait(me: string, seq: number, task: Task | undefined): boolean {
  const round = task?.rounds.at(-1);
  if (round && round.result.kind !== "open" && round.result.seq === seq && (round.by === me || task?.owner === me)) return true;
  return task?.handedOff?.seq === seq && task.handedOff.from === me;
}

function wantsWhileWaiting(me: string, m: Message, state: ChannelState | null, task: number): boolean {
  if (m.kind === "event") return (m.ev?.op === "task.update" && m.ev.task === task) || m.ev?.op === "hold.set";
  const place = state?.placeOf.get(m.seq);
  const inMyThread = !!state?.threadPeople.get(state.threadOf.get(m.seq) ?? m.seq)?.has(me);
  return isDirectedAt(m, me) || mentionsOf(m.body).has(me.toLowerCase()) || inMyThread || (place?.kind === "task" && place.task === task);
}

export function wants(me: string, m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
  if (m.from === me) return false;
  if (ignored(state?.trust.get(m.seq))) return false;
  if (m.kind === "event" && !d.all && state?.rejected.has(m.seq)) return false;
  if (d.room !== undefined && m.kind !== "event" && (state?.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM) !== d.room) return false;
  if (d.all) return true;
  if (d.thread !== undefined) return m.kind !== "event" && (state?.threadOf.get(m.seq) ?? m.seq) === (state?.threadOf.get(d.thread) ?? d.thread);
  if (d.loop && m.kind === "event" && m.ev?.op === "task.update" && endsMyWait(me, m.seq, state?.tasks.get(m.ev.task))) return true;
  const waiting = d.loop && state ? waitingTask(state, me) : undefined;
  if (waiting !== undefined) return wantsWhileWaiting(me, m, state, waiting);
  const persona = state?.members.get(me)?.persona;
  const addressed = isDirectedAt(m, me) || !!m.to?.includes("*") || !!m.to?.some((t) => t.startsWith("role:") && personaAnswers(persona, t.slice(5)));
  if (m.kind === "event")
    return addressed || m.ev?.op === "hello" || m.ev?.op === "room.create" || m.ev?.op === "room.rename" || m.ev?.op === "charter.set" || m.ev?.op === "repos.set" || m.ev?.op === "hold.set";
  if (d.chat) return true;
  if (mentionsOf(m.body).has(me.toLowerCase())) return true;
  const place = state?.placeOf.get(m.seq);
  const inMyThread = !!state?.threadPeople.get(state.threadOf.get(m.seq) ?? m.seq)?.has(me);
  if (state && place && place.kind !== "main") return isDirectedAt(m, me) || threadMembers(state, place).includes(me) || inMyThread;
  const asking = isForAgent(m, me) && (m.kind === "ask" || m.kind === "blocking");
  if (d.forMe) return addressed || asking;
  const room = state?.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM;
  const mine = room === GENERAL_ROOM || !!state?.rooms.get(room)?.posters?.includes(me);
  return addressed || asking || inMyThread || (mine && !m.to?.length);
}
