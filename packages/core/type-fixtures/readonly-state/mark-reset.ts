import { markReset } from "../../src/state/reset.ts";
import type { ChannelState } from "../../src/state/types.ts";

export function mark(state: ChannelState): void {
  const member = state.members.get("a");
  if (member) markReset(true, member, 1);
}
