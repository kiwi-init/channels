import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { signRequest } from "../auth.ts";
import { open, seal } from "../crypto.ts";
import { sign, verify } from "../identity.ts";
import { inlineText } from "../membership.ts";
import {
  CLOSE_CLOSED,
  CLOSE_REMOVED,
  cleanActivity,
  goneHow,
  isReach,
  PROTOCOL_VERSION,
  WS_PROTOCOL,
  wellFormedRead,
  type Message,
  type Presence,
  type ReadMark,
  type ServerFrame,
} from "../protocol.ts";
import type { ChannelCore } from "./core.ts";
import { ChannelGone, Dropped, Unreachable } from "./errors.ts";
import type { ChannelInfo } from "./info.ts";
import type { Relay } from "./relay.ts";
import { keepAlive, markOn, ownMessage, wireOn, type Inbox, type Incoming, type Wire } from "./wire.ts";

export interface StreamOptions {
  signal?: AbortSignal;
  onReady?: (head: number) => void;
  onStatus?: (s: string) => void;
  quietMs?: number;
  now?: () => number;
  onOpen?: (live: { presence: (p: PresenceFields) => Promise<void>; mark: (seq: number) => boolean }) => void;
  onPresence?: (p: Presence & { sigOk: boolean }) => void;
  onInfo?: () => void;
  onRoster?: () => void;
  onRequest?: () => void;
}

export type PresenceFields = Omit<Presence, "v" | "type" | "from" | "ts">;

export type Live =
  | {
      readonly _tag: "Open";
      readonly presence: (p: PresenceFields) => Effect.Effect<void>;
      readonly mark: (seq: number) => boolean;
      readonly outage: number | null;
    }
  | { readonly _tag: "Ready"; readonly head: number }
  | { readonly _tag: "Message"; readonly message: Message }
  | { readonly _tag: "Presence"; readonly presence: Presence & { sigOk: boolean } }
  | { readonly _tag: "Read"; readonly reads: readonly ReadMark[]; readonly snapshot: boolean }
  | { readonly _tag: "Info" | "Roster" | "Request" }
  | { readonly _tag: "Down"; readonly after: number; readonly code: number; readonly reason: string }
  | { readonly _tag: "Skipped"; readonly frame: string; readonly error: unknown };

export interface LiveOptions {
  quietMs?: number;
  presence?: boolean;
  reads?: boolean;
  send?: boolean;
}

export const QUIET_DROP_MS = 30_000;

const backoff = Schedule.min([Schedule.exponential("500 millis"), Schedule.spaced("30 seconds")]);

const outlasted = ({ attempt, elapsed, elapsedSincePrevious }: Schedule.InputMetadata<unknown>, quietMs: number) =>
  elapsed >= quietMs && (attempt === 1 || elapsed - elapsedSincePrevious < quietMs);

const tick = Effect.callback<void>((resume) => {
  const t = setTimeout(() => resume(Effect.void), 10);
  return Effect.sync(() => clearTimeout(t));
});

