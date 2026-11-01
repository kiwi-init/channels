import type { Color, Message } from "../protocol.ts";
import { canPost } from "../scopes.ts";
import type { ChannelState, Member } from "./types.ts";

export const isPerson = (m: { kind?: string; owner?: boolean }) => m.kind === "human" || !!m.owner;

type Seat = Pick<Member, "name" | "kind" | "owner" | "sponsor">;

const authorRoot = (m: Seat): string => (isPerson(m) ? `person:${m.sponsor?.user ?? m.name}` : `seat:${m.name}`);

export const sameAuthor = (author: Seat | undefined, editor: Seat | undefined): boolean => !!author && !!editor && authorRoot(author) === authorRoot(editor);

export function humanOf(state: Pick<ChannelState, "members">, name: string): string | null {
  const m = state.members.get(name);
  if (!m || isPerson(m) || !m.sponsor) return null;
  return [...state.members.values()].find((x) => x.active && isPerson(x) && x.sponsor?.user === m.sponsor!.user)?.name ?? null;
}

export function answersDecisions(members: ReadonlyMap<string, Pick<Member, "active" | "answersDecisions">>, name: string): boolean {
  const m = members.get(name);
  return !!m?.active && !!m.answersDecisions;
}

export function fullyTrusted(m: Pick<Member, "kind" | "owner" | "active" | "scopes" | "addsAgents" | "answersDecisions" | "managesAgents"> | undefined): boolean {
  return !!m && m.kind === "human" && !m.owner && m.active && canPost(m.scopes) && !!m.addsAgents && !!m.answersDecisions && !!m.managesAgents;
}

export function trustedOf(state: Pick<ChannelState, "members">): string[] {
  return [...state.members.values()].filter(fullyTrusted).map((x) => x.name);
}

export function answersAsk(members: ReadonlyMap<string, Pick<Member, "active" | "answersDecisions">>, m: Pick<Message, "from" | "esc" | "to" | "handoff" | "step">, name: string): boolean {
  return m.esc ? !!m.to?.includes(name) || (!m.handoff && !m.step && answersDecisions(members, name)) : name !== m.from;
}

export function decidersOf(state: Pick<ChannelState, "members">, m: Pick<Message, "esc" | "to" | "handoff" | "permission" | "step">): string[] {
  if (!m.esc || m.handoff || m.permission || m.step) return [];
  return [...state.members.values()].filter((x) => answersDecisions(state.members, x.name) && !m.to?.includes(x.name)).map((x) => x.name);
}

export function ownerOf(state: Pick<ChannelState, "members">): string | null {
  return [...state.members.values()].find((x) => x.owner && x.active)?.name ?? null;
}

export function colorOf(state: ChannelState, name: string): Color | null {
  const m = state.members.get(name);
  if (!m) return null;
  if (isPerson(m)) return m.color ?? null;
  const person = m.sponsor && [...state.members.values()].find((x) => x.active && isPerson(x) && x.sponsor?.user === m.sponsor!.user);
  return person ? (person.color ?? null) : null;
}

export const LEAD = "lead";
const LEGACY_LEAD = "coordinator";
export const isLeadRole = (role: string | undefined) => {
  const r = role?.trim().toLowerCase();
  return r === LEAD || r === LEGACY_LEAD;
};

export function allowedOnHold(m: Pick<Message, "kind" | "to" | "ev">, isPersonName: (name: string) => boolean): boolean {
  if (m.kind === "event") return m.ev?.op === "hello" || m.ev?.op === "release";
  return !!m.to?.length && !m.to.includes("*") && m.to.every(isPersonName);
}

export const ON_HOLD = "the owner put the channel on hold: agents may only answer people until it's lifted";
