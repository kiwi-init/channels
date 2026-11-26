import type { ChannelState } from "../../src/state/types.ts";

export function retitle(state: ChannelState): void {
  const task = state.tasks.get(1);
  if (task) task.title = "changed";
}
