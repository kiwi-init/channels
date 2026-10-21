import type { Pane, RexPlace } from "../plugin.ts";
import { runNow } from "../shared/run.ts";
import { rexScreen } from "./api.ts";

export function rexPane(place: RexPlace, bin: string): Pane {
  const at = ["-S", place.server];
  const block = ["-s", place.session, "-b", place.block];
  const sendKey = (...keys: string[]): boolean => runNow([bin, ...at, "send-key", ...block, ...keys]).status === 0;
  return {
    screen: () => rexScreen(place, bin),
    type: (text) => runNow([bin, ...at, "send", ...block, text]).status === 0,
    enter: () => sendKey("enter"),
    erase: (count) => sendKey(...Array.from({ length: count }, () => "backspace")),
  };
}
