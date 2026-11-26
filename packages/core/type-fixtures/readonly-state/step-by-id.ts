import type { ChannelState } from "../../src/state/types.ts";
import { stepById } from "../../src/steps.ts";

export function rename(state: ChannelState): void {
  const step = stepById(state.tasks.get(1) ?? {}, "s1");
  if (step) step.words = "changed";
}
