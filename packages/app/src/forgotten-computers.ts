import type { DeviceList } from "@kiwi/core/devices.ts";

let known: ReadonlyMap<string, DeviceList> = new Map();

export function keepLists(lists: ReadonlyMap<string, DeviceList>): void {
  known = lists;
}

export const revokedComputer = (person: string, pk: string): boolean => !!known.get(person)?.revoked.includes(pk);
