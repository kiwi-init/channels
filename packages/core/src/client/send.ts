import * as Effect from "effect/Effect";
import { seal, slotId } from "../crypto.ts";
import { sign, verify } from "../identity.ts";
import {
  CHOICE_MAX_LENGTH,
  CHOICES_MAX,
  CHOICES_MIN,
  GENERAL_ROOM,
  isRasterMime,
  MAX_IMAGES,
  PROTOCOL_VERSION,
  rasterAttachment,
  wellFormed,
  wellFormedChoices,
  wellFormedHandoff,
  type Event,
  type Handoff,
  type ImageAttachment,
  type Kind,
  type Message,
  type Payload,
} from "../protocol.ts";
import { MissingKey, Rejected } from "../refusals.ts";
import type { ChannelCore } from "./core.ts";
import { RelayError, type Refused } from "./errors.ts";
import { received } from "./history.ts";
import type { ChannelImages } from "./images.ts";
import type { ChannelLive } from "./live.ts";
import type { Relay } from "./relay.ts";
import type { ChannelSettings } from "./settings.ts";

export interface SendOptions {
  to?: string[];
  kind?: Kind;
  re?: number[];
  ev?: Event;
  imgs?: ImageAttachment[];
  room?: string;
  esc?: boolean;
  handoff?: Handoff;
  choices?: string[];
  task?: number;
  dm?: boolean;
  slot?: { name: string; ttl: number };
  free?: string[];
}

export interface SendFx {
  send(body: string, opts?: SendOptions): Effect.Effect<number, Refused, Relay>;
}

export class ChannelSending {
  onSent: ((seq: number, message: Message | null) => void) | null = null;

  constructor(
    private readonly ch: ChannelCore,
    private readonly live: ChannelLive,
    private readonly settings: ChannelSettings,
    private readonly images: ChannelImages,
  ) {}

  readonly fx: SendFx = {
    send: Effect.fn("Channel.send")({ self: this }, function* (this: ChannelSending, body: string, opts: SendOptions = {}) {
      const imgs = opts.imgs?.slice(0, MAX_IMAGES);
      if (imgs?.some((i) => !isRasterMime(i.mime))) return yield* new Rejected("an image must be png, jpg, gif or webp");
      if (imgs?.some((i) => !rasterAttachment(i))) return yield* new Rejected("an image needs its bytes or a stored reference");
      if (opts.handoff && (!opts.esc || !wellFormedHandoff(opts.handoff))) return yield* new Rejected("a browser handoff goes only on an escalation, with an https link, a vendor and an expiry");
      if (opts.choices && (!opts.esc || opts.handoff || !wellFormedChoices(opts.choices)))
        return yield* new Rejected(`options go only on an escalation without a browser link: ${CHOICES_MIN} to ${CHOICES_MAX} different ones, one line of up to ${CHOICE_MAX_LENGTH} characters each`);
      const attached = imgs?.length ? yield* this.images.stored(imgs) : undefined;
      const payload: Payload = {
        v: PROTOCOL_VERSION,
        id: crypto.randomUUID(),
        from: this.ch.name,
        ...(opts.to?.length ? { to: opts.to } : {}),
        kind: opts.kind ?? (opts.ev ? "event" : "msg"),
        body,
        ...(opts.re?.length ? { re: opts.re } : {}),
        ...(opts.ev ? { ev: opts.ev } : {}),
        ...(attached?.length ? { imgs: attached } : {}),
        ...(opts.room && opts.room !== GENERAL_ROOM && !opts.ev ? { room: opts.room } : {}),
        ...(opts.esc && !opts.ev ? { esc: true as const } : {}),
        ...(opts.esc && opts.handoff && !opts.ev ? { handoff: opts.handoff } : {}),
        ...(opts.esc && opts.choices && !opts.ev ? { choices: opts.choices } : {}),
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
        return { e, key, sealed: yield* Effect.promise(() => seal(key, this.ch.roomId, signed, { pack: this.settings.packs })) };
      });
      const take = opts.slot;
      const freeing = opts.free ?? [];
      const slotted = !!take || freeing.length > 0;
      const post = Effect.gen({ self: this }, function* () {
        const { e, key, sealed } = yield* sealNow;
        const roomId = this.ch.roomId;
        const slot = take ? { slot: { id: yield* Effect.promise(() => slotId(key, roomId, take.name)), ttl: take.ttl } } : {};
        const free = freeing.length ? { free: yield* Effect.promise(() => Promise.all(freeing.map((n) => slotId(key, roomId, n)))) } : {};
        return yield* this.ch.request<{ seq: number; ts?: number }>("/messages", { method: "POST", body: JSON.stringify({ ...sealed, e, ...slot, ...free }) });
      });
      const posted = Effect.gen({ self: this }, function* () {
        const stored = yield* post.pipe(
          Effect.catchIf(
            (err) => err instanceof RelayError && err.status === 409,
            () => Effect.andThen(this.ch.fx.refreshKeys(), post),
          ),
        );
        if (this.onSent) {
          const p: unknown = JSON.parse(JSON.stringify(signed));
          const kept = typeof stored.ts === "number" && Number.isFinite(stored.ts) && wellFormed(p) ? received(p, stored.seq, stored.ts, yield* Effect.promise(() => verify(p))) : null;
          this.onSent(stored.seq, kept);
        }
        return stored.seq;
      });
      const wire = slotted ? undefined : [...this.live.wires].at(-1);
      if (!wire) return yield* posted;
      const { e, sealed } = yield* sealNow;
      const acked = yield* wire.send(sealed, e, signed);
      if (acked === null) return yield* posted;
      this.onSent?.(acked, null);
      return acked;
    }),
  };
}
