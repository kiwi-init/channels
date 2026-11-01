import { generateIdentity } from "@kiwi/core/identity.ts";
import type { ComputerView, PendingItem, PersonView } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import { mergePublicChannels, migrateEntries, movedRelay, normalizeRelay, publicComputer, publicPerson } from "../guard.ts";
import type { Host } from "../host.ts";
import { unpairAt } from "../remote.ts";
import { mutate, personSigner, store } from "../store.ts";

let makingPerson = false;

export function storeCalls(host: Host): Serves<"setRelayUrl" | "createPerson" | "saveChannels" | "migrateChannels" | "saveComputers" | "setPending"> {
  return {
    setRelayUrl: (url: string) => {
      const norm = normalizeRelay(url);
      if (!norm) throw new Error("that isn't a relay URL (https, or http on localhost)");
      mutate((s) => {
        s.channels = movedRelay(s.channels, s.relayUrl, norm);
        s.relayUrl = norm;
        s.signin = undefined;
      });
      host.tellKeys({ type: "relay", relay: norm });
      host.reload();
      return norm;
    },
    createPerson: async (name: string) => {
      if (store.person || store.enrolled || makingPerson) throw new Error("this app already has your person key");
      makingPerson = true;
      try {
        const clean =
          name
            .replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u2069]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || "someone";
        const id = await generateIdentity(clean);
        const person: PersonView = { name: clean, pk: id.pk, sk: id.sk, xpk: id.xpk as string, xsk: id.xsk as string };
        if (store.person || store.enrolled) throw new Error("this app already has your person key");
        mutate((s) => (s.person = person));
        return publicPerson(person);
      } finally {
        makingPerson = false;
      }
    },
    saveChannels: (channels: unknown) => mutate((s) => (s.channels = mergePublicChannels(s.channels, channels))),
    migrateChannels: (entries: unknown) => {
      if (store.migrated) return 0;
      const { channels, added } = migrateEntries(store.channels, entries);
      mutate((s) => {
        s.channels = channels;
        s.migrated = true;
      });
      return added;
    },
    saveComputers: (computers: ComputerView[]) => {
      const kept = new Set(computers.map((c) => c.machinePk));
      const gone = store.computers.filter((c) => !c.own && !kept.has(c.machinePk));
      mutate((s) => (s.computers = computers.map(publicComputer)));
      if (!gone.length || (!store.person && !store.enrolled)) return;
      const asker = { ...personSigner(), relay: store.relayUrl };
      for (const c of gone) void unpairAt(asker, c.machinePk);
    },
    setPending: (pending: PendingItem[]) => mutate((s) => (s.pending = pending)),
  };
}
