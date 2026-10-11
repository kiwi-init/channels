// What the person sees and where what they type goes: the same rules as the web conversation.
// In coordinator-only mode a person talks with the coordinator ("with lead", the default) or
// reads the whole channel ("everything"); either way their words reach the coordinator.

import { ignored, type Message } from "../protocol.ts";
import { isPerson, keptFromPeople, type ChannelState } from "../state.ts";

export type View = "coordinator" | "everything";

/** The coordinator this person talks with, or null when the channel isn't coordinator-only for them. */
export function coordinatorFor(state: ChannelState, me: string): string | null {
  const meM = state.members.get(me);
  if (!state.mode.coordinatorOnly || !state.coordinator || !meM || !isPerson(meM) || state.coordinator === me) return null;
  return state.coordinator;
}

/** Whether the screen shows `m` in this view (and, for chat, in this room unless the view spans rooms). */
export function shows(m: Message, view: View, state: ChannelState, me: string, room: string | null): boolean {
  if (ignored(state.trust.get(m.seq))) return false;
  if (m.kind === "event" && m.ev?.op === "hello") return false;
  const coordinator = coordinatorFor(state, me);
  if (coordinator && view === "coordinator") {
    if (m.kind === "event") return m.ev?.op === "mode.set" || (m.ev?.op === "role.set" && (m.ev.member === me || m.ev.role === "coordinator"));
    if (m.from === me) return true;
    // The coordinator's words to you or to everyone; an agent's broadcast isn't a way around it.
    if (m.from === coordinator) return !m.to?.length || m.to.includes(me) || m.to.includes("*");
    // Anyone else, only when it names you (people, or an agent the owner didn't make strict).
    return !!m.to?.includes(me) && !keptFromPeople(state, m);
  }
  if (room !== null && m.kind !== "event" && (state.roomOf.get(m.seq) ?? m.room ?? "general") !== room) return false;
  return true;
}

const LEADING = /^(?:\s*@([\p{L}\p{N}_.-]+)[\s,]*)+/u;

/** Who a message is for: the members @mentioned at its start. */
export function mentioned(body: string, state: ChannelState, me: string): string[] {
  const lead = LEADING.exec(body)?.[0] ?? "";
  const names = [...lead.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].map((m) => m[1]!);
  return [...new Set(names.filter((n) => n !== me && state.members.get(n)?.active))];
}

/**
 * Where a message goes. With the coordinator: to them, any @agent left in the text for them to
 * pass on. In Everything: as written, copied to the coordinator. Otherwise to whoever it @mentions
 * at its start, or the channel.
 */
export function route(body: string, view: View, state: ChannelState, me: string): string[] | undefined {
  const coordinator = coordinatorFor(state, me);
  if (coordinator && view === "coordinator") return [coordinator];
  const named = mentioned(body, state, me);
  if (coordinator && named.length && !named.includes(coordinator)) return [...named, coordinator];
  return named.length ? named : undefined;
}

/**
 * Who a reply is awaited from (any one of them answering ends the wait) and who to name while
 * waiting: the recipients, the coordinator for what goes through them, any agent otherwise.
 */
export function awaitedFrom(to: string[] | undefined, state: ChannelState, me: string): { names: string[] | null; shown: string[] } {
  const named = to?.filter((t) => t !== "*" && t !== me && state.members.get(t)?.active) ?? [];
  const coordinator = coordinatorFor(state, me);
  if (coordinator && !named.length) return { names: [coordinator], shown: [coordinator] };
  // Copied to the coordinator: either may answer, but it's for the others.
  const others = named.filter((n) => n !== coordinator);
  return named.length ? { names: named, shown: others.length ? others : named } : { names: null, shown: [] };
}
