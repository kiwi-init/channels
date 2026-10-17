import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { MAX_EPH_LENGTH, MORE_REFUSED, type ClientFrame, type Envelope, type ServerFrame } from "../../protocol.ts";
import { isRefusal } from "../failures.ts";
import { RoomStore } from "./db.ts";
import type { Effects } from "./directory.ts";
import { allow, EPHEMERAL_PER_MINUTE, MESSAGES_PER_MINUTE, MORE_PER_MINUTE, READS_PER_MINUTE } from "./limits.ts";
import { append, markRead, touch } from "./messages.ts";

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

export const onClientFrame = Effect.fn("Room.onClientFrame")(function* (raw: string, sender = "", echo = true) {
  const db = yield* RoomStore;
  let f: ClientFrame;
  try {
    f = JSON.parse(raw);
  } catch {
    return { reply: frame({ t: "err", error: "bad json" }) } satisfies Effects;
  }
  if (f.t === "eph") {
    if (!allow(`eph:${db.roomId}:${sender}`, EPHEMERAL_PER_MINUTE)) return { reply: frame({ t: "err", error: "too many ephemeral frames; slow down" }) } satisfies Effects;
    if (typeof f.iv !== "string" || typeof f.ct !== "string" || f.ct.length > MAX_EPH_LENGTH) {
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
  if (f.t !== "send") return { reply: frame({ t: "err", error: "unknown frame" }) } satisfies Effects;
  if (!allow(`${db.roomId}:${sender}`, MESSAGES_PER_MINUTE)) return { reply: frame({ t: "err", error: "too many messages; wait a minute", id: f.id }) } satisfies Effects;
  const send = f;
  const stored = yield* Effect.exit(append(send.iv, send.ct, Number(send.e ?? 0), sender));
  if (stored._tag === "Failure") return { reply: frame({ t: "err", error: socketError(stored.cause), id: send.id }) } satisfies Effects;
  const e = stored.value;
  const expireAt = yield* touch.pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        socketError(cause);
        return null;
      }),
    ),
  );
  const reply = frame({ t: "ack", id: send.id, seq: e.seq, ts: e.ts });
  const fx: Effects = { ...(echo ? { broadcast: [msgFrame(e)] } : { others: msgFrame(e) }), ...watchFrame(e), reply, expireAt: expireAt ?? undefined };
  return fx;
});

export function socketError(cause: Cause.Cause<unknown>): string {
  const err = Cause.squash(cause);
  if (isRefusal(err)) return err.message;
  console.error(err instanceof Error ? err.message : "error");
  return "internal error";
}
