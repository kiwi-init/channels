import type { LinkAskView, PhoneView } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import { createLinkHost } from "../link-host.ts";
import { mutate, store } from "../store.ts";

export function linkingCalls(): Serves<"linkBegin" | "linkPoll" | "linkAnswer" | "linkCancel"> {
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
  return {
    linkBegin: () => host.begin(),
    linkPoll: (): Promise<LinkAskView | null> => host.poll(),
    linkAnswer: (accept: boolean): Promise<PhoneView | null> => host.answer(accept === true),
    linkCancel: () => host.cancel(),
  };
}
