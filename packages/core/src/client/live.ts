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
import { omit } from "../omit.ts";
import {
  CLOSE_CLOSED,
  CLOSE_REMOVED,
  cleanActivity,
  goneHow,
  isReach,
  MORE_REFUSED,
  EVENT_OPS_VERSION,
  PROTOCOL_VERSION,
  WS_PROTOCOL,
  wellFormedRead,
  type Envelope,
  type Message,
  type Presence,
  type ReadMark,
  type ServerFrame,
} from "../protocol.ts";
import type { ChannelCore } from "./core.ts";
import { ChannelGone, Dropped, Unreachable } from "./errors.ts";
import type { ChannelInfo } from "./info.ts";
import type { Relay } from "./relay.ts";
import { keepAlive, markOn, ownMessage, wireOf, wireOn, type Inbox, type Incoming, type Probe, type Wire } from "./wire.ts";

export interface StreamOptions {
  signal?: AbortSignal;
  onReady?: (head: number) => void;
  onStatus?: (s: string) => void;
  quietMs?: number;
  now?: () => number;
  onOpen?: (live: { presence: (p: PresenceFields) => Promise<void>; mark: (seq: number) => boolean; probe: (ms: number) => Promise<Probe | null> }) => void;
  onPresence?: (p: Presence & { sigOk: boolean }) => void;
  onInfo?: () => void;
  onRoster?: () => void;
  onRequest?: () => void;
}

export type OpenKind = "first" | "page" | "reconnect";

export type PresenceFields = Omit<Presence, "v" | "type" | "from" | "ts">;

export type Live =
  | {
      readonly _tag: "Open";
      readonly presence: (p: PresenceFields) => Effect.Effect<void>;
      readonly mark: (seq: number) => boolean;
      readonly probe: (ms: number) => Promise<Probe | null>;
      readonly outage: number | null;
      readonly kind: OpenKind;
    }
  | { readonly _tag: "Ready"; readonly head: number }
  | { readonly _tag: "Message"; readonly message: Message; readonly envelope?: Envelope }
  | { readonly _tag: "Unread"; readonly envelope: Envelope }
  | { readonly _tag: "Head"; readonly seq: number }
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
  watch?: boolean;
}

export const QUIET_DROP_MS = 30_000;

const OPEN_WAIT = "15 seconds";

const CLOSE_SILENT = 4001;

const NUDGE_WAIT_MS = 5_000;

const backoff = Schedule.min([Schedule.exponential("500 millis"), Schedule.spaced("30 seconds")]);

const outlasted = ({ attempt, elapsed, elapsedSincePrevious }: Schedule.InputMetadata<unknown>, quietMs: number) => elapsed >= quietMs && (attempt === 1 || elapsed - elapsedSincePrevious < quietMs);

interface Resume {
  seq: number;
  next: OpenKind;
  beacons: Map<string, number>;
}

const BEACON_SKEW_MS = 5 * 60_000;

function fresh(beacons: Map<string, number>, p: Presence, sigOk: boolean, now: number): boolean {
  if (typeof p.ts !== "number" || !Number.isFinite(p.ts) || Math.abs(now - p.ts) > BEACON_SKEW_MS) return false;
  if (!sigOk) return true;
  const key = `${p.pk}\u0000${p.client}`;
  const last = beacons.get(key);
  if (last !== undefined && p.ts <= last) return false;
  for (const [k, ts] of beacons) if (now - ts > BEACON_SKEW_MS) beacons.delete(k);
  beacons.set(key, p.ts);
  return true;
}

const STILL_IN_EVERY = 5;

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

const FRAME: Record<Live["_tag"], string> = {
  Open: "open",
  Ready: "ready",
  Message: "msg",
  Unread: "msg",
  Head: "head",
  Presence: "eph",
  Info: "info",
  Roster: "roster",
  Request: "request",
  Read: "read",
  Down: "status",
  Skipped: "status",
};
const failedFrame = (frame: string, err: unknown) => `dropped a ${frame} frame whose handling failed: ${reason(err)}`;

const PLAIN: readonly (readonly [RegExp, string])[] = [
  [/^Unable to connect\. Is the computer able to access the url\?/, "connection refused"],
  [/^The socket connection was closed unexpectedly/, "the connection dropped"],
  [/^Was there a typo in the url or port\?/, "no such host"],
];

