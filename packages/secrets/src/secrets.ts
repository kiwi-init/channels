// The person's secrets: their person key, their computers and the join requests waiting
// on them. In the desktop app they live behind the bridge (window.kiwi), which keeps them with the
// OS keychain (safeStorage) and hands the renderer one synchronous snapshot at load. In a plain
// browser (development) they fall back to localStorage, so the renderer runs the same either way.

import { useSyncExternalStore } from "react";

import type {
  ChannelIdentityView,
  ChannelView,
  ComputerView,
  DeviceNewsView,
  GithubRepoView,
  KeysAtRest,
  KiwiBridge,
  PhoneView,
  PublicPerson,
  StoreSnapshot,
  TermEvent,
  TermOpenView,
  UpdateCheckView,
  UpdateView,
} from "../../../desktop/src/bridge.ts";
import { publicChannel } from "../../../desktop/src/public-channel.ts";
import { onLocalChange, readLocal, sweepBrowserKeys, writeLocal, type Local } from "./local-store.ts";
import { persistQueue } from "./persist-queue.ts";
import { devBuild } from "./relay.ts";

export type { ChannelView, ComputerView, DeviceNewsView, GithubRepoView, KeysAtRest, KiwiBridge, PhoneView, PublicPerson, StoreSnapshot, TermEvent, TermOpenView, UpdateCheckView, UpdateView };

/** The desktop bridge, or null in a plain browser. */
export function bridge(): KiwiBridge | null {
  try {
    const k = (window as unknown as { kiwi?: KiwiBridge }).kiwi;
    return k && typeof k.getSnapshot === "function" ? k : null;
  } catch {
    return null;
  }
}

const publicOf = (l: Local): StoreSnapshot => ({
  relayUrl: "",
  person: l.person ? { name: l.person.name, pk: l.person.pk, xpk: l.person.xpk } : null,
  channels: l.channels.map(publicChannel),
  computers: l.computers,
  phones: [],
  pending: l.pending,
  personalities: l.personalities,
});

export function prepareBrowserStore(): void {
  if (!bridge() && !devBuild()) sweepBrowserKeys();
}

let snapshot: StoreSnapshot = (() => {
  prepareBrowserStore();
  const b = bridge();
  return b ? b.getSnapshot() : publicOf(readLocal());
})();
const listeners = new Set<() => void>();
function publish(next: StoreSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}
bridge()?.onStore(publish);
onLocalChange((l) => {
  if (!bridge()) publish(publicOf(l));
});

/** What's kept right now. */
export const secrets = (): StoreSnapshot => snapshot;

/** The same, as React state. */
export function useSecrets(): StoreSnapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

/** First run: make the person key under `name` and keep it. */
export async function createPerson(name: string): Promise<PublicPerson> {
  const b = bridge();
  if (b) {
    const p = await b.createPerson(name);
    publish({ ...snapshot, person: p });
    return p;
  }
  const p = await import("./channel-local.ts").then((m) => m.makeLocalPerson(name));
  return { name: p.name, pk: p.pk, xpk: p.xpk };
}

const persistChannels = persistQueue();

/** Keep the channel identities (member keys, pending joins). Visible at once; the write follows, one at a time. */
export async function saveChannels(channels: ChannelView[]): Promise<void> {
  const b = bridge();
  if (b) {
    publish({ ...snapshot, channels });
    await persistChannels(() => b.saveChannels(channels));
  } else {
    const { mergePublicChannels } = await import("../../../desktop/src/seats.ts");
    writeLocal({ channels: mergePublicChannels(readLocal().channels, channels) });
  }
}

export async function migrateChannels(entries: ChannelIdentityView[]): Promise<number> {
  const b = bridge();
  if (b) return b.migrateChannels(entries);
  if (!devBuild()) return 0;
  const { migrateEntries } = await import("../../../desktop/src/seats.ts");
  const { channels, added } = migrateEntries(readLocal().channels, entries);
  if (added) writeLocal({ channels });
  return added;
}

export async function saveComputers(computers: ComputerView[]): Promise<void> {
  const b = bridge();
  if (b) {
    await b.saveComputers(computers);
    publish({ ...snapshot, computers });
  } else writeLocal({ computers });
}
