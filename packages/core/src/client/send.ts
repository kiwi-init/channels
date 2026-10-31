import * as Effect from "effect/Effect";
import { b64url, seal, slotId } from "../crypto.ts";
import { sign, verify } from "../identity.ts";
import {
  CHOICE_MAX_LENGTH,
  CHOICES_MAX,
  CHOICES_MIN,
  DECISION_KINDS,
  decisionNeedsStep,
  GENERAL_ROOM,
  isDecisionKind,
  isRasterMime,
  MAX_BODY_LENGTH,
  MAX_HOLDS,
  MAX_IMAGES,
  EVENT_OPS_VERSION,
  OVERLAY_OPS,
  PROTOCOL_VERSION,
  rasterAttachment,
  wellFormed,
  wellFormedChoices,
  wellFormedHandoff,
  wellFormedHolds,
  type DecisionKind,
  type Event,
  type Handoff,
  type ImageAttachment,
  type Kind,
  type Message,
  type Payload,
  type Step,
  type StepReply,
} from "../protocol.ts";
import type { PermissionReply, PermissionSettled, PermissionShown } from "../permission.ts";
import { MissingKey, Rejected } from "../refusals.ts";
import type { ChannelCore } from "./core.ts";
import { RelayError, Unreachable, type Refused } from "./errors.ts";
import { received } from "./history.ts";
import type { ChannelImages } from "./images.ts";
import type { ChannelLive } from "./live.ts";
import type { Relay } from "./relay.ts";
import type { ChannelSettings } from "./settings.ts";

const PRIVATE_EVENTS = "a private room keeps to messages, reactions, edits and deletes: post tasks, notes and other channel events outside it, where everyone sees them";
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
  holds?: number[];
  decision?: DecisionKind;
  step?: Step;
  stepReply?: StepReply;
  id?: string;
  permission?: PermissionShown;
  perm?: PermissionReply;
  settled?: PermissionSettled;
  task?: number;
  dm?: boolean;
  slot?: { name: string; ttl: number };
  free?: string[];
}

export interface SendFx {
  send(body: string, opts?: SendOptions): Effect.Effect<number, Refused, Relay>;
}

const RATE_RETRIES = 2;
const UNSURE_RETRIES = 2;
const RATE_WAIT_MAX_S = 60;

const rateWait = (err: unknown): number | null => (err instanceof RelayError && err.status === 429 && err.retryAfter !== null && err.retryAfter <= RATE_WAIT_MAX_S ? err.retryAfter : null);

const behind = (err: unknown, held: number): Rejected | null => {
  const named = err instanceof RelayError && err.status === 409 ? Number(/current is (\d+)$/.exec(err.message)?.[1]) : NaN;
  return Number.isSafeInteger(named) && named < held
    ? new Rejected(`the relay is behind this channel's key (it says epoch ${named}, this device holds ${held}): it may have been restored from a backup`)
    : null;
};

const unsure = (err: unknown): boolean => err instanceof Unreachable || (err instanceof RelayError && err.status === 503);

const again = <A, E, R>(attempt: Effect.Effect<A, E, R>, left: number, wait = 1): Effect.Effect<A, E, R> =>
  Effect.catchIf(
    attempt,
    (err) => left > 0 && unsure(err),
    () => Effect.andThen(Effect.sleep(`${wait} seconds`), again(attempt, left - 1, wait * 2)),
  );

