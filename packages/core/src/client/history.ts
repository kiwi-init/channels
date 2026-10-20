import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { open } from "../crypto.ts";
import { verify } from "../identity.ts";
import { PAGE_LIMIT, rasterAttachment, wellFormed, type Envelope, type Message, type Payload } from "../protocol.ts";
import type { ChannelCore } from "./core.ts";
import type { MemberRefusal } from "./errors.ts";
import type { Relay } from "./relay.ts";

interface PageOffer {
  cap: string;
  next: number;
}

export function received(p: Payload, seq: number, rts: number, sigOk: boolean): Message {
  const imgs = Array.isArray(p.imgs) ? p.imgs.filter(rasterAttachment) : undefined;
  return { ...p, ...(imgs?.length ? { imgs } : { imgs: undefined }), seq, rts, sigOk };
}

export interface HistoryFx {
  head(): Effect.Effect<number, MemberRefusal, Relay>;
  markRead(seq: number): Effect.Effect<void, never, Relay>;
  decrypt(env: Envelope): Effect.Effect<Message | null, never, Relay>;
  history(since: number): Effect.Effect<{ head: number; messages: Message[]; first: number | null; through: number }, MemberRefusal, Relay>;
  page(since: number, limit: number): Effect.Effect<Message[], MemberRefusal, Relay>;
}

export class ChannelHistory {
  private markedTo = 0;
  private marksUnknown = false;

  constructor(private readonly ch: ChannelCore) {}

  readonly fx: HistoryFx = {
    head: Effect.fn("Channel.head")({ self: this }, function* (this: ChannelHistory) {
      return (yield* this.ch.request<{ head: number }>("/")).head;
    }),

    markRead: Effect.fn("Channel.markRead")({ self: this }, function* (this: ChannelHistory, seq: number) {
      if (this.marksUnknown || !Number.isSafeInteger(seq) || seq <= this.markedTo) return;
      const exit = yield* Effect.exit(this.ch.request("/read", { method: "POST", body: JSON.stringify({ seq }) }));
      if (Exit.isSuccess(exit)) this.markedTo = seq;
      else if (/not found/i.test(String((Cause.squash(exit.cause) as Error)?.message ?? ""))) this.marksUnknown = true;
    }),

    decrypt: Effect.fn("Channel.decrypt")({ self: this }, function* (this: ChannelHistory, env: Envelope) {
      if (!Number.isSafeInteger(env.seq) || env.seq < 1 || !Number.isFinite(env.ts)) return null;
      const key = yield* this.keyFor(env.e ?? 0);
      if (!key) return null;
      const p = (yield* Effect.promise(() => open(key, this.ch.roomId, env.iv, env.ct).catch(() => null))) as unknown;
      if (!wellFormed(p)) return null;
      return received(p, env.seq, env.ts, yield* Effect.promise(() => verify(p)));
    }),

    history: Effect.fn("Channel.history")({ self: this }, function* (this: ChannelHistory, since: number) {
      const messages: Message[] = [];
      let head = since;
      let through = since;
      const take = (envelopes: Envelope[]) =>
        Effect.gen({ self: this }, function* () {
          const decrypted = yield* Effect.forEach(envelopes, (e) => this.ch.fx.decrypt(e), { concurrency: "unbounded" });
          for (let i = 0; i < envelopes.length; i++) {
            const at = envelopes[i]!.seq;
            if (!Number.isSafeInteger(at) || at <= since) continue;
            const m = decrypted[i];
            if (m) messages.push(m);
            since = at;
            if (since === through + 1) through = since;
          }
        });
      let ask: Record<string, number> = { pages: 1 };
      let first: number | null = null;
      for (;;) {
        const from = since;
        const page = yield* this.ch.request<{ head: number; messages: Envelope[]; pages?: PageOffer }>("/messages", {}, { since, ...ask });
        ask = {};
        head = page.head;
        first ??= page.messages[0]?.seq ?? null;
        yield* take(page.messages);
        const offer = page.pages;
        if (offer && typeof offer.cap === "string" && Number.isSafeInteger(offer.next) && offer.next % PAGE_LIMIT === 0 && offer.next >= since && offer.next < head) {
          since = offer.next;
          for (let k = offer.next / PAGE_LIMIT; (k + 1) * PAGE_LIMIT <= head; k++) {
            const exit = yield* Effect.exit(this.ch.request<{ messages: Envelope[] }>(`/pages/${k}`, {}, { cap: offer.cap }));
            if (Exit.isFailure(exit)) break;
            yield* take(exit.value.messages.filter((e) => e.seq > k * PAGE_LIMIT && e.seq <= (k + 1) * PAGE_LIMIT));
            since = (k + 1) * PAGE_LIMIT;
          }
          if (since >= head) break;
          continue;
        }
        if (since <= from || since >= head) break;
      }
      return { head, messages, first, through };
    }),

    page: Effect.fn("Channel.page")({ self: this }, function* (this: ChannelHistory, since: number, limit: number) {
      const page = yield* this.ch.request<{ head: number; messages: Envelope[] }>("/messages", {}, { since, limit });
      const decrypted = yield* Effect.forEach(page.messages, (e) => this.ch.fx.decrypt(e), { concurrency: "unbounded" });
      return decrypted.filter((m): m is Message => !!m);
    }),
  };

  keyFor(e: number): Effect.Effect<string | undefined, never, Relay> {
    return Effect.gen({ self: this }, function* () {
      if (!this.ch.access.keys[String(e)]) yield* Effect.ignoreCause(this.ch.fx.refreshKeys());
      return this.ch.access.keys[String(e)];
    });
  }
}
