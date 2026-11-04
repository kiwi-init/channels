import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { MAX_DOC_THREADS, MAX_EPH_LENGTH, MAX_IV_LENGTH, MORE_REFUSED, wellFormedSendId, wellFormedThread, type ClientFrame, type Envelope, type ServerFrame } from "@kiwi/core/protocol.ts";
import { isRefusal } from "../failures.ts";
import { Policy } from "../policy.ts";
import { RoomStore } from "./db.ts";
import type { Effects } from "./directory.ts";
import { docAppend, docBacklog, docSnap } from "./docs.ts";
import { allow, DOC_SUBS_PER_MINUTE, DOC_UPDATES_PER_MINUTE, EPHEMERAL_PER_MINUTE, MESSAGES_PER_MINUTE, MORE_PER_MINUTE, READS_PER_MINUTE, take } from "./limits.ts";
import { append, markRead, touch } from "./messages.ts";
import { wakesFor } from "./push.ts";

export const frame = (f: ServerFrame) => JSON.stringify(f);

export const takesPresence = (url: URL): boolean => url.searchParams.get("presence") !== "0";

export const wantsEcho = (url: URL): boolean => url.searchParams.get("echo") !== "0";

export function msgFrame(e: Envelope): string {
  return frame({ t: "msg", ...e });
}

export const watchFrame = (e: Envelope): Pick<Effects, "watch"> => ({ watch: [frame({ t: "head", seq: e.seq, ts: e.ts })] });

export const wantsWatch = (url: URL): boolean => url.searchParams.get("watch") === "1";

export const welcomeFrames = (since: number, reads = true, watch = false): Effect.Effect<string[], never, RoomStore> =>
  Effect.map(RoomStore, (db) => {
    if (watch) return [frame({ t: "ready", head: db.head(), more: false })];
    const backlog = db.since(since);
    const head = db.head();
    const last = backlog.at(-1)?.seq ?? since;
    return [...backlog.map(msgFrame), ...(reads ? [frame({ t: "reads", reads: db.reads() })] : []), frame({ t: "ready", head, more: last < head })];
  });

export const wantsReads = (url: URL): boolean => url.searchParams.get("reads") !== "0";

export interface SocketView {
  docs: ReadonlySet<string>;
  watch: boolean;
}

const NO_VIEW: SocketView = { docs: new Set(), watch: false };

export const onClientFrame = Effect.fn("Room.onClientFrame")(function* (raw: string, sender = "", echo = true, view: SocketView = NO_VIEW) {
  const db = yield* RoomStore;
  let f: ClientFrame;
  try {
    f = JSON.parse(raw);
  } catch {
    return { reply: frame({ t: "err", error: "bad json" }) } satisfies Effects;
  }
  if (f.t === "eph") {
    if (!allow(`eph:${db.roomId}:${sender}`, EPHEMERAL_PER_MINUTE)) return { reply: frame({ t: "err", error: "too many ephemeral frames; slow down" }) } satisfies Effects;
    if (typeof f.iv !== "string" || typeof f.ct !== "string" || f.iv.length > MAX_IV_LENGTH || f.ct.length > MAX_EPH_LENGTH) {
      return { reply: frame({ t: "err", error: "bad ephemeral frame" }) } satisfies Effects;
    }
    return { ephemeral: frame({ t: "eph", iv: f.iv, ct: f.ct }) } satisfies Effects;
  }
  if (f.t === "read") {
    if (!allow(`read:${db.roomId}:${sender}`, READS_PER_MINUTE)) return {} satisfies Effects;
    return yield* markRead(sender, f.seq).pipe(
      Effect.map((mark): Effects => (mark ? { readers: [frame({ t: "read", ...mark })] } : {})),
      Effect.catchCause((cause) =>
        Effect.succeed<Effects>(isRefusal(Cause.squash(cause)) ? { reply: frame({ t: "err", error: "bad read mark" }) } : { reply: frame({ t: "err", error: socketError(cause) }) }),
      ),
    );
  }
  if (f.t === "more") {
    if (!allow(`more:${db.roomId}:${sender}`, MORE_PER_MINUTE)) return { reply: frame({ t: "err", error: MORE_REFUSED }) } satisfies Effects;
    return { reply: [frame({ t: "page" }), ...(yield* welcomeFrames(Number(f.since) || 0))] } satisfies Effects;
  }
  if (f.t === "doc" || f.t === "doc.snap" || f.t === "doc.sub" || f.t === "doc.unsub") return yield* onDocFrame(f, sender, view);
  if (f.t !== "send") return { reply: frame({ t: "err", error: "unknown frame" }) } satisfies Effects;
  const { noRateLimits } = yield* Policy;
  const counted = take(`${db.roomId}:${sender}`, noRateLimits ? Infinity : MESSAGES_PER_MINUTE);
  if ("retryAfter" in counted) return { reply: frame({ t: "err", error: "too many messages; wait a minute", id: f.id, tag: "TooMany", retryAfter: counted.retryAfter }) } satisfies Effects;
  const send = f;
  if (send.cid !== undefined && !wellFormedSendId(send.cid)) {
    counted.refund();
    return { reply: frame({ t: "err", error: "bad send id", id: send.id }) } satisfies Effects;
  }
  const stored = yield* Effect.exit(append(send.iv, send.ct, Number(send.e ?? 0), sender, {}, send.cid));
  if (stored._tag === "Failure") {
    counted.refund();
    return { reply: frame({ t: "err", error: socketError(stored.cause), id: send.id }) } satisfies Effects;
  }
  const e = stored.value;
  if ("repeat" in e) {
    counted.refund();
    return { reply: frame({ t: "ack", id: send.id, seq: e.seq, ts: e.ts }) } satisfies Effects;
  }
  const expireAt = yield* touch.pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        socketError(cause);
        return null;
      }),
    ),
  );
  const reply = frame({ t: "ack", id: send.id, seq: e.seq, ts: e.ts });
  const fx: Effects = { ...(echo ? { broadcast: [msgFrame(e)] } : { others: msgFrame(e) }), ...watchFrame(e), ...wakesFor(db, send.wake, sender, e.seq), reply, expireAt: expireAt ?? undefined };
  return fx;
});

