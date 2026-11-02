import type { DeviceList } from "@kiwi/core/devices.ts";
import type { Member } from "@kiwi/core/membership.ts";

let known: ReadonlyMap<string, DeviceList> = new Map();

export function keepLists(lists: ReadonlyMap<string, DeviceList>): void {
  known = lists;
}

export const revokedComputer = (person: string, pk: string): boolean => !!known.get(person)?.revoked.includes(pk);

export function launchedBy(roster: readonly Member[], devices: readonly string[], person: string): { pk: string; from: string; name: string }[] {
  return roster.flatMap((r) =>
    r.active && r.kind !== "human" && r.from && devices.includes(r.from.pk) && r.sponsor?.user === person ? [{ pk: r.pk, from: r.from.pk, name: r.display ?? r.name }] : [],
  );
}
