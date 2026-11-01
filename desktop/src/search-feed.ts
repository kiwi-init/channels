import { EVENT_OPS_VERSION, FOLD_RULES, ignored, isOverlay, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase } from "@kiwi/core/state.ts";
import { roomOfMessage } from "@kiwi/core/state/rooms.ts";
import type { ChannelState } from "@kiwi/core/state/types.ts";

import type { IndexedRow, IndexStamp, SearchIndex } from "./search-index.ts";
import type { FoldInputs } from "./search-types.ts";

export interface Fed {
  base: FoldBase | null;
  through: number;
}

export const stampFor = (through: number): IndexStamp => ({ rules: FOLD_RULES, ops: EVENT_OPS_VERSION, through });

export const sameRules = (stamp: IndexStamp | null): boolean => stamp !== null && stamp.rules === FOLD_RULES && stamp.ops === EVENT_OPS_VERSION;

function searchable(state: Pick<ChannelState, "trust" | "deleted" | "edits" | "roomOf">, m: Message): IndexedRow | null {
  if (m.kind === "event" || isOverlay(m) || ignored(state.trust.get(m.seq)) || state.deleted.has(m.seq)) return null;
  return { seq: m.seq, room: roomOfMessage(state, m), from: m.from, text: state.edits.get(m.seq)?.body ?? m.body };
}

export function feed(index: SearchIndex, fed: Fed, messages: readonly Message[], inputs: FoldInputs): Fed {
  const batch = messages.filter((m) => Number.isSafeInteger(m.seq) && m.seq > fed.through).sort((a, b) => a.seq - b.seq);
  if (!batch.length) return fed;
  let base = fed.base;
  const state = fold(batch, inputs.roster, inputs.now, inputs.roomsFloor, inputs.guardFloor, fed.base, (next) => (base = next));
  const here = new Set(batch.map((m) => m.seq));
  const put: IndexedRow[] = [];
  const drop: number[] = [];
  const retext: [number, string][] = [];
  for (const m of batch) {
    const row = searchable(state, m);
    if (row) put.push(row);
    else drop.push(m.seq);
    const ev = m.kind === "event" ? m.ev : undefined;
    if (!ev || (ev.op !== "msg.edit" && ev.op !== "msg.delete") || here.has(ev.seq) || ignored(state.trust.get(m.seq)) || state.rejected.has(m.seq)) continue;
    if (ev.op === "msg.delete" && state.deleted.has(ev.seq)) drop.push(ev.seq);
    if (ev.op === "msg.edit" && state.edits.get(ev.seq)?.seq === m.seq) retext.push([ev.seq, ev.body]);
  }
  index.put(put);
  index.drop(drop);
  for (const [target, text] of retext) if (!state.deleted.has(target)) index.retext(target, text);
  return { base, through: batch[batch.length - 1]!.seq };
}
