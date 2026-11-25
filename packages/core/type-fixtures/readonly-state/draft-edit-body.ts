import type { ChannelStateDraft } from "../../src/state/types.ts";

export function rewrite(draft: ChannelStateDraft): void {
  const edit = draft.edits.get(1);
  if (edit) edit.body = "changed";
}
