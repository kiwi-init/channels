import type { ChannelStateDraft } from "../../src/state/types.ts";
import { currentStep, stepById } from "../../src/steps.ts";

export function rename(draft: ChannelStateDraft): void {
  const task = draft.tasks.get(1);
  const open = task ? currentStep(task) : undefined;
  if (open) open.words = "changed";
  const named = task ? stepById(task, "s1") : undefined;
  if (named) named.words = "changed";
  if (task) task.title = "changed";
}
