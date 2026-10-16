import * as Effect from "effect/Effect";
import { seal } from "../crypto.ts";
import { sign, verify } from "../identity.ts";
import { GENERAL_ROOM, isRasterMime, MAX_IMAGES, PROTOCOL_VERSION, wellFormed, type Event, type ImageAttachment, type Kind, type Message, type Payload } from "../protocol.ts";
import { MissingKey, Rejected } from "../refusals.ts";
import type { ChannelCore } from "./core.ts";
import { RelayError, type Refused } from "./errors.ts";
import { received } from "./history.ts";
import type { ChannelLive } from "./live.ts";
import type { Relay } from "./relay.ts";

export interface SendOptions {
  to?: string[];
  kind?: Kind;
  re?: number[];
  ev?: Event;
  imgs?: ImageAttachment[];
  room?: string;
  esc?: boolean;
  task?: number;
  dm?: boolean;
}

export interface SendFx {
  send(body: string, opts?: SendOptions): Effect.Effect<number, Refused, Relay>;
}

export class ChannelSending {
  onSent: ((seq: number, message: Message | null) => void) | null = null;

  constructor(
    private readonly ch: ChannelCore,
    private readonly live: ChannelLive,
  ) {}

  readonly fx: SendFx = {
    send: Effect.fn("Channel.send")({ self: this }, function* (this: ChannelSending, body: string, opts: SendOptions = {}) {
      const imgs = opts.imgs?.slice(0, MAX_IMAGES);
      if (imgs?.some((i) => !isRasterMime(i.mime))) return yield* new Rejected("an image must be png, jpg, gif or webp");
      const payload: Payload = {
        v: PROTOCOL_VERSION,
        id: crypto.randomUUID(),
        from: this.ch.name,
        ...(opts.to?.length ? { to: opts.to } : {}),
        kind: opts.kind ?? (opts.ev ? "event" : "msg"),
        body,
        ...(opts.re?.length ? { re: opts.re } : {}),
        ...(opts.ev ? { ev: opts.ev } : {}),
        ...(imgs?.length ? { imgs } : {}),
        ...(opts.room && opts.room !== GENERAL_ROOM && !opts.ev ? { room: opts.room } : {}),
        ...(opts.esc && !opts.ev ? { esc: true as const } : {}),
        ...(opts.task && !opts.ev ? { task: opts.task } : {}),
        ...(opts.dm && !opts.ev && opts.to?.length === 1 ? { dm: true as const } : {}),
        ts: Date.now(),
      };
      const signed = yield* Effect.promise(() => sign(this.ch.identity, payload));
      const sealNow = Effect.gen({ self: this }, function* () {
        if (!this.ch.access.keys[String(this.ch.access.epoch)]) yield* this.ch.fx.refreshKeys();
        const e = this.ch.access.epoch;
        const key = this.ch.access.keys[String(e)];
        if (!key) return yield* new MissingKey(`no key for epoch ${e}`);
        return { e, sealed: yield* Effect.promise(() => seal(key, this.ch.roomId, signed)) };
      });
      const post = Effect.gen({ self: this }, function* () {
        const { e, sealed } = yield* sealNow;
        return yield* this.ch.request<{ seq: number; ts?: number }>("/messages", { method: "POST", body: JSON.stringify({ ...sealed, e }) });
      });
      const posted = Effect.gen({ self: this }, function* () {
        const stored = yield* post.pipe(Effect.catchIf((err) => err instanceof RelayError && err.status === 409, () => Effect.andThen(this.ch.fx.refreshKeys(), post)));
        if (this.onSent) {
          const p: unknown = JSON.parse(JSON.stringify(signed));
          const kept = typeof stored.ts === "number" && Number.isFinite(stored.ts) && wellFormed(p) ? received(p, stored.seq, stored.ts, yield* Effect.promise(() => verify(p))) : null;
          this.onSent(stored.seq, kept);
        }
        return stored.seq;
      });
      const wire = [...this.live.wires].at(-1);
      if (!wire) return yield* posted;
      const { e, sealed } = yield* sealNow;
      const acked = yield* wire.send(sealed, e, signed);
      if (acked === null) return yield* posted;
      this.onSent?.(acked, null);
      return acked;
    }),
  };
}
