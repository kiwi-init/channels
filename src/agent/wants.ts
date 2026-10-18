import { personaAnswers } from "@kiwi/core/personality.ts";
import { isDirectedAt, isForAgent } from "@kiwi/core/client.ts";
import { GENERAL_ROOM, ignored, type Message } from "@kiwi/core/protocol.ts";
import { threadMembers, type ChannelState } from "@kiwi/core/state.ts";
import type { Delivery } from "./shared.ts";

const MENTION_RE = /(?:^|[^\w@/.-])@([a-z0-9][a-z0-9._-]*[a-z0-9]|[a-z0-9])/gi;

function mentionsOf(body: string): Set<string> {
  return new Set([...body.matchAll(MENTION_RE)].map((m) => m[1]!.toLowerCase()));
}

export function wants(me: string, m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
  if (m.from === me) return false;
  if (ignored(state?.trust.get(m.seq))) return false;
  if (d.room !== undefined && m.kind !== "event" && (state?.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM) !== d.room) return false;
  if (d.all) return true;
  if (d.thread !== undefined) return m.kind !== "event" && (state?.threadOf.get(m.seq) ?? m.seq) === (state?.threadOf.get(d.thread) ?? d.thread);
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
