import { taskPr } from "../../src/prs.ts";
import type { ChannelState } from "../../src/state/types.ts";

export function retitle(state: ChannelState): void {
  const pr = taskPr(state, 1)?.pr;
  if (pr) pr.title = "changed";
}
