import { ipcMain } from "electron";

import { generateIdentity } from "@kiwi/core/identity.ts";
import type { ComputerView, PendingItem, PersonView } from "../bridge.ts";
import { mergePublicChannels, migrateEntries, movedRelay, normalizeRelay, publicComputer, publicPerson } from "../guard.ts";
import { connectKeys, tellKeys } from "../keys-process.ts";
import { entryUrl } from "../serve-web.ts";
import { mutate, snapshot, store } from "../store.ts";
import { currentWindow } from "../window.ts";

let makingPerson = false;

export function wireStoreIpc(): void {
  ipcMain.on("kiwi:snapshot-sync", (e) => (e.returnValue = snapshot()));
  ipcMain.handle("kiwi:relay-url", () => store.relayUrl);
  ipcMain.handle("kiwi:set-relay-url", (_e, url: string) => {
    const norm = normalizeRelay(url);
    if (!norm) throw new Error("that isn't a relay URL (https, or http on localhost)");
    mutate((s) => {
      s.channels = movedRelay(s.channels, s.relayUrl, norm);
      s.relayUrl = norm;
      s.signin = undefined;
    });
    tellKeys({ type: "relay", relay: norm });
    currentWindow()?.loadURL(entryUrl());
    return norm;
  });
  ipcMain.handle("kiwi:create-person", async (_e, name: string) => {
    if (store.person || makingPerson) throw new Error("this app already has your person key");
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
      if (store.person) throw new Error("this app already has your person key");
      mutate((s) => (s.person = person));
      return publicPerson(person);
    } finally {
      makingPerson = false;
    }
  });
  ipcMain.handle("kiwi:save-channels", (_e, channels: unknown) => mutate((s) => (s.channels = mergePublicChannels(s.channels, channels))));
  ipcMain.handle("kiwi:migrate-channels", (_e, entries: unknown) => {
    if (store.migrated) return 0;
    const { channels, added } = migrateEntries(store.channels, entries);
    mutate((s) => {
      s.channels = channels;
      s.migrated = true;
    });
    return added;
  });
  ipcMain.on("kiwi:channels-connect", (e) => connectKeys(e.sender));
  ipcMain.handle("kiwi:save-computers", (_e, computers: ComputerView[]) => mutate((s) => (s.computers = computers.map(publicComputer))));
  ipcMain.handle("kiwi:set-pending", (_e, pending: PendingItem[]) => mutate((s) => (s.pending = pending)));
}
