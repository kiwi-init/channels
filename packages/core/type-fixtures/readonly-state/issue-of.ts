import { issueOf } from "../../src/state/github.ts";
import type { ChannelState } from "../../src/state/types.ts";

export function retitle(state: ChannelState): void {
  const issue = issueOf(state.github, { repo: "o/r", number: 1 });
  if (issue) issue.title = "changed";
}
