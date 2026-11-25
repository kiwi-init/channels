import { clearOnCard, markReset } from "../../src/state/reset.ts";
import type { ChannelStateDraft } from "../../src/state/types.ts";
import { currentStep, stepById } from "../../src/steps.ts";

export function rename(draft: ChannelStateDraft): void {
  const task = draft.tasks.get(1);
  const open = task ? currentStep(task) : undefined;
  if (open) open.words = "changed";
  const named = task ? stepById(task, "s1") : undefined;
  if (named) named.words = "changed";
  if (task) task.title = "changed";
  const member = draft.members.get("a");
  if (member) markReset(true, member, 1);
  if (member) clearOnCard(member, "s");
}
