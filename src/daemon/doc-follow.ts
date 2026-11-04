import type { Channel } from "@kiwi/core/client.ts";
import { watchWakes, type DocWake } from "@kiwi/core/doc/agent.ts";
import { blocksOf } from "@kiwi/core/doc/blocks.ts";
import type { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import { MAX_DOC_THREADS } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import { addDocWake, docSince, setDocSince, type DocWakeItem } from "../config/doc-wakes.ts";

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

function wakeItem(key: string, td: Pick<ThreadDoc, "doc">, w: DocWake): DocWakeItem {
  const blocks = blocksOf(td.doc);
  const prev = blocks[blocks.findIndex((b) => b.id === w.block.id) - 1];
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

export function followDocs(seat: FollowedSeat, stateOf: () => Promise<ChannelState | null>, woke: () => void, wanted: () => Promise<boolean> = async () => true, now: () => number = Date.now): DocFollower {
  const open = new Map<string, { th: string; owns: boolean; stop: () => void }>();
  const since = docSince(seat.alias, seat.agent);
  const started = now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let again = false;
  let ended = false;

  const heard = (key: string, td: ThreadDoc) => (w: DocWake) => {
    since[w.th] = Math.max(since[w.th] ?? 0, w.block.at);
    setDocSince(seat.alias, seat.agent, since);
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
      for (const [key, o] of [...open]) {
        const f = want.get(key);
        if (!f || f.th !== o.th || f.owns !== o.owns) drop(key, !f || f.th !== o.th);
      }
      for (const f of want.values()) {
        if (open.has(f.key)) continue;
        const td = await seat.ch.threadDoc(f.key, f.th);
        if (ended) return;
        if (since[f.th] === undefined) {
          since[f.th] = started;
          setDocSince(seat.alias, seat.agent, since);
        }
        const stop = watchWakes(td, { me: seat.agent, names: [seat.agent], owns: f.owns, after: since[f.th], name: (a) => a }, heard(f.key, td));
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
