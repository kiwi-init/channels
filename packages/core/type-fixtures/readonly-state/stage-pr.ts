import { stageOf } from "../../src/stage.ts";
import type { ChannelState } from "../../src/state/types.ts";

export function retitle(state: ChannelState): void {
  const task = state.tasks.get(1);
  const pr = task ? stageOf(state, task).pr : undefined;
  if (pr) pr.title = "changed";
}
