import type { ChannelState } from "../../src/state/types.ts";
import { runStart } from "../../src/state/github.ts";

export function restart(state: ChannelState): void {
  const run = runStart(state.github, "ci", 0);
  if (run) run.started = 0;
}
