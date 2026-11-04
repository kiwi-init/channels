import type { Channel } from "@kiwi/core/client.ts";
import { settledBlocks, watchWakes, type DocWake } from "@kiwi/core/doc/agent.ts";
import { blocksOf, type Block } from "@kiwi/core/doc/blocks.ts";
import type { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import { MAX_DOC_THREADS } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import { addDocWake, docSeen, legacyDocSince, setDocSeen, type DocSeenDoc, type DocWakeItem } from "../config/doc-wakes.ts";

export interface Follow {
  key: string;
  th: string;
  owns: boolean;
}

export function docFollows(state: Pick<ChannelState, "docs" | "tasks">, agent: string): Follow[] {
  const out: Follow[] = [];
  for (const [key, th] of state.docs) {
    if (key === "main") {
      out.push({ key, th, owns: false });
      continue;
    }
    const t = /^task:(\d+)$/.exec(key);
    const task = t ? state.tasks.get(Number(t[1])) : undefined;
    if (!task || task.state === "done") continue;
    const owns = task.owner === agent;
    if (owns || task.workedBy.includes(agent) || task.posters?.includes(agent) || task.review === agent) out.push({ key, th, owns });
  }
  const rank = (f: Follow) => (f.owns ? 0 : f.key === "main" ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_DOC_THREADS);
}

export interface FollowedSeat {
  alias: string;
  agent: string;
  ch: Pick<Channel, "threadDoc" | "closeDoc">;
}

export interface DocFollower {
  refresh: (delay?: number) => void;
  stop: () => void;
}

const REFRESH_MS = 2_000;
const KEEP_SEEN = 2_000;

function remember(d: DocSeenDoc, b: Pick<Block, "id" | "at">): void {
  d.at[b.id] = b.at;
  const all = Object.entries(d.at);
  if (all.length <= KEEP_SEEN) return;
  for (const [id, at] of all.sort((x, y) => x[1] - y[1]).slice(0, all.length - KEEP_SEEN)) {
    d.cut = Math.max(d.cut, at);
    delete d.at[id];
  }
}

function wakeItem(key: string, td: Pick<ThreadDoc, "doc">, w: DocWake): DocWakeItem {
  const blocks = blocksOf(td.doc);
  const ready = new Set(settledBlocks(blocks).map((b) => b.id));
  const prev = blocks
    .slice(
      0,
      Math.max(
        0,
        blocks.findIndex((b) => b.id === w.block.id),
      ),
    )
    .findLast((b) => ready.has(b.id) && !!b.text.trim());
  return {
    key,
    th: w.th,
    block: w.block.id,
    author: w.block.author,
    text: w.block.text,
    context: prev ? `${prev.author}: ${prev.text}` : "",
    selection: w.selection?.text ?? null,
    at: w.block.at,
  };
}

export function followDocs(
  seat: FollowedSeat,
  stateOf: () => Promise<ChannelState | null>,
  woke: () => void,
  wanted: () => Promise<boolean> = async () => true,
  now: () => number = Date.now,
): DocFollower {
  const open = new Map<string, { th: string; owns: boolean; stop: () => void }>();
  const seen = docSeen(seat.alias, seat.agent);
  const legacy = legacyDocSince(seat.alias, seat.agent);
  const floor = seen.alive ?? now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let again = false;
  let ended = false;

  const save = () => {
    seen.alive = now();
    setDocSeen(seat.alias, seat.agent, seen);
  };

  const heard = (key: string, td: ThreadDoc) => (w: DocWake) => {
    if (addDocWake(seat.alias, seat.agent, wakeItem(key, td, w))) woke();
  };

  const drop = (key: string, closeDoc: boolean) => {
    open.get(key)?.stop();
    open.delete(key);
    if (closeDoc) seat.ch.closeDoc(key);
  };

  const refresh = async (): Promise<void> => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      if (!(await wanted())) return;
      const state = await stateOf();
      if (!state || ended) return;
      const want = new Map(docFollows(state, seat.agent).map((f) => [f.key, f]));
      const live = new Set(state.docs.values());
      for (const th of Object.keys(seen.docs)) if (!live.has(th)) delete seen.docs[th];
      save();
      for (const [key, o] of [...open]) {
        const f = want.get(key);
        if (!f || f.th !== o.th || f.owns !== o.owns) drop(key, !f || f.th !== o.th);
      }
      for (const f of want.values()) {
        if (open.has(f.key)) continue;
        const td = await seat.ch.threadDoc(f.key, f.th);
        if (ended) return;
        const d = seen.docs[f.th] ?? { cut: Math.min(legacy[f.th] ?? floor, floor), at: {} };
        if (!seen.docs[f.th]) {
          seen.docs[f.th] = d;
          save();
        }
        const known = (b: Block) => b.at <= d.cut || d.at[b.id] !== undefined;
        const settled = (blocks: readonly Block[]) => {
          for (const b of blocks) remember(d, b);
          save();
        };
        const stop = watchWakes(td, { me: seat.agent, names: [seat.agent], owns: f.owns, known, settled, name: (a) => a }, heard(f.key, td));
        open.set(f.key, { th: f.th, owns: f.owns, stop });
      }
    } finally {
      busy = false;
      if (again && !ended) {
        again = false;
        void refresh().catch(() => {});
      }
    }
  };

  return {
    refresh: (delay = REFRESH_MS) => {
      if (timer || ended) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh().catch(() => {});
      }, delay);
    },
    stop: () => {
      ended = true;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const key of [...open.keys()]) drop(key, true);
    },
  };
}
