import { clearOnCard } from "../../src/state/reset.ts";
import type { ChannelState } from "../../src/state/types.ts";

export function clear(state: ChannelState): void {
  const member = state.members.get("a");
  if (member) clearOnCard(member, "s");
}
