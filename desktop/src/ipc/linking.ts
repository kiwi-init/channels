import { ipcMain } from "electron";

import type { LinkAskView, PhoneView } from "../bridge.ts";
import { createLinkHost } from "../link-host.ts";
import { mutate, store } from "../store.ts";

export function wireLinkingIpc(): void {
  const host = createLinkHost({
    relayUrl: () => store.relayUrl,
    person: () => {
      const p = store.person;
      if (!p?.xsk) throw new Error("make your person key first");
      return p;
    },
    channels: () => store.channels,
    linked: (phone) =>
      mutate((s) => {
        s.phones = [...(s.phones ?? []), phone];
      }),
  });
  ipcMain.handle("kiwi:link-begin", () => host.begin());
  ipcMain.handle("kiwi:link-poll", (): Promise<LinkAskView | null> => host.poll());
  ipcMain.handle("kiwi:link-answer", (_e, accept: boolean): Promise<PhoneView | null> => host.answer(accept === true));
  ipcMain.handle("kiwi:link-cancel", () => host.cancel());
}
