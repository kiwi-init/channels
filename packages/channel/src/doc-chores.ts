import type { DocStat } from "@kiwi/core/client.ts";
import { DOC_PRUNE_IDLE_MS, MAX_DOC_PRUNE } from "@kiwi/core/protocol.ts";
import { placeFromKey, type ChannelState } from "@kiwi/core/state.ts";
import type { ChannelLink } from "./channel-ops.ts";

export const DOC_CHORES_EVERY_MS = 6 * 60 * 60 * 1000;
export const DOC_COMPACT_IDLE_MS = 24 * 60 * 60 * 1000;
const COMPACTS_PER_RUN = 8;

export interface DocPlan {
  prune: string[];
  compact: [thread: string, th: string][];
}

export function planDocs(listed: readonly DocStat[], state: Pick<ChannelState, "docs" | "tasks">, now: number): DocPlan {
  const threadOf = new Map([...state.docs].map(([thread, th]) => [th, thread]));
  const prune = listed
    .filter((d) => !threadOf.has(d.th) && now - d.last >= DOC_PRUNE_IDLE_MS)
    .map((d) => d.th)
    .slice(0, MAX_DOC_PRUNE);
  const compact = listed.flatMap((d): DocPlan["compact"] => {
    const thread = threadOf.get(d.th);
    const place = thread ? placeFromKey(thread) : null;
    const task = place?.kind === "task" ? state.tasks.get(place.task) : undefined;
    const closed = task && (task.state === "done" || task.cancelled);
    return thread && closed && d.n > 0 && now - d.last >= DOC_COMPACT_IDLE_MS ? [[thread, d.th]] : [];
  });
  return { prune, compact: compact.slice(0, COMPACTS_PER_RUN) };
}

export async function tendDocs(ch: ChannelLink, state: ChannelState, now: number): Promise<DocPlan> {
  const plan = planDocs(await ch.docList(), state, now);
  if (plan.prune.length) await ch.pruneDocs(plan.prune);
  for (const [thread, th] of plan.compact) await ch.compactDoc(thread, th);
  return plan;
}
