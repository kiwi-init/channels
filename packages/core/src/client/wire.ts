import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import { PING, rasterAttachment, wellFormed, type Message, type ServerFrame } from "../protocol.ts";
import { RelayError, Unreachable, type ChannelGone, type Dropped } from "./errors.ts";
import type { OpenKind, PresenceFields } from "./live.ts";

export type Incoming =
  | ServerFrame
  | { t: "pong" }
  | { t: "own"; seq: number; ts: number; payload: unknown }
  | { t: "open"; presence: (p: PresenceFields) => Effect.Effect<void>; mark: (seq: number) => boolean; probe: (ms: number) => Promise<Probe | null>; kind: OpenKind }
  | { t: "more"; ask: (since: number) => void };

export type Inbox = Queue.Queue<Incoming, Dropped | ChannelGone | Cause.Done>;

export interface Wire {
  send: (sealed: { iv: string; ct: string }, e: number, payload: object) => Effect.Effect<number | null, Unreachable | RelayError>;
  answer: (f: ServerFrame | { t: "pong" }) => boolean;
  drop: () => void;
}

const ACK_WAIT_MS = 30_000;

export function wireOn(ws: WebSocket, q: Inbox): Wire {
  const waiting = new Map<string, { payload: object; settle: (r: Effect.Effect<number | null, Unreachable | RelayError>) => void }>();
  const unsure = (why: string) => Effect.fail(new Unreachable({ cause: new Error(`${why} before the relay confirmed the message; it may still have been sent`) }));
  return {
    send: (sealed, e, payload) =>
      Effect.callback<number | null, Unreachable | RelayError>((resume) => {
        if (ws.readyState !== WebSocket.OPEN) return resume(Effect.succeed(null));
        const id = crypto.randomUUID();
        try {
          ws.send(JSON.stringify({ t: "send", id, iv: sealed.iv, ct: sealed.ct, e }));
        } catch {
          return resume(Effect.succeed(null));
        }
        let pending = true;
        const timer = setTimeout(() => settle(unsure("no answer in time")), ACK_WAIT_MS);
        const settle = (r: Effect.Effect<number | null, Unreachable | RelayError>) => {
          if (!pending) return;
          pending = false;
          clearTimeout(timer);
          resume(r);
        };
        waiting.set(id, { payload, settle });
        return Effect.sync(() => {
          pending = false;
          clearTimeout(timer);
        });
      }),
    answer: (f) => {
      if ((f.t !== "ack" && f.t !== "err") || typeof f.id !== "string") return false;
      const w = waiting.get(f.id);
      if (!w) return false;
      waiting.delete(f.id);
      if (f.t === "err") {
        w.settle(f.tag === "TooMany" ? Effect.fail(new RelayError(429, f.error, f.tag, f.retryAfter)) : Effect.succeed(null));
        return true;
      }
      if (Number.isSafeInteger(f.seq) && Number.isFinite(f.ts)) Queue.offerUnsafe(q, { t: "own", seq: f.seq, ts: f.ts!, payload: w.payload });
      w.settle(Effect.succeed(f.seq));
      return true;
    },
    drop: () => {
      for (const w of waiting.values()) w.settle(unsure("the connection dropped"));
      waiting.clear();
    },
  };
}

export function ownMessage(p: unknown, seq: number, rts: number): Message | null {
  if (!wellFormed(p)) return null;
  const imgs = Array.isArray(p.imgs) ? p.imgs.filter(rasterAttachment) : undefined;
  return { ...p, ...(imgs?.length ? { imgs } : { imgs: undefined }), seq, rts, sigOk: true };
}

const PING_EVERY = "25 seconds";
const PONG_WAIT = "10 seconds";

export const keepAlive = (sock: { ping: () => boolean; heard: () => number; silent: () => void }) =>
  Effect.gen(function* () {
    yield* Effect.sleep(PING_EVERY);
    const before = sock.heard();
    if (!sock.ping()) return;
    yield* Effect.sleep(PONG_WAIT);
    if (sock.heard() === before) sock.silent();
  }).pipe(Effect.forever);

export interface Probe {
  readonly head: number;
  readonly changes: number;
}

export function wireOf(ws: WebSocket, since: number) {
  let head = since;
  let ready = false;
  let changes = 0;
  let sent = 0;
  let answered = 0;
  let heard = 0;
  const waiting = new Set<{ n: number; done: (p: Probe | null) => void }>();
  const ping = (): boolean => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(PING);
    sent++;
    return true;
  };
  const settle = (all: boolean): void => {
    for (const w of [...waiting]) {
      if (!all && w.n > answered) continue;
      waiting.delete(w);
      w.done(all || !ready ? null : { head, changes });
    }
  };
  return {
    ping,
    heard: () => heard,
    closed: () => {
      ready = false;
      settle(true);
    },
    frame: (f: ServerFrame | { t: "pong" }): void => {
      heard++;
      if (f.t === "msg") head = Number.isSafeInteger(f.seq) ? Math.max(head, f.seq) : head;
      else if (f.t === "ready") {
        if (Number.isSafeInteger(f.head) && f.head > head) head = f.head;
        ready = !f.more;
      } else if (f.t === "roster" || f.t === "info" || f.t === "epoch") changes++;
      else if (f.t === "pong") {
        answered++;
        settle(false);
      }
    },
    probe: (ms: number): Promise<Probe | null> =>
      new Promise<Probe | null>((resolve) => {
        if (!ready || !ping()) return resolve(null);
        const timer = setTimeout(() => {
          waiting.delete(w);
          resolve(null);
        }, ms);
        const w = {
          n: sent,
          done: (p: Probe | null) => {
            clearTimeout(timer);
            resolve(p);
          },
        };
        waiting.add(w);
      }),
  };
}

export function markOn(ws: WebSocket): (seq: number) => boolean {
  return (seq) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ t: "read", seq }));
    return true;
  };
}
