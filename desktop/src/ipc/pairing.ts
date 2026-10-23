import type { PairAskView } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import { pairAnswer, pairBegin, pairCancel, pairPoll } from "../pairing.ts";

export function pairingCalls(): Serves<"pairBegin" | "pairPoll" | "pairAnswer" | "pairCancel"> {
  return {
    pairBegin: () => pairBegin(),
    pairPoll: (): Promise<PairAskView | null> => pairPoll(),
    pairAnswer: (accept: boolean) => pairAnswer(accept),
    pairCancel: () => pairCancel(),
  };
}
