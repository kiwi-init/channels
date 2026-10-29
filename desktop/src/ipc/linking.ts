import type { Serves } from "../calls.ts";
import { mutate } from "../store.ts";

const retired = (): Promise<never> => Promise.reject(new Error("Codes are gone: sign in on the other device (kiwi login on a computer), then type the 6 digits it shows here."));

export function linkingCalls(): Serves<"pairBegin" | "pairPoll" | "pairAnswer" | "pairCancel" | "linkBegin" | "linkPoll" | "linkAnswer" | "linkCancel" | "forgetPhone"> {
  return {
    pairBegin: retired,
    pairPoll: retired,
    pairAnswer: retired,
    pairCancel: retired,
    linkBegin: retired,
    linkPoll: retired,
    linkAnswer: retired,
    linkCancel: retired,
    forgetPhone: (at: number) =>
      mutate((s) => {
        s.phones = (s.phones ?? []).filter((p) => p.at !== at);
      }),
  };
}
