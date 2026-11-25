import type { ChannelStateDraft } from "../../src/state/types.ts";

export function rewrite(draft: ChannelStateDraft): void {
  const set = draft.roleSets.get("a");
  if (set) set.role = "lead";
}
