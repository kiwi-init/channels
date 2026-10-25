import type { Serves } from "../calls.ts";
import { uiSignals } from "../ui-signals.ts";

const MAX_MESSAGE = 2_000;

export function uiCalls(): Serves<"uiReady" | "uiError"> {
  return {
    uiReady: () => uiSignals.ready(),
    uiError: (message: string) => {
      if (typeof message !== "string") throw new Error("a UI error is a message");
      uiSignals.error(message.slice(0, MAX_MESSAGE));
    },
  };
}
