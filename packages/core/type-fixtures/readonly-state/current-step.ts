import type { ChannelState } from "../../src/state/types.ts";
import { currentStep } from "../../src/steps.ts";

export function rename(state: ChannelState): void {
  const step = currentStep(state.tasks.get(1) ?? {});
  if (step) step.words = "changed";
}