type DocFrame = Extract<ClientFrame, { t: "doc" | "doc.snap" | "doc.sub" | "doc.unsub" }>;

const onDocFrame = Effect.fn("Room.onDocFrame")(function* (f: DocFrame, sender: string, view: SocketView) {
  const db = yield* RoomStore;
  const th = f.th;
  const id = (f.t === "doc" || f.t === "doc.snap") && typeof f.id === "string" && f.id.length > 0 && f.id.length <= 64 ? f.id : undefined;
  const refuse = (error: string, tag?: string, retryAfter?: number): Effects => ({
    reply: frame({ t: "err", error, ...(id === undefined ? {} : { id }), ...(wellFormedThread(th) ? { th } : {}), ...(tag ? { tag } : {}), ...(retryAfter ? { retryAfter } : {}) }),
  });
  if (view.watch) return refuse("a watch socket only follows the head");
  if (!wellFormedThread(th)) return refuse("bad thread id", "BadRequest");
  if (f.t === "doc.unsub") return { follow: { th, on: false } } satisfies Effects;
  if (f.t === "doc.sub") {
    if (!allow(`docsub:${db.roomId}:${sender}`, DOC_SUBS_PER_MINUTE)) return refuse("too many doc subscriptions; slow down", "TooMany");
    if (!view.docs.has(th) && view.docs.size >= MAX_DOC_THREADS) return refuse(`a socket follows at most ${MAX_DOC_THREADS} threads; unsubscribe one first`, "TooMany");
    const { updates, head } = yield* docBacklog(th, f.since);
    return { reply: [...updates.map((u) => frame({ t: "doc", ...u })), frame({ t: "doc.ready", th, head })], follow: { th, on: true } } satisfies Effects;
  }
  const { noRateLimits } = yield* Policy;
  const counted = take(`doc:${db.roomId}:${sender}`, noRateLimits ? Infinity : DOC_UPDATES_PER_MINUTE);
  if ("retryAfter" in counted) return refuse("too many doc updates; wait a minute", "TooMany", counted.retryAfter);
  if (id === undefined) {
    counted.refund();
    return refuse("bad frame id", "BadRequest");
  }
  const e = Number(f.e ?? 0);
  if (f.t === "doc.snap") {
    const snapped = yield* Effect.exit(docSnap(th, f.upto, f.iv, f.ct, e, sender));
    if (snapped._tag === "Failure") {
      counted.refund();
      return refuse(socketError(snapped.cause), failureTag(snapped.cause));
    }
    return { reply: frame({ t: "ack", id, seq: snapped.value }) } satisfies Effects;
  }
  const stored = yield* Effect.exit(docAppend(th, f.iv, f.ct, e, sender));
  if (stored._tag === "Failure") {
    counted.refund();
    return refuse(socketError(stored.cause), failureTag(stored.cause));
  }
  const { update, compact } = stored.value;
  const expireAt = yield* touch.pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        socketError(cause);
        return null;
      }),
    ),
  );
  return {
    reply: frame({ t: "ack", id, seq: update.dseq, ts: update.ts, ...(compact ? { compact: true as const } : {}) }),
    doc: { th, frame: frame({ t: "doc", ...update }) },
    expireAt: expireAt ?? undefined,
  } satisfies Effects;
});

function failureTag(cause: Cause.Cause<unknown>): string | undefined {
  const err = Cause.squash(cause);
  return isRefusal(err) ? (err._tag === "Refused" ? err.tag : err._tag) : undefined;
}

export function socketError(cause: Cause.Cause<unknown>): string {
  const err = Cause.squash(cause);
  if (isRefusal(err)) return err.message;
  console.error(err instanceof Error ? err.message : "error");
  return "internal error";
}
