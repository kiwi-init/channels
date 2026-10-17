import type { Color, Message } from "../protocol.ts";
import type { ChannelState } from "./types.ts";

export const isPerson = (m: { kind?: string; owner?: boolean }) => m.kind === "human" || !!m.owner;

export function humanOf(state: ChannelState, name: string): string | null {
  const m = state.members.get(name);
  if (!m || isPerson(m) || !m.sponsor) return null;
  return [...state.members.values()].find((x) => x.active && isPerson(x) && x.sponsor?.user === m.sponsor!.user)?.name ?? null;
}

export function ownerOf(state: ChannelState): string | null {
  return [...state.members.values()].find((x) => x.owner && x.active)?.name ?? null;
}

export function colorOf(state: ChannelState, name: string): Color | null {
  const m = state.members.get(name);
  if (!m) return null;
  if (isPerson(m)) return m.color ?? null;
  const person = m.sponsor && [...state.members.values()].find((x) => x.active && isPerson(x) && x.sponsor?.user === m.sponsor!.user);
  return person ? (person.color ?? null) : null;
}

export const COORDINATOR = "coordinator";
export const isCoordinatorRole = (role: string | undefined) => role?.trim().toLowerCase() === COORDINATOR;

export function firstAgent(state: Pick<ChannelState, "members">): string | undefined {
  const owner = [...state.members.values()].find((m) => m.owner && m.active)?.sponsor?.user;
  if (!owner) return undefined;
  const agents = [...state.members.values()]
    .filter((m) => m.active && !isPerson(m) && (m.kind as string | undefined) !== "computer" && m.sponsor?.user === owner)
    .sort((a, b) => a.joined - b.joined);
  return agents.find((m) => !m.role)?.name;
}

export function allowedOnHold(m: Pick<Message, "kind" | "to" | "ev">, isPersonName: (name: string) => boolean): boolean {
  if (m.kind === "event") return m.ev?.op === "hello" || m.ev?.op === "release";
  return !!m.to?.length && !m.to.includes("*") && m.to.every(isPersonName);
}

export const ON_HOLD = "the owner put the channel on hold: agents may only answer people until it's lifted";

export function keptFromPeople(state: ChannelState, m: Message): boolean {
  if (!state.mode.coordinatorOnly || !state.mode.strict || !state.coordinator || m.kind === "event" || m.esc) return false;
  const from = state.members.get(m.from);
  return !!from && !isPerson(from) && m.from !== state.coordinator;
}
