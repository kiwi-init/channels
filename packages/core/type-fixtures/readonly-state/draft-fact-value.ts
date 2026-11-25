import type { ChannelStateDraft } from "../../src/state/types.ts";

export function rewrite(draft: ChannelStateDraft): void {
  const fact = draft.facts.get("k");
  if (fact) fact.value = "changed";
}
