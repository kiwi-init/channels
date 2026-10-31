import type { ChannelState, GuardFloor, RoomsFloor } from "@kiwi/core/state.ts";
import type { ChannelLink } from "./channel-ops.ts";

export interface SettingsSync {
  repos?: { list: string[]; since: number };
  charter?: { text: string | null; since: number };
  rooms?: RoomsFloor;
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function settingsSync(state: Pick<ChannelState, "repos" | "charter" | "rooms" | "head">, guard: GuardFloor | null, rooms: RoomsFloor | null): SettingsSync {
  const since = state.head;
  const charter = state.charter?.text ?? null;
  const roomList = [...state.rooms.values()].map((r) => ({ id: r.id, name: r.name }));
  const key = (list: readonly { id: string; name: string }[]) => list.map((r) => `${r.id}\u0000${r.name}`).sort();
  return {
    ...(!same(state.repos, guard?.repos?.list ?? []) ? { repos: { list: [...state.repos], since } } : {}),
    ...(charter !== (guard?.charter?.text ?? null) ? { charter: { text: charter, since } } : {}),
    ...(!same(key(roomList), key(rooms?.list ?? [])) ? { rooms: { list: roomList, since } } : {}),
  };
}

export async function syncSettings(
  ch: Pick<ChannelLink, "setGithubRepos" | "setRepos" | "setCharter" | "setRooms" | "guard" | "rooms">,
  state: Pick<ChannelState, "repos" | "charter" | "rooms" | "head">,
  guard: GuardFloor | null,
  rooms: RoomsFloor | null,
): Promise<{ guard: GuardFloor | null; rooms: RoomsFloor | null } | null> {
  const plan = settingsSync(state, guard, rooms);
  if (!plan.repos && !plan.charter && !plan.rooms) return null;
  if (plan.repos) {
    await ch.setGithubRepos(plan.repos.list);
    await ch.setRepos(plan.repos);
  }
  if (plan.charter) await ch.setCharter(plan.charter);
  if (plan.rooms) await ch.setRooms(plan.rooms);
  const [g, r] = await Promise.all([ch.guard(), ch.rooms()]);
  return { guard: g, rooms: r };
}