export function reason(err: unknown): string {
  const e = err instanceof Unreachable ? err.cause : err;
  const text = e instanceof Error ? e.message : String(e);
  return PLAIN.find(([re]) => re.test(text))?.[1] ?? text;
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
  private moreUnknown = false;
  private olderWsSign = false;
  private readonly waits = new Set<() => void>();
  private readonly checks = new Set<() => void>();
  private kicked = false;
  private lastBeacon = 0;

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
            return Effect.sync(() => opts.onOpen?.({ presence: (p) => Effect.runPromise(ev.presence(p)), mark: ev.mark, probe: ev.probe }));
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

  private live(since: number, { quietMs = QUIET_DROP_MS, presence = true, reads = true, send = false, watch = false }: LiveOptions): Stream.Stream<Live, ChannelGone, Relay> {
    const at: Resume = { seq: since, next: "first", beacons: new Map() };
    return Stream.callback<Live, ChannelGone, Relay>((out) =>
      Stream.suspend(() => this.session(at, quietMs, presence, reads, send, watch)).pipe(
        Stream.retry(this.reconnect(out, quietMs)),
        Stream.catchTag("Dropped", (d) => Stream.die(d)),
        Stream.forever,
        Stream.runIntoQueue(out),
      ),
    );
  }

  nudge(): void {
    this.kicked = true;
    for (const wake of [...this.waits]) wake();
    for (const check of [...this.checks]) check();
  }

  private waitOrNudge(delay: Duration.Duration): Effect.Effect<Duration.Duration> {
    const nudged = Effect.callback<void>((resume) => {
      const wake = () => resume(Effect.void);
      this.waits.add(wake);
      return Effect.sync(() => void this.waits.delete(wake));
    });
    return Effect.suspend(() => {
      if (!this.kicked) return Effect.raceFirst(Effect.sleep(delay), nudged);
      this.kicked = false;
      return Effect.void;
    }).pipe(Effect.as(Duration.zero));
  }

  private reconnect(out: Queue.Queue<Live, ChannelGone | Cause.Done>, quietMs: number) {
    return backoff.pipe(
      Schedule.setInputType<Dropped | ChannelGone>(),
      Schedule.while(({ input }) => input instanceof Dropped),
      Schedule.tap((meta) =>
        meta.input instanceof Dropped && outlasted(meta, quietMs) ? Queue.offer(out, { _tag: "Down", after: meta.elapsed, code: meta.input.code, reason: meta.input.reason }) : Effect.void,
      ),
      Schedule.tap(({ attempt }) => (attempt === 1 || attempt % STILL_IN_EVERY === 0 ? this.stillIn() : Effect.void)),
      Schedule.modifyDelay(({ duration }) => this.waitOrNudge(duration)),
    );
  }

  private stillIn(): Effect.Effect<void, ChannelGone, Relay> {
    return Effect.flatMap(Effect.exit(Effect.raceFirst(Effect.asVoid(this.ch.fx.head()), Effect.sleep(OPEN_WAIT))), (exit) => {
      const err = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
      return err instanceof ChannelGone ? Effect.fail(err) : Effect.void;
    });
  }

  private session(at: Resume, quietMs: number, presence: boolean, reads: boolean, send: boolean, watch: boolean): Stream.Stream<Live, Dropped | ChannelGone, Relay> {
    return Stream.callback<Incoming, Dropped | ChannelGone, Relay>((q) => this.socket(at, presence, reads, q, send, watch)).pipe(
      Stream.mapEffect((f) =>
        (watch && f.t !== "open" && f.t !== "epoch" ? Effect.succeed(this.watched(f, at)) : this.read(f, at, quietMs, presence, reads)).pipe(
          Effect.catchCause((cause) => Effect.succeed<Live>({ _tag: "Skipped", frame: f.t, error: Cause.squash(cause) })),
        ),
      ),
      Stream.filter((x): x is Live => x !== null),
    );
  }

  private socket(at: Resume, presence: boolean, reads: boolean, q: Inbox, send: boolean, watch: boolean) {
    return Effect.gen({ self: this }, function* () {
      const u = new URL(`/v1/rooms/${this.ch.roomId}/ws`, this.ch.relay);
      u.searchParams.set("since", String(at.seq));
      if (watch) u.searchParams.set("watch", "1");
      if (!presence) u.searchParams.set("presence", "0");
      if (!reads) u.searchParams.set("reads", "0");
      if (send) u.searchParams.set("echo", "0");
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      const auth = yield* Effect.promise(() => signRequest(this.ch.identity, this.ch.roomId, "GET", this.olderWsSign ? "/ws" : `/ws${u.search}`));
      const { ws, closed, ping, heard, silent } = yield* Effect.acquireRelease(
        Effect.sync(() => this.connect(u, auth, q, at, send)),
        ({ ws }) => Effect.sync(() => ws.close(1000, "aborted")),
      );
      yield* Effect.forkScoped(Effect.sleep(OPEN_WAIT).pipe(Effect.andThen(Effect.sync(() => (ws.readyState === WebSocket.CONNECTING ? silent("no answer to the upgrade") : undefined)))));
      yield* Effect.forkScoped(keepAlive({ ping, heard, silent: () => silent("no answer to a ping") }));
      let checking: ReturnType<typeof setTimeout> | undefined;
      const check = () => {
        if (ws.readyState === WebSocket.CONNECTING) return silent("the network came back while opening");
        const before = heard();
        if (!ping()) return;
        clearTimeout(checking);
        checking = setTimeout(() => (heard() === before ? silent("no answer after a wake") : undefined), NUDGE_WAIT_MS);
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => void this.checks.add(check)),
        () =>
          Effect.sync(() => {
            this.checks.delete(check);
            clearTimeout(checking);
          }),
      );
      const { code, reason, opened } = yield* Effect.promise(() => closed);
      this.olderWsSign = !opened;
      if (code === 4000) {
        at.next = "page";
        return yield* Queue.end(q);
      }
      if (at.next === "page") at.next = "reconnect";
      if (code === CLOSE_REMOVED) return yield* Queue.fail(q, new ChannelGone("removed", goneHow(reason)));
      if (code === CLOSE_CLOSED) return yield* Queue.fail(q, new ChannelGone("closed"));
      return yield* Queue.fail(q, new Dropped({ code, reason }));
    });
  }

  private connect(u: URL, auth: string, q: Inbox, at: Resume, send: boolean) {
    const ws = new WebSocket(u, [WS_PROTOCOL, auth]);
    const sock = wireOf(ws, at.seq);
    const wire = send ? wireOn(ws, q) : null;
    let ended = false;
    let everOpened = false;
    let end!: (c: { code: number; reason: string }) => void;
    const closed = new Promise<{ code: number; reason: string; opened: boolean }>((resolve) => {
      end = (c) => {
        if (ended) return;
        ended = true;
        sock.closed();
        if (wire) {
          this.wires.delete(wire);
          wire.drop();
        }
        resolve({ ...c, opened: everOpened });
      };
      ws.onclose = (ev) => end({ code: ev.code, reason: ev.reason });
    });
    const silent = (reason: string) => {
      ws.onopen = null;
      ws.onmessage = null;
      end({ code: CLOSE_SILENT, reason });
      try {
        ws.close(CLOSE_SILENT, reason);
      } catch {
        // The socket is already gone; the session has ended either way.
      }
    };
    ws.onerror = () => {};
    let openedAs: OpenKind = at.next;
    ws.onopen = () => {
      everOpened = true;
      openedAs = at.next;
      at.next = "reconnect";
      Queue.offerUnsafe(q, { t: "open", presence: this.presenceOn(ws), mark: markOn(ws), probe: sock.probe, kind: openedAs });
    };
    let paging = false;
    let inPage = false;
    let asked = false;
    const ask = (since: number) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      asked = true;
      ws.send(JSON.stringify({ t: "more", since }));
    };
    ws.onmessage = (ev) => {
      let f: ServerFrame | { t: "pong" };
      try {
        f = JSON.parse(String(ev.data)) as ServerFrame | { t: "pong" };
      } catch {
        return;
      }
      sock.frame(f);
      if (wire?.answer(f)) return;
      if (f.t === "page") return void (inPage = true);
      if (f.t === "msg" && paging && !inPage) return;
      if (f.t === "err" && asked && (f.error === "unknown frame" || f.error === MORE_REFUSED)) {
        if (f.error === "unknown frame") this.moreUnknown = true;
        return void ws.close(4000, "more");
      }
      Queue.offerUnsafe(q, f);
      if (f.t !== "ready") return;
      paging = f.more;
      inPage = false;
      asked = false;
      if (f.more && this.moreUnknown) ws.close(4000, "more");
      else if (f.more) Queue.offerUnsafe(q, { t: "more", ask });
      else {
        if (wire) this.wires.add(wire);
        if (openedAs === "page") {
          Queue.offerUnsafe(q, { t: "roster" });
          Queue.offerUnsafe(q, { t: "request" });
        }
      }
    };
    return { ws, closed, ping: sock.ping, heard: sock.heard, silent };
  }

  private presenceOn(ws: WebSocket) {
    return (p: PresenceFields): Effect.Effect<void> =>
      Effect.gen({ self: this }, function* () {
        if (ws.readyState !== WebSocket.OPEN) return;
        const ts = Math.max(Date.now(), this.lastBeacon + 1);
        this.lastBeacon = ts;
        const full = yield* Effect.promise(() => sign(this.ch.identity, { v: PROTOCOL_VERSION, type: "presence", from: this.ch.name, ops: EVENT_OPS_VERSION, ts, ...p } as Presence));
        const e = this.ch.access.epoch;
        const sealed = yield* Effect.promise(() => seal(this.ch.access.keys[String(e)]!, this.ch.roomId, { ...full, e }));
        ws.send(JSON.stringify({ t: "eph", ...sealed }));
      });
  }

  private read(f: Incoming, at: Resume, quietMs: number, presence: boolean, reads: boolean): Effect.Effect<Live | null, never, Relay> {
    return Effect.gen({ self: this }, function* () {
      switch (f.t) {
        case "open": {
          const { attempt, elapsed, start } = yield* Schedule.CurrentMetadata;
          if (attempt > 0) this.info.forgetInfo();
          const now = yield* Clock.currentTimeMillis;
          return { _tag: "Open", presence: f.presence, mark: f.mark, probe: f.probe, outage: attempt > 0 && elapsed >= quietMs ? now - start : null, kind: f.kind } satisfies Live;
        }
        case "more":
          f.ask(at.seq);
          return null;
        case "msg": {
          if (f.seq <= at.seq) return null;
          const got = yield* this.ch.fx.decrypt(f);
          const m = got && (yield* this.ch.fx.settle(got));
          at.seq = f.seq;
          return m
            ? ({ _tag: "Message", message: m, envelope: f } satisfies Live)
            : Number.isSafeInteger(f.seq) && f.seq > 0 && !this.ch.hidden.has(f.seq)
              ? ({ _tag: "Unread", envelope: f } satisfies Live)
              : null;
        }
        case "own": {
          if (f.seq <= at.seq) return null;
          at.seq = f.seq;
          const own = ownMessage(f.payload, f.seq, f.ts);
          const open = own && (yield* this.ch.fx.unseal(own));
          const m = open && (yield* this.ch.fx.settle(open));
          return m && ({ _tag: "Message", message: m } satisfies Live);
        }
        case "eph":
          return presence ? yield* this.presenceIn(f, at.beacons) : null;
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

  private watched(f: Incoming, at: { seq: number }): Live | null {
    switch (f.t) {
      case "msg":
      case "head":
        if (!Number.isSafeInteger(f.seq) || f.seq <= at.seq) return null;
        at.seq = f.seq;
        return { _tag: "Head", seq: f.seq };
      case "ready":
        at.seq = Math.max(at.seq, f.head);
        return { _tag: "Ready", head: f.head };
      case "info":
        return { _tag: "Info" };
      case "roster":
        return { _tag: "Roster" };
      case "request":
        return { _tag: "Request" };
      default:
        return null;
    }
  }

  private presenceIn(f: { iv: string; ct: string }, beacons: Map<string, number>): Effect.Effect<Live | null> {
    return Effect.gen({ self: this }, function* () {
      const k = this.ch.access.keys[String(this.ch.access.epoch)];
      if (!k) return null;
      const p = (yield* Effect.promise(() => open(k, this.ch.roomId, f.iv, f.ct))) as (Presence & { e?: number }) | null;
      if (p?.type !== "presence" || typeof p.from !== "string") return null;
      const rest = omit(p, "e");
      const sigOk = yield* Effect.promise(() => verify(rest));
      if (!fresh(beacons, rest, sigOk, yield* Clock.currentTimeMillis)) return null;
      const { activity: said, reach, ...fields } = omit(rest as Presence & { role?: unknown }, "role");
      const activity = cleanActivity(said);
      return {
        _tag: "Presence",
        presence: { ...fields, ...(activity ? { activity } : {}), ...(isReach(reach) ? { reach } : {}), sigOk },
      } satisfies Live;
    });
  }
}
