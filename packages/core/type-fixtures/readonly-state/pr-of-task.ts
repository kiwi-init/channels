import { prOfTask } from "../../src/prs.ts";
import type { ChannelState } from "../../src/state/types.ts";

export function retitle(state: ChannelState): void {
  const task = state.tasks.get(1);
  const pr = task ? prOfTask(state.github, null, task) : undefined;
  if (pr) pr.title = "changed";
}