const patient = <A, E, R>(attempt: Effect.Effect<A, E, R>, left: number): Effect.Effect<A, E, R> =>
  Effect.catchIf(
    attempt,
    (err) => left > 0 && rateWait(err) !== null,
    (err) => Effect.andThen(Effect.sleep(`${rateWait(err) ?? 0} seconds`), patient(attempt, left - 1)),
  );

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
      if (body.length > MAX_BODY_LENGTH) return yield* new Rejected(`a message is at most ${MAX_BODY_LENGTH.toLocaleString("en")} characters; this one is ${body.length.toLocaleString("en")}`);
      const imgs = opts.imgs?.slice(0, MAX_IMAGES);
      if (imgs?.some((i) => !isRasterMime(i.mime))) return yield* new Rejected("an image must be png, jpg, gif or webp");
      if (imgs?.some((i) => !rasterAttachment(i))) return yield* new Rejected("an image needs its bytes or a stored reference");
      if (opts.handoff && (!opts.esc || !wellFormedHandoff(opts.handoff))) return yield* new Rejected("a browser handoff goes only on an escalation, with an https link, a vendor and an expiry");
      if (opts.choices && (!opts.esc || opts.handoff || !wellFormedChoices(opts.choices)))
        return yield* new Rejected(`options go only on an escalation without a browser link: ${CHOICES_MIN} to ${CHOICES_MAX} different ones, one line of up to ${CHOICE_MAX_LENGTH} characters each`);
      if (decisionNeedsStep(opts.choices))
        return yield* new Rejected(
          "Done and Not yet ask a person to act, not decide, and give no command or link: use --step with --holds, --why, --needs-person and at least one --do, --run or --link",
        );
      if (opts.holds && (!opts.esc || !wellFormedHolds(opts.holds))) return yield* new Rejected(`what an escalation holds is 1 to ${MAX_HOLDS} task or ask numbers, on an escalation only`);
      if (opts.decision && (!opts.esc || !isDecisionKind(opts.decision))) return yield* new Rejected(`a decision's kind is one of ${DECISION_KINDS.join(", ")}, on an escalation only`);
      if (opts.step && (!opts.esc || opts.ev || opts.handoff || opts.choices || opts.decision))
        return yield* new Rejected("a step goes only on an escalation, without a decision kind, options or browser handoff");
      if (opts.stepReply && (!opts.re?.length || opts.ev)) return yield* new Rejected("a step answer goes on a reply to its step");
      if (opts.id !== undefined && opts.id.length > 100) return yield* new Rejected("a message id is at most 100 characters");
      const attached = imgs?.length ? yield* this.images.stored(imgs) : undefined;
      const payload: Payload = {
        v: PROTOCOL_VERSION,
        id: opts.id ?? crypto.randomUUID(),
        from: this.ch.name,
        ops: EVENT_OPS_VERSION,
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
        ...(opts.esc && opts.holds?.length && !opts.ev ? { holds: opts.holds } : {}),
        ...(opts.esc && opts.decision && !opts.ev ? { decision: opts.decision } : {}),
        ...(opts.esc && opts.step && !opts.ev ? { step: opts.step } : {}),
        ...(opts.stepReply && opts.re?.length && !opts.ev ? { stepReply: opts.stepReply } : {}),
        ...(opts.esc && opts.choices && opts.permission && !opts.ev ? { permission: opts.permission } : {}),
        ...(opts.perm && opts.re?.length && !opts.ev ? { perm: opts.perm } : {}),
        ...(opts.settled && opts.re?.length && !opts.ev ? { settled: opts.settled } : {}),
        ...(opts.task && !opts.ev ? { task: opts.task } : {}),
        ...(opts.dm && !opts.ev && opts.to?.length === 1 ? { dm: true as const } : {}),
        ts: Date.now(),
      };
      if (payload.step && !wellFormed(payload))
        return yield* new Rejected(
          "a step needs what it holds, why, why a person must do it, and at least one instruction, command or https link; it has no decision kind, options or browser handoff",
        );
      if (payload.stepReply && !wellFormed(payload)) return yield* new Rejected("a step answer needs a reply target and either Done with optional output, or Can't do it or Not needed with a reason");
      if ((payload.permission || payload.perm || payload.settled) && !wellFormed(payload)) return yield* new Rejected("a permission prompt, its answer or its close is malformed");
      const now = opts.room ? this.ch.roomNow.get(opts.room) : undefined;
      const n = now?.n;
      const roomKey = now?.key;
      if (now && !roomKey) return yield* new Rejected("you're not in that private room anymore");
      if (roomKey && ((opts.ev && !OVERLAY_OPS.has(opts.ev.op)) || opts.task)) return yield* new Rejected(PRIVATE_EVENTS);
      const inner = yield* Effect.promise(() => sign(this.ch.identity, payload));
      const signed =
        roomKey && opts.room && n
          ? yield* Effect.promise(async () =>
              sign(this.ch.identity, {
                v: PROTOCOL_VERSION,
                id: crypto.randomUUID(),
                from: this.ch.name,
                ops: EVENT_OPS_VERSION,
                kind: "event",
                body: "A message in a private room. Update Kiwi to read it.",
                ev: { op: "room.msg", ...(await (await import("../private-room.ts")).sealLetter(this.ch.roomId, opts.room!, n, roomKey, inner)) },
                ts: payload.ts,
              }),
            )
          : inner;
      const cid = b64url(crypto.getRandomValues(new Uint8Array(16)));
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
        return yield* this.ch.request<{ seq: number; ts?: number }>("/messages", { method: "POST", body: JSON.stringify({ ...sealed, e, ...slot, ...free, cid }) });
      });
      const posted = Effect.gen({ self: this }, function* () {
        const stored = yield* again(post, UNSURE_RETRIES).pipe(
          Effect.catchIf(
            (err) => err instanceof RelayError && err.status === 409,
            () => Effect.andThen(this.ch.fx.refreshKeys(), post).pipe(Effect.mapError((err) => behind(err, this.ch.access.epoch) ?? err)),
          ),
        );
        if (this.onSent) {
          const p: unknown = JSON.parse(JSON.stringify(signed));
          const got = typeof stored.ts === "number" && Number.isFinite(stored.ts) && wellFormed(p) ? received(p, stored.seq, stored.ts, yield* Effect.promise(() => verify(p))) : null;
          const open = got && (yield* this.ch.fx.unseal(got));
          const kept = open && (yield* this.ch.fx.settle(open));
          this.onSent(stored.seq, kept);
        }
        return stored.seq;
      });
      const once = Effect.gen({ self: this }, function* () {
        const wire = slotted ? undefined : [...this.live.wires].at(-1);
        if (!wire) return yield* posted;
        const { e, sealed } = yield* sealNow;
        const acked = yield* wire.send(sealed, e, signed, cid).pipe(
          Effect.catchIf(
            (err) => err instanceof Unreachable,
            () => Effect.succeed(null),
          ),
        );
        if (acked === null) return yield* posted;
        this.onSent?.(acked, null);
        return acked;
      });
      return yield* patient(once, RATE_RETRIES);
    }),
  };
}