function clockFrom(now: () => number): Clock.Clock {
  const nanos = () => BigInt(now()) * 1_000_000n;
  const until = (end: number): Effect.Effect<void> => Effect.suspend(() => (now() >= end ? Effect.void : Effect.andThen(tick, until(end))));
  return {
    currentTimeMillisUnsafe: now,
    currentTimeMillis: Effect.sync(now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: (d) => Effect.suspend(() => until(now() + Duration.toMillis(d))),
  };
}

const FRAME: Record<Live["_tag"], string> = { Open: "open", Ready: "ready", Message: "msg", Presence: "eph", Info: "info", Roster: "roster", Request: "request", Read: "read", Down: "status", Skipped: "status" };
const failedFrame = (frame: string, err: unknown) => `dropped a ${frame} frame whose handling failed: ${reason(err)}`;

export function reason(err: unknown): string {
  const e = err instanceof Unreachable ? err.cause : err;
  return e instanceof Error ? e.message : String(e);
}

function statusLine(ev: Live): string | null {
  switch (ev._tag) {
    case "Open":
      return ev.outage !== null ? `reconnected after ${Math.round(ev.outage / 1000)}s; nothing was missed` : null;
    case "Down":
      return `can't reach the relay for ${Math.round(ev.after / 1000)}s (${ev.code}${ev.reason ? ` ${ev.reason}` : ""}); still retrying`;
    case "Skipped":
      return failedFrame(ev.frame, ev.error);
    default:
      return null;
  }
}

export const eachLive = <E, R, R2>(live: Stream.Stream<Live, E, R>, handle: (ev: Live) => Effect.Effect<void, unknown, R2>, status: (line: string) => Effect.Effect<void, never, R2>) =>
  Stream.runForEach(live, (ev) => {
    const line = statusLine(ev);
    return (line === null ? handle(ev) : Effect.andThen(status(line), handle(ev))).pipe(
      Effect.catchCause((cause) => status(failedFrame(FRAME[ev._tag], Cause.squash(cause)))),
      Effect.uninterruptible,
    );
  });

export interface LiveFx {
  live(since: number, opts?: LiveOptions): Stream.Stream<Live, ChannelGone, Relay>;
  stream(since: number, onMessage: (m: Message) => void | Promise<void>, opts?: StreamOptions): Effect.Effect<void, ChannelGone, Relay>;
}

export class ChannelLive {
  readonly wires = new Set<Wire>();

  constructor(
    private readonly ch: ChannelCore,
    private readonly info: ChannelInfo,
  ) {}

  readonly fx: LiveFx = {
    live: (since: number, opts: LiveOptions = {}) => this.live(since, opts),

    stream: Effect.fn("Channel.stream")({ self: this }, function* (this: ChannelLive, since: number, onMessage: (m: Message) => void | Promise<void>, opts: StreamOptions = {}) {
      const handle = (ev: Live): Effect.Effect<void> => {
        switch (ev._tag) {
          case "Open":
            return Effect.sync(() => opts.onOpen?.({ presence: (p) => Effect.runPromise(ev.presence(p)), mark: ev.mark }));
          case "Ready":
            return Effect.sync(() => opts.onReady?.(ev.head));
          case "Message":
            return Effect.promise(async () => onMessage(ev.message));
          case "Presence":
            return Effect.sync(() => opts.onPresence?.(ev.presence));
          case "Info":
            return Effect.sync(() => opts.onInfo?.());
          case "Roster":
            return Effect.sync(() => opts.onRoster?.());
          case "Request":
            return Effect.sync(() => opts.onRequest?.());
          default:
            return Effect.void;
        }
      };
      const listening = eachLive(this.ch.fx.live(since, { quietMs: opts.quietMs, presence: !!opts.onPresence, reads: false }), handle, (s) => Effect.sync(() => opts.onStatus?.(s)));
      return yield* opts.now ? Effect.provideService(listening, Clock.Clock, clockFrom(opts.now)) : listening;
    }),
  };

  private live(since: number, { quietMs = QUIET_DROP_MS, presence = true, reads = true, send = false }: LiveOptions): Stream.Stream<Live, ChannelGone, Relay> {
    const at = { seq: since };
    return Stream.callback<Live, ChannelGone, Relay>((out) =>
      Stream.suspend(() => this.session(at, quietMs, presence, reads, send)).pipe(
        Stream.retry(this.reconnect(out, quietMs)),
        Stream.catchTag("Dropped", (d) => Stream.die(d)),
        Stream.forever,
        Stream.runIntoQueue(out),
      ),
    );
  }

  private reconnect(out: Queue.Queue<Live, ChannelGone | Cause.Done>, quietMs: number) {
    return backoff.pipe(
      Schedule.setInputType<Dropped | ChannelGone>(),
      Schedule.while(({ input }) => input instanceof Dropped),
      Schedule.tap((meta) =>
        meta.input instanceof Dropped && outlasted(meta, quietMs) ? Queue.offer(out, { _tag: "Down", after: meta.elapsed, code: meta.input.code, reason: meta.input.reason }) : Effect.void,
      ),
      Schedule.tap(() => this.stillIn()),
    );
  }

  private stillIn(): Effect.Effect<void, ChannelGone, Relay> {
    return Effect.flatMap(Effect.exit(this.ch.fx.head()), (exit) => {
      const err = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
      return err instanceof ChannelGone ? Effect.fail(err) : Effect.void;
    });
  }

  private session(at: { seq: number }, quietMs: number, presence: boolean, reads: boolean, send: boolean): Stream.Stream<Live, Dropped | ChannelGone, Relay> {
    return Stream.callback<Incoming, Dropped | ChannelGone, Relay>((q) => this.socket(at.seq, presence, reads, q, send)).pipe(
      Stream.mapEffect((f) =>
        this.read(f, at, quietMs, presence, reads).pipe(Effect.catchCause((cause) => Effect.succeed<Live>({ _tag: "Skipped", frame: f.t, error: Cause.squash(cause) }))),
      ),
      Stream.filter((x): x is Live => x !== null),
    );
  }

  private socket(since: number, presence: boolean, reads: boolean, q: Inbox, send: boolean) {
    return Effect.gen({ self: this }, function* () {
      const auth = yield* Effect.promise(() => signRequest(this.ch.identity, this.ch.roomId, "GET", "/ws"));
      const u = new URL(`/v1/rooms/${this.ch.roomId}/ws`, this.ch.relay);
      u.searchParams.set("since", String(since));
      if (!presence) u.searchParams.set("presence", "0");
      if (!reads) u.searchParams.set("reads", "0");
      if (send) u.searchParams.set("echo", "0");
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      const { ws, closed } = yield* Effect.acquireRelease(
        Effect.sync(() => this.connect(u, auth, q, send)),
        ({ ws }) => Effect.sync(() => ws.close(1000, "aborted")),
      );
      yield* Effect.forkScoped(keepAlive(ws));
      const { code, reason } = yield* Effect.promise(() => closed);
      if (code === 4000) return yield* Queue.end(q);
      if (code === CLOSE_REMOVED) return yield* Queue.fail(q, new ChannelGone("removed", goneHow(reason)));
      if (code === CLOSE_CLOSED) return yield* Queue.fail(q, new ChannelGone("closed"));
      return yield* Queue.fail(q, new Dropped({ code, reason }));
    });
  }

  private connect(u: URL, auth: string, q: Inbox, send: boolean) {
    const ws = new WebSocket(u, [WS_PROTOCOL, auth]);
    const wire = send ? wireOn(ws, q) : null;
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.onclose = (ev) => {
        if (wire) {
          this.wires.delete(wire);
          wire.drop();
        }
        resolve({ code: ev.code, reason: ev.reason });
      };
    });
    ws.onerror = () => {};
    ws.onopen = () => void Queue.offerUnsafe(q, { t: "open", presence: this.presenceOn(ws), mark: markOn(ws) });
    ws.onmessage = (ev) => {
      let f: ServerFrame | { t: "pong" };
      try {
        f = JSON.parse(String(ev.data)) as ServerFrame | { t: "pong" };
      } catch {
        return;
      }
      if (wire?.answer(f)) return;
      Queue.offerUnsafe(q, f);
      if (f.t === "ready" && f.more) ws.close(4000, "more");
      else if (f.t === "ready" && wire) this.wires.add(wire);
    };
    return { ws, closed };
  }

  private presenceOn(ws: WebSocket) {
    return (p: PresenceFields): Effect.Effect<void> =>
      Effect.gen({ self: this }, function* () {
        if (ws.readyState !== WebSocket.OPEN) return;
        const full = yield* Effect.promise(() => sign(this.ch.identity, { v: PROTOCOL_VERSION, type: "presence", from: this.ch.name, ts: Date.now(), ...p } as Presence));
        const e = this.ch.access.epoch;
        const sealed = yield* Effect.promise(() => seal(this.ch.access.keys[String(e)]!, this.ch.roomId, { ...full, e }));
        ws.send(JSON.stringify({ t: "eph", ...sealed }));
      });
  }

  private read(f: Incoming, at: { seq: number }, quietMs: number, presence: boolean, reads: boolean): Effect.Effect<Live | null, never, Relay> {
    return Effect.gen({ self: this }, function* () {
      switch (f.t) {
        case "open": {
          const { attempt, elapsed, start } = yield* Schedule.CurrentMetadata;
          if (attempt > 0) this.info.forgetInfo();
          const now = yield* Clock.currentTimeMillis;
          return { _tag: "Open", presence: f.presence, mark: f.mark, outage: attempt > 0 && elapsed >= quietMs ? now - start : null } satisfies Live;
        }
        case "msg": {
          if (f.seq <= at.seq) return null;
          const m = yield* this.ch.fx.decrypt(f);
          at.seq = f.seq;
          return m && ({ _tag: "Message", message: m } satisfies Live);
        }
        case "own": {
          if (f.seq <= at.seq) return null;
          at.seq = f.seq;
          const m = ownMessage(f.payload, f.seq, f.ts);
          return m && ({ _tag: "Message", message: m } satisfies Live);
        }
        case "eph":
          return presence ? yield* this.presenceIn(f) : null;
        case "epoch":
          this.info.forgetInfo();
          yield* Effect.ignoreCause(this.ch.fx.refreshKeys());
          return null;
        case "info":
          this.info.forgetInfo();
          return { _tag: "Info" } satisfies Live;
        case "roster":
          return { _tag: "Roster" } satisfies Live;
        case "request":
          return { _tag: "Request" } satisfies Live;
        case "ready":
          return { _tag: "Ready", head: f.head } satisfies Live;
        case "read": {
          if (!reads) return null;
          const mark = wellFormedRead(f);
          return mark && ({ _tag: "Read", reads: [mark], snapshot: false } satisfies Live);
        }
        case "reads": {
          if (!reads) return null;
          const marks = Array.isArray(f.reads) ? f.reads.map(wellFormedRead).filter((r): r is ReadMark => r !== null) : [];
          return { _tag: "Read", reads: marks, snapshot: true } satisfies Live;
        }
        default:
          return null;
      }
    });
  }

  private presenceIn(f: { iv: string; ct: string }): Effect.Effect<Live | null> {
    return Effect.gen({ self: this }, function* () {
      for (const k of Object.values(this.ch.access.keys).reverse()) {
        const p = (yield* Effect.promise(() => open(k, this.ch.roomId, f.iv, f.ct))) as (Presence & { e?: number }) | null;
        if (p?.type === "presence" && typeof p.from === "string") {
          const { e: _e, ...rest } = p;
          const sigOk = yield* Effect.promise(() => verify(rest));
          const role = typeof rest.role === "string" ? inlineText(rest.role, 80) || undefined : undefined;
          const { activity: said, reach, ...fields } = rest;
          const activity = cleanActivity(said);
          return {
            _tag: "Presence",
            presence: { ...fields, ...(typeof rest.role === "string" ? { role } : {}), ...(activity ? { activity } : {}), ...(isReach(reach) ? { reach } : {}), sigOk },
          } satisfies Live;
        }
      }
      return null;
    });
  }
}
