import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { mergeCard, sameCard } from "../card.ts";
import { eachLive, RelayError, type Live, type SendOptions } from "@kiwi/core/client.ts";
import { Cursor } from "../config.ts";
import { cardLine } from "@kiwi/core/format.ts";
import {
  HANDOFF_DONE,
  HANDOFF_FAILED,
  HANDOFF_MAX_SECONDS,
  ignored,
  wellFormedReaction,
  type Card,
  type Color,
  type Event,
  type Handoff,
  type ImageAttachment,
  type Kind,
  type Message,
} from "@kiwi/core/protocol.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { canPost, describeScopes, refusal } from "@kiwi/core/scopes.ts";
import { allowedOnHold, humanOf, isPerson, ON_HOLD, ownerOf, taskId, type ChannelState } from "@kiwi/core/state.ts";
import { SessionListen } from "./listen.ts";
import { EVERYONE, oneLook } from "./shared.ts";
import { ACK, answersPeople } from "./wants.ts";

const ANSWERING_TTL = 600_000;

export const answeringKey = (seq: number): string => `answering #${seq}`;

export class SessionMessaging extends SessionListen {
  readonly resolveTo = Effect.fn("AgentSession.resolveTo")({ self: this }, function* (this: SessionMessaging, to: string[] | undefined, state?: ChannelState) {
    if (to?.some((t) => EVERYONE.has(t.toLowerCase()))) return ["*"];
    if (!to?.length || !to.some((t) => t.startsWith("role:"))) return to;
    const s = state ?? (yield* this.state()).state;
    const out = new Set<string>();
    for (const t of to) {
      if (!t.startsWith("role:")) {
        out.add(t);
        continue;
      }
      const role = t.slice(5).toLowerCase();
      for (const m of s.members.values()) if (m.role?.toLowerCase() === role) out.add(m.name);
    }
    if (!out.size) return yield* new Rejected(`no member has role ${to.filter((t) => t.startsWith("role:")).join(", ")}`);
    return [...out];
  });

  readonly send = Effect.fn("AgentSession.send")(
    { self: this },
    function* (this: SessionMessaging, body: string, opts: SendOptions = {}) {
      const to = yield* this.resolveTo(opts.to);
      yield* this.mayI({ kind: opts.kind ?? "msg", ev: opts.ev, to });
      if (opts.kind !== "event" && !opts.esc) yield* this.mayTalkTo(to);
      const { state } = yield* this.state();
      const parent = !opts.room && opts.re?.length ? state.roomOf.get(opts.re[0]!) : undefined;
      const room = opts.ev ? undefined : (parent ?? (yield* this.roomId(opts.room)));
      if (opts.task !== undefined && !state.tasks.has(opts.task)) return yield* new Rejected(`no task ${taskId(opts.task)}`);
      if (opts.dm && (to?.length !== 1 || to[0] === this.me || !state.members.get(to[0]!)?.active)) return yield* new Rejected("a direct message goes to exactly one other member: --dm NAME");
      if (opts.kind !== "event") for (const re of opts.re ?? []) yield* this.notAnsweredByOthers(state, re);
      const inThread = !!opts.re?.length;
      const seq = yield* this.ch.fx.send(body, { ...opts, to, room, ...(inThread ? { task: undefined, dm: undefined } : {}) });
      if (opts.kind !== "event" && opts.re?.length) yield* this.ack(opts.re);
      return seq;
    },
    oneLook,
  );

  private mayTalkTo(to: string[] | undefined) {
    return Effect.gen({ self: this }, function* () {
      if (!to?.length) return;
      const { state } = yield* this.state();
      const me = state.members.get(this.me);
      const { coordinatorOnly, strict } = state.mode;
      if (!coordinatorOnly || !strict || !state.coordinator || !me || me.kind === "human" || me.owner || this.me === state.coordinator) return;
      const people = to.filter((n) => {
        const p = state.members.get(n);
        return !!p && (p.kind === "human" || p.owner);
      });
      if (people.length)
        return yield* new Rejected(
          `this channel is coordinator-only: only ${state.coordinator} messages people. Send it to ${state.coordinator}, who passes it on, or for a decision only a person can make: kiwi ask-human --re N "the decision".`,
        );
    });
  }

