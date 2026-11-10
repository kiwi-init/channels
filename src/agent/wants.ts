import { personaAnswers } from "@kiwi/core/personality.ts";
import { isDirectedAt, isForAgent } from "@kiwi/core/client.ts";
import { GENERAL_ROOM, ignored, type Message } from "@kiwi/core/protocol.ts";
import { changedAfterApproval, freeAgents, isPerson, onSpec, openRound, specOfComment, threadMembers, type ChannelState, type Task } from "@kiwi/core/state.ts";
import type { Delivery } from "./shared.ts";

import { mentionsOf } from "@kiwi/core/changes.ts";
import { sentHere, sentTo } from "@kiwi/core/room-rules.ts";

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

const startsSpec = (m: Message): boolean => m.ev?.op === "spec.approve" || (m.ev?.op === "spec.result" && m.ev.verdict === "back");

function specNews(me: string, m: Message, state: ChannelState): boolean {
  const ev = m.ev;
  if (ev?.op !== "spec.set" && ev?.op !== "spec.approve" && ev?.op !== "spec.result") return false;
  const spec = state.specs.get(ev.ask);
  if (!spec || state.rejected.has(m.seq)) return false;
  if (ev.op === "spec.set" && !changedAfterApproval(spec, m.seq)) return false;
  if (ev.op === "spec.result" && ev.verdict !== "back") return false;
  if (onSpec(state, ev.ask).has(me)) return true;
  return startsSpec(m) && (state.lead === me || freeAgents(state).includes(me));
}

function specComment(me: string, m: Message, state: ChannelState): boolean {
  const spec = m.kind === "event" ? undefined : specOfComment(state, m.seq);
  return !!spec && onSpec(state, spec.ask).has(me);
}

export function wants(me: string, m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
  if (m.from === me) return false;
  if (ignored(state?.trust.get(m.seq))) return false;
  if (m.kind === "event" && !d.all && state?.rejected.has(m.seq)) return false;
  if (m.kind === "event" && (m.ev?.op === "room.create" || m.ev?.op === "room.members") && m.ev.members && state && !sentTo(m.ev, me, state.members)) return false;
  if (m.kind !== "event" && state && !sentHere(state, state.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM, me)) return false;
  if (d.room !== undefined && m.kind !== "event" && (state?.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM) !== d.room) return false;
  if (d.all) return true;
  if (d.thread !== undefined) return m.kind !== "event" && (state?.threadOf.get(m.seq) ?? m.seq) === (state?.threadOf.get(d.thread) ?? d.thread);
  if (d.loop && m.kind === "event" && m.ev?.op === "task.update" && endsMyWait(me, m.seq, state?.tasks.get(m.ev.task))) return true;
  const waiting = d.loop && state ? waitingTask(state, me) : undefined;
  if (waiting !== undefined) return wantsWhileWaiting(me, m, state, waiting);
  if (state && (specNews(me, m, state) || specComment(me, m, state))) return true;
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
  const here = state?.rooms.get(room);
  const sender = state?.members.get(m.from);
  const leadHears = !!here && !here.members && state?.lead === me && !!sender && isPerson(sender);
  const mine = room === GENERAL_ROOM || !!here?.posters?.includes(me) || (!!here?.members && !!state && sentTo(here, me, state.members)) || leadHears;
  return addressed || asking || inMyThread || (mine && !m.to?.length);
}
