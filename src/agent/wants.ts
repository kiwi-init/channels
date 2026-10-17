import { isDirectedAt, isForAgent } from "@kiwi/core/client.ts";
import { GENERAL_ROOM, ignored, type Message } from "@kiwi/core/protocol.ts";
import { isPerson, keptFromPeople, threadMembers, type ChannelState } from "@kiwi/core/state.ts";
import type { Delivery } from "./shared.ts";

export function wants(me: string, m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
  if (m.from === me) return false;
  if (ignored(state?.trust.get(m.seq))) return false;
  if (d.room !== undefined && m.kind !== "event" && (state?.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM) !== d.room) return false;
  if (d.all) return true;
  if (d.thread !== undefined) return m.kind !== "event" && (state?.threadOf.get(m.seq) ?? m.seq) === (state?.threadOf.get(d.thread) ?? d.thread);
  const role = state?.members.get(me)?.role;
  const addressed = isDirectedAt(m, me) || !!m.to?.includes("*") || (!!role && !!m.to?.includes(`role:${role}`));
  if (m.kind === "event")
    return addressed || m.ev?.op === "hello" || m.ev?.op === "mode.set" || m.ev?.op === "room.create" || m.ev?.op === "room.rename" || m.ev?.op === "charter.set" || m.ev?.op === "hold.set";
  if (d.chat) return true;
  const place = state?.placeOf.get(m.seq);
  if (state && place && place.kind !== "main") return isDirectedAt(m, me) || threadMembers(state, place).includes(me) || !!state.threadPeople.get(state.threadOf.get(m.seq) ?? m.seq)?.has(me);
  const sender = state?.members.get(m.from);
  if (state?.mode.coordinatorOnly && state.coordinator && sender && (sender.kind === "human" || sender.owner)) {
    return me === state.coordinator || isDirectedAt(m, me);
  }
  const self = state?.members.get(me);
  if (state && self && (self.kind === "human" || self.owner) && keptFromPeople(state, m)) return false;
  const asking = isForAgent(m, me) && (m.kind === "ask" || m.kind === "blocking");
  if (d.forMe) return addressed || asking;
  const fromPerson = !m.to?.length && (sender?.kind === "human" || !!sender?.owner);
  const inMyThread = !!state?.threadPeople.get(state.threadOf.get(m.seq) ?? m.seq)?.has(me);
  return addressed || asking || fromPerson || inMyThread;
}

export const ACK = "👀";

export function answersPeople(state: Pick<ChannelState, "members" | "trust">, messages: readonly Message[], re: readonly number[]): number[] {
  const bySeq = new Map(messages.map((m) => [m.seq, m]));
  const out = new Set<number>();
  const walk = (seq: number, depth: number) => {
    const m = bySeq.get(seq);
    if (!m || state.trust.get(seq) !== "verified") return;
    const from = state.members.get(m.from);
    if (from && isPerson(from)) {
      if (m.kind !== "event") out.add(seq);
      return;
    }
    if (depth < 3) for (const r of m.re ?? []) walk(r, depth + 1);
  };
  for (const r of re) walk(r, 0);
  return [...out];
}