  private mayI(m: { kind: Kind; ev?: Event; to?: string[] }) {
    return Effect.gen({ self: this }, function* () {
      const { state } = yield* this.state();
      const me = state.members.get(this.me);
      const why = me && refusal(me.scopes, m);
      if (why) return yield* new Rejected(`the owner hasn't let you do that: you ${why} here (you may ${me.scopes.length ? describeScopes(me.scopes) : "only read"})`);
      const person = (n: string) => {
        const p = state.members.get(n);
        return !!p && isPerson(p);
      };
      if (state.hold && me && !isPerson(me) && !allowedOnHold(m, person)) {
        return yield* new Rejected(`${ON_HOLD}${state.hold.note ? ` (${state.hold.note})` : ""}. Stop work and wait; answer people if they ask you something.`);
      }
    });
  }

  readonly ask = Effect.fn("AgentSession.ask")(
    { self: this },
    function* (this: SessionMessaging, body: string, opts: { to?: string[]; kind?: Kind; waitSec?: number; imgs?: ImageAttachment[]; room?: string; task?: number; dm?: boolean }) {
      const head = yield* this.ch.fx.head();
      const seq = yield* this.send(body, {
        to: opts.to,
        kind: opts.kind ?? "ask",
        imgs: opts.imgs,
        room: opts.room,
        ...(opts.task !== undefined ? { task: opts.task } : {}),
        ...(opts.dm ? { dm: true } : {}),
      });
      if (!opts.waitSec) return { seq, replies: [] as Message[] };
      const replies = yield* this.awaitReplies(seq, head, opts.waitSec);
      return { seq, replies };
    },
  );

  readonly awaitReplies = Effect.fn("AgentSession.awaitReplies")({ self: this }, function* (this: SessionMessaging, seq: number, since: number, waitSec: number) {
    const replies: Message[] = [];
    let roster = yield* this.members(true);
    const genuine = (m: Message) =>
      Effect.gen({ self: this }, function* () {
        const ok = () => !!m.sigOk && !!m.pk && roster.some((r) => r.name === m.from && r.pk === m.pk);
        if (ok()) return true;
        roster = yield* this.members(true);
        return ok();
      });
    const answered = yield* Deferred.make<void>();
    const handle = (ev: Live) =>
      Effect.gen({ self: this }, function* () {
        if (ev._tag !== "Message") return;
        const m = ev.message;
        if (m.from === this.me || !m.re?.includes(seq) || !(yield* genuine(m))) return;
        replies.push(m);
        if (replies.length === 1) yield* Effect.forkScoped(Effect.andThen(Effect.sleep(600), Deferred.succeed(answered, undefined)));
      });
    const listening = eachLive(this.ch.fx.live(since, { presence: false, reads: false }), handle, () => Effect.void);
    yield* Effect.raceFirst(listening, Effect.raceFirst(Deferred.await(answered), Effect.sleep(waitSec * 1000))).pipe(Effect.scoped);
    yield* (yield* Cursor).markSeen(
      this.alias,
      this.me,
      replies.map((r) => r.seq),
    );
    return replies;
  });

  readonly reply = Effect.fn("AgentSession.reply")(
    { self: this },
    function* (this: SessionMessaging, seq: number, body: string, kind: Kind = "msg", imgs?: ImageAttachment[]) {
      const { messages, state } = yield* this.state();
      const orig = yield* this.message(seq, messages);
      if (!orig) return yield* new Rejected(`no message #${seq}`);
      yield* this.notAnsweredByOthers(state, seq);
      const to = orig.from === this.me ? orig.to : [orig.from];
      yield* this.mayI({ kind, to });
      yield* this.mayTalkTo(to);
      const sent = yield* this.ch.fx.send(body, { to, kind, re: [seq], imgs, room: state.roomOf.get(seq) ?? orig.room });
      yield* this.ack([seq]);
      return sent;
    },
    oneLook,
  );

  readonly answering = Effect.fn("AgentSession.answering")(
    { self: this },
    function* (this: SessionMessaging, seq: number) {
      const { messages, state } = yield* this.state();
      if (!(yield* this.message(seq, messages)) || ignored(state.trust.get(seq))) return yield* new Rejected(`no message #${seq}`);
      yield* this.notAnsweredByOthers(state, seq);
      const sent = yield* this.event({ op: "fact.set", key: answeringKey(seq), value: this.me, ttl: ANSWERING_TTL / 1000 }, `answering #${seq}`, undefined, undefined, {
        slot: { name: `re:${seq}`, ttl: ANSWERING_TTL },
      }).pipe(this.taken((who) => `${who} is answering #${seq}: leave it to them`));
      return yield* this.confirm(sent);
    },
    oneLook,
  );

