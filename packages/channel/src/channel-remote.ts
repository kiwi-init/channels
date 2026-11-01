import { ChannelGone, RelayError } from "@kiwi/core/client/relay-errors.ts";
import type { CachedKept, Unread } from "@kiwi/core/cache-row.ts";
import type { Message } from "@kiwi/core/protocol.ts";

import type {
  CallResult,
  ChannelCallName,
  ChannelCalls,
  ChannelOps,
  ChannelView,
  FollowEvent,
  FollowOptions,
  JoinCheck,
  KeysAsk,
  KeysPort,
  OlderRows,
  WireError,
} from "../../../desktop/src/bridge.ts";
import type { IndexHit, Searched } from "../../../desktop/src/search-types.ts";
import { fromWire, toWire } from "../../../desktop/src/wire.ts";

export function errorOf(w: WireError): Error {
  switch (w.kind) {
    case "gone":
      return new ChannelGone(w.why);
    case "relay":
      return new RelayError(w.status, w.message, w.tag);
    case "unreachable":
      return new TypeError(w.message);
    case "other":
      return Object.assign(new Error(w.message), w.tag ? { _tag: w.tag } : {});
  }
}

interface Sub {
  code: string;
  on: (e: FollowEvent) => void;
  last: number;
  remote: number | null;
  stopped: boolean;
  watch: boolean;
}

export function remoteOps(port: KeysPort): ChannelOps {
  const ask = async (a: KeysAsk): Promise<unknown> => {
    const r = await port.request(a);
    if (r.ok) return fromWire(r.value);
    throw errorOf(r.error);
  };
  const subs = new Set<Sub>();
  const byRemote = new Map<number, Sub>();
  const start = (s: Sub) => {
    void port.request({ op: "follow", code: s.code, since: s.last, ...(s.watch ? { watch: true } : {}) }).then((r) => {
      if (!r.ok) {
        if (!s.stopped) s.on({ _tag: "Failed", error: r.error });
        return;
      }
      const sub = fromWire(r.value);
      if (typeof sub !== "number") return;
      if (s.stopped) {
        void port.request({ op: "unfollow", sub });
        return;
      }
      s.remote = sub;
      byRemote.set(sub, s);
    });
  };
  port.onPush((p) => {
    const s = byRemote.get(p.sub);
    if (!s || s.stopped) return;
    const ev = fromWire(p.event) as FollowEvent;
    if (ev._tag === "Message") s.last = Math.max(s.last, ev.message.seq);
    if (ev._tag === "Unread") s.last = Math.max(s.last, ev.seq);
    if (ev._tag === "Head") s.last = Math.max(s.last, ev.seq);
    s.on(ev);
  });
  port.onRestart(() => {
    byRemote.clear();
    for (const s of subs) {
      s.remote = null;
      s.on({ _tag: "Status", line: "reconnecting to the part of Channels that holds your keys" });
      s.on({ _tag: "Down" });
      start(s);
    }
  });
  return {
    call: <K extends ChannelCallName>(code: string, op: K, ...args: Parameters<ChannelCalls[K]>) => ask({ op: "call", code, name: op, args: toWire(args) }) as Promise<CallResult<K>>,
    create: (name, token, me) => ask({ op: "create", name, token, me }) as Promise<ChannelView>,
    requestJoin: (code, name) => ask({ op: "requestJoin", code, name }) as Promise<ChannelView>,
    joinStatus: (code) => ask({ op: "joinStatus", code }) as Promise<JoinCheck>,
    forget: async (code) => void (await ask({ op: "forget", code })),
    presence: async (code, p) => void (await ask({ op: "presence", code, p: toWire(p) })),
    openRows: (code, rows) => ask({ op: "openRows", code, rows: toWire(rows) }) as Promise<(Message | Unread | null)[]>,
    olderRows: (code, before, limit) => ask({ op: "olderRows", code, before, limit }) as Promise<OlderRows>,
    indexRows: (code, rows, inputs) => ask({ op: "indexRows", code, rows: toWire(rows), inputs: toWire(inputs) }) as Promise<number | null>,
    searchHistory: (code, search) => ask({ op: "searchHistory", code, ask: toWire(search) }) as Promise<Searched | null>,
    historyAround: (code, around) => ask({ op: "historyAround", code, ask: toWire(around) }) as Promise<IndexHit[] | null>,
    keep: (code, state) => ask({ op: "keep", code, state: toWire(state) }) as Promise<CachedKept | null>,
    openKept: (code, sealed) => ask({ op: "openKept", code, sealed: toWire(sealed) }),
    nudge: () => void port.request({ op: "nudge" }),
    follow: (code, since, on, opts?: FollowOptions) => {
      const s: Sub = { code, on, last: since, remote: null, stopped: false, watch: opts?.watch === true };
      subs.add(s);
      start(s);
      return () => {
        s.stopped = true;
        subs.delete(s);
        if (s.remote === null) return;
        byRemote.delete(s.remote);
        void port.request({ op: "unfollow", sub: s.remote });
      };
    },
  };
}
