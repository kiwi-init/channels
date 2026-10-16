import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import { PING, rasterAttachment, wellFormed, type Message, type ServerFrame } from "../protocol.ts";
import { Unreachable, type ChannelGone, type Dropped } from "./errors.ts";
import type { PresenceFields } from "./live.ts";

export type Incoming =
  | ServerFrame
  | { t: "pong" }
  | { t: "own"; seq: number; ts: number; payload: unknown }
  | { t: "open"; presence: (p: PresenceFields) => Effect.Effect<void>; mark: (seq: number) => boolean };

export type Inbox = Queue.Queue<Incoming, Dropped | ChannelGone | Cause.Done>;

export interface Wire {
  send: (sealed: { iv: string; ct: string }, e: number, payload: object) => Effect.Effect<number | null, Unreachable>;
  answer: (f: ServerFrame | { t: "pong" }) => boolean;
  drop: () => void;
}

const ACK_WAIT_MS = 30_000;

export function wireOn(ws: WebSocket, q: Inbox): Wire {
  const waiting = new Map<string, { payload: object; settle: (r: Effect.Effect<number | null, Unreachable>) => void }>();
  const unsure = (why: string) => Effect.fail(new Unreachable({ cause: new Error(`${why} before the relay confirmed the message; it may still have been sent`) }));
  return {
    send: (sealed, e, payload) =>
      Effect.callback<number | null, Unreachable>((resume) => {
        if (ws.readyState !== WebSocket.OPEN) return resume(Effect.succeed(null));
        const id = crypto.randomUUID();
        try {
          ws.send(JSON.stringify({ t: "send", id, iv: sealed.iv, ct: sealed.ct, e }));
        } catch {
          return resume(Effect.succeed(null));
        }
        let pending = true;
        const timer = setTimeout(() => settle(unsure("no answer in time")), ACK_WAIT_MS);
        const settle = (r: Effect.Effect<number | null, Unreachable>) => {
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
        w.settle(Effect.succeed(null));
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

export const keepAlive = (ws: WebSocket) =>
  Effect.sleep("25 seconds").pipe(
    Effect.andThen(Effect.sync(() => ws.readyState === WebSocket.OPEN && ws.send(PING))),
    Effect.forever,
  );

export function markOn(ws: WebSocket): (seq: number) => boolean {
  return (seq) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ t: "read", seq }));
    return true;
  };
}