  private notAnsweredByOthers(state: ChannelState, seq: number) {
    const held = state.facts.get(answeringKey(seq));
    const me = state.members.get(this.me);
    if (!held || held.value === this.me || (me && isPerson(me))) return Effect.void;
    return Effect.fail(new Rejected(`${held.value} is answering #${seq}: leave it to them, or react to it`));
  }

  protected taken(what: (who: string) => string) {
    return <A, E, R>(eff: Effect.Effect<A, E, R>) =>
      eff.pipe(
        Effect.catchIf(
          (err): err is Extract<E, RelayError> => err instanceof RelayError && err.tag === "Taken",
          (err) =>
            Effect.gen({ self: this }, function* () {
              const at = Number(/#(\d+)/.exec(err.message)?.[1] ?? 0);
              const held = at ? yield* this.ch.fx.page(at - 1, 1).pipe(Effect.orElseSucceed((): Message[] => [])) : [];
              return yield* new Rejected(what(held.find((m) => m.seq === at)?.from ?? "someone else"));
            }),
        ),
      );
  }

  readonly react = Effect.fn("AgentSession.react")(
    { self: this },
    function* (this: SessionMessaging, seq: number, emoji: string | null) {
      if (emoji !== null && !wellFormedReaction(emoji)) return yield* new Rejected("a reaction is one emoji, or a GIF key like ok/trailer (kiwi react --list)");
      const { state } = yield* this.state();
      if (!state.placeOf.has(seq) || ignored(state.trust.get(seq))) return yield* new Rejected(`no message #${seq} to react to`);
      return yield* this.confirm(yield* this.event({ op: "react", seq, emoji }, "reaction"));
    },
    oneLook,
  );

  protected ack(re: readonly number[]) {
    return Effect.ignoreCause(
      Effect.gen({ self: this }, function* () {
        const { messages, state } = yield* this.state();
        const me = state.members.get(this.me);
        if (!state.mode.coordinatorOnly || !state.coordinator || this.me === state.coordinator || !me || isPerson(me) || state.hold) return;
        for (const seq of answersPeople(state, messages, re)) {
          if (state.reactions.get(seq)?.has(this.me)) continue;
          yield* this.event({ op: "react", seq, emoji: ACK }, "reaction");
        }
      }),
    );
  }

  readonly hello = Effect.fn("AgentSession.hello")({ self: this }, function* (this: SessionMessaging, role?: string, about?: string) {
    return yield* this.event({ op: "hello", role, about }, `joined${role ? ` as ${role}` : ""}`);
  });

  readonly escalate = Effect.fn("AgentSession.escalate")(
    { self: this },
    function* (this: SessionMessaging, body: string, re?: number, handoff?: Handoff, ask: { choices?: string[]; task?: number } = {}) {
      if (!body.trim()) return yield* new Rejected("say what needs deciding: the text is empty");
      const { messages, state } = yield* this.state();
      const me = state.members.get(this.me);
      if (me && isPerson(me)) return yield* new Rejected("escalating is for agents: you're a person, so you decide");
      if (handoff && handoff.expiresAt - Date.now() > HANDOFF_MAX_SECONDS * 1000 + 5000) return yield* new Rejected(`a browser handoff link lasts at most ${HANDOFF_MAX_SECONDS / 60} minutes`);
      if (re !== undefined && !(yield* this.message(re, messages))) return yield* new Rejected(`no message #${re}`);
      const to = [...new Set([humanOf(state, this.me), ownerOf(state)].filter((n): n is string => !!n))];
      if (!to.length) return yield* new Rejected("there's no person in this channel to escalate to");
      if (ask.choices && handoff) return yield* new Rejected("a browser handoff has its own Done and Couldn't answers; leave out the options");
      if (ask.task !== undefined && re !== undefined) {
        const place = state.placeOf.get(re);
        if (place?.kind !== "task" || place.task !== ask.task) {
          const where = place?.kind === "task" ? `in ${taskId(place.task)}'s thread` : place?.kind === "dm" ? "in a direct thread" : "in the main conversation";
          return yield* new Rejected(`#${re} is ${where}, and an answer to it goes there, not in ${taskId(ask.task)}'s thread: leave out the task or the message it answers`);
        }
      }
      const seq = yield* this.send(body, {
        to,
        kind: "blocking",
        esc: true,
        ...(handoff ? { handoff } : {}),
        ...(ask.choices ? { choices: ask.choices } : {}),
        ...(ask.task !== undefined ? { task: ask.task } : {}),
        ...(re !== undefined ? { re: [re] } : {}),
      });
      return { seq, to };
    },
    oneLook,
  );

  readonly awaitHandoff = Effect.fn("AgentSession.awaitHandoff")(
    { self: this },
    function* (this: SessionMessaging, seq: number, since: number, expiresAt: number, waitSec: number) {
      const deadline = Math.min(expiresAt, Date.now() + waitSec * 1000);
      let from = since;
      const heard: Message[] = [];
      while (Date.now() < deadline) {
        const replies = yield* this.awaitReplies(seq, from, Math.max(1, Math.ceil((deadline - Date.now()) / 1000)));
        if (!replies.length) break;
        heard.push(...replies);
        from = Math.max(from, ...replies.map((r) => r.seq));
        const final = replies.find((r) => r.body.startsWith(HANDOFF_DONE) || r.body.startsWith(HANDOFF_FAILED));
        if (final) return { outcome: final.body.startsWith(HANDOFF_DONE) ? ("done" as const) : ("failed" as const), replies: heard };
      }
      return { outcome: Date.now() >= expiresAt ? ("expired" as const) : ("waiting" as const), replies: heard };
    },
    oneLook,
  );

  readonly setColor = Effect.fn("AgentSession.setColor")(
    { self: this },
    function* (this: SessionMessaging, member: string, color: Color | null) {
      if (member !== this.me) return yield* new Rejected("you set your own colour; the owner sets anyone else's in the Channels app");
      const ev: Event = { op: "color.set", member, color };
      yield* this.mayI({ kind: "event", ev });
      return yield* this.confirm(yield* this.ch.fx.send(color ? `${member}'s colour is ${color}` : `cleared ${member}'s colour`, { kind: "event", ev }));
    },
    oneLook,
  );

  protected event(ev: Event, body: string, to?: string[], re?: number, slots: Pick<SendOptions, "slot" | "free"> = {}) {
    return Effect.gen({ self: this }, function* () {
      yield* this.mayI({ kind: "event", ev });
      return yield* this.ch.fx.send(body, { kind: "event", ev, to: to?.length ? [...new Set(to)].filter((n) => n !== this.me) : undefined, ...(re !== undefined ? { re: [re] } : {}), ...slots });
    });
  }

  protected confirm(seq: number) {
    return Effect.gen({ self: this }, function* () {
      const { state } = yield* this.state();
      const why = state.rejected.get(seq);
      if (why) return yield* new Rejected(why);
      return state;
    });
  }

  readonly refreshCard = Effect.fn("AgentSession.refreshCard")(
    { self: this },
    function* (this: SessionMessaging, detected: Card, given: { model?: string; note?: string; tools?: string[] } = {}) {
      const { state } = yield* this.state();
      const me = state.members.get(this.me);
      const card = mergeCard(detected, me?.card, given);
      if (!me || isPerson(me) || !canPost(me.scopes) || state.hold || sameCard(me.card, card)) return { sent: false, card };
      yield* this.event({ op: "card", ...card }, `card: ${cardLine(card)}`);
      return { sent: true, card };
    },
    oneLook,
  );

  readonly setFact = Effect.fn("AgentSession.setFact")({ self: this }, function* (this: SessionMessaging, key: string, value: string, ttlSec?: number) {
    return yield* this.event({ op: "fact.set", key, value, ...(ttlSec ? { ttl: ttlSec } : {}) }, `${key} = ${value}`);
  });

  readonly delFact = Effect.fn("AgentSession.delFact")({ self: this }, function* (this: SessionMessaging, key: string) {
    return yield* this.event({ op: "fact.del", key }, `unset ${key}`);
  });
}
