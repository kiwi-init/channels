import { omit } from "@kiwi/core/omit.ts";
import { personaAnswers } from "@kiwi/core/personality.ts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { mergeCard, movedCard, sameCard, type Where } from "../card.ts";
import { eachLive, RelayError, type Live, type SendOptions } from "@kiwi/core/client.ts";
import { Cursor } from "../config.ts";
import { cardLine } from "@kiwi/core/format.ts";
import { changeTo } from "@kiwi/core/changes.ts";
import {
  editable,
  GENERAL_ROOM,
  HANDOFF_DONE,
  HANDOFF_FAILED,
  HANDOFF_MAX_SECONDS,
  ignored,
  LEASE_NAME_RE,
  MAX_LEASE_SECONDS,
  MAX_SUMMARY,
  wellFormedReaction,
  type Card,
  type Color,
  type DecisionKind,
  type Event,
  type Handoff,
  type ImageAttachment,
  type Kind,
  type Message,
  type Step,
} from "@kiwi/core/protocol.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { canPost, describeScopes, refusal } from "@kiwi/core/scopes.ts";
import { allowedOnHold, decidersOf, humanOf, isPerson, nextIn, ON_HOLD, ownerOf, placeIn, taskId, unnamedAsks, unnamedTasks, type ChannelState } from "@kiwi/core/state.ts";
import { SessionListen } from "./listen.ts";
import { EVERYONE, oneLook } from "./shared.ts";

const ANSWERING_TTL = 600_000;

const answeringKey = (seq: number): string => `answering #${seq}`;

const shellQuoted = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;

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
      for (const m of s.members.values()) if (personaAnswers(m.persona, role)) out.add(m.name);
    }
    if (!out.size) return yield* new Rejected(`no member has role ${to.filter((t) => t.startsWith("role:")).join(", ")}`);
    return [...out];
  });

  readonly send = Effect.fn("AgentSession.send")(
    { self: this },
    function* (this: SessionMessaging, body: string, opts: SendOptions = {}) {
      const to = yield* this.resolveTo(opts.to);
      yield* this.mayI({ kind: opts.kind ?? "msg", ev: opts.ev, to });
      const { state } = yield* this.state();
      const parent = !opts.room && opts.re?.length ? state.roomOf.get(opts.re[0]!) : undefined;
      const room = opts.ev ? undefined : (parent ?? (yield* this.roomId(opts.room)));
      if (opts.task !== undefined && !state.tasks.has(opts.task)) return yield* new Rejected(`no task ${taskId(opts.task)}`);
      if (opts.dm && (to?.length !== 1 || to[0] === this.me || !state.members.get(to[0]!)?.active)) return yield* new Rejected("a direct message goes to exactly one other member: --to @name");
      if (opts.kind !== "event") for (const re of opts.re ?? []) yield* this.notAnsweredByOthers(state, re, body);
      const inThread = !!opts.re?.length;
      const seq = yield* this.ch.fx.send(body, { ...opts, to, room, ...(inThread ? { task: undefined, dm: undefined } : {}) });
      return seq;
    },
    oneLook,
  );

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
    const cursor = yield* Cursor;
    yield* this.whileOurs(
      cursor.markSeen(
        this.alias,
        this.me,
        replies.map((r) => r.seq),
      ),
    );
    return replies;
  });

  readonly reply = Effect.fn("AgentSession.reply")(
    { self: this },
    function* (this: SessionMessaging, seq: number, body: string, kind: Kind = "msg", imgs?: ImageAttachment[], extra: Pick<SendOptions, "settled"> = {}) {
      const { messages, state } = yield* this.state();
      const orig = yield* this.message(seq, messages);
      if (!orig) return yield* new Rejected(`no message #${seq}`);
      yield* this.notAnsweredByOthers(state, seq, body);
      const to = orig.from === this.me ? orig.to : [orig.from];
      yield* this.mayI({ kind, to });
      const sent = yield* this.ch.fx.send(body, { to, kind, re: [seq], imgs, room: state.roomOf.get(seq) ?? orig.room, ...extra });
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

  private notAnsweredByOthers(state: ChannelState, seq: number, body?: string) {
    const held = state.facts.get(answeringKey(seq));
    const me = state.members.get(this.me);
    if (!held || held.value === this.me || (me && isPerson(me))) return Effect.void;
    const heldByOther = (s: number) => {
      const h = state.facts.get(answeringKey(s));
      return !!h && h.value !== this.me;
    };
    const root = state.threadOf.get(seq) ?? seq;
    const under = [...state.threadOf].filter(([s, r]) => r === root && s !== seq && !heldByOther(s) && !ignored(state.trust.get(s))).reduce((top, [s]) => Math.max(top, s), 0);
    const add = under
      ? `to add to its thread, post under #${under} instead: kiwi send --to '#${under}' ${body === undefined ? '"…"' : shellQuoted(body)}`
      : `nothing else is in its thread yet: react to it (kiwi react ${seq} 👍), or add to the thread under ${held.value}'s answer once it's there`;
    return Effect.fail(new Rejected(`${held.value} is answering #${seq}: leave the answer to them; ${add}`));
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

  readonly change = Effect.fn("AgentSession.change")(
    { self: this },
    function* (this: SessionMessaging, seq: number, body: string | null) {
      if (body !== null && !body.trim()) return yield* new Rejected("an edit needs the new text; to remove a message, delete it");
      const { messages, state } = yield* this.state();
      const original = messages.find((m) => m.seq === seq);
      if (!original || ignored(state.trust.get(seq))) return yield* new Rejected(`no message #${seq} here`);
      if (original.from !== this.me) return yield* new Rejected(`#${seq} isn't yours: only who wrote a message edits or deletes it`);
      if (!editable(original)) return yield* new Rejected(`#${seq} carries a question, a step or a decision others act on, so it can't be edited or deleted`);
      if (state.deleted.has(seq)) return yield* new Rejected(`#${seq} is already deleted`);
      const ev: Event = body === null ? { op: "msg.delete", seq } : { op: "msg.edit", seq, body };
      yield* this.mayI({ kind: "event", ev });
      const to = changeTo(original);
      const room = state.roomOf.get(seq);
      const sent = yield* this.ch.fx.send(body === null ? `deleted #${seq}` : `edited #${seq}`, {
        kind: "event",
        ev,
        ...(to.length ? { to } : {}),
        ...(room && room !== GENERAL_ROOM ? { room } : {}),
      });
      return yield* this.confirm(sent);
    },
    oneLook,
  );

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

  readonly hello = Effect.fn("AgentSession.hello")({ self: this }, function* (this: SessionMessaging) {
    return yield* this.event({ op: "hello" }, "joined");
  });

  readonly escalate = Effect.fn("AgentSession.escalate")(
    { self: this },
    function* (
      this: SessionMessaging,
      body: string,
      re?: number,
      handoff?: Handoff,
      ask: { choices?: string[]; task?: number; holds?: number[]; decision?: DecisionKind; step?: Step } & Pick<SendOptions, "id" | "permission"> = {},
    ) {
      if (!body.trim()) return yield* new Rejected(`say what needs ${ask.step ? "doing" : "deciding"}: the text is empty`);
      const { messages, state } = yield* this.state();
      const me = state.members.get(this.me);
      if (me && isPerson(me)) return yield* new Rejected("escalating is for agents: you're a person, so you decide");
      if (handoff && handoff.expiresAt - Date.now() > HANDOFF_MAX_SECONDS * 1000 + 5000) return yield* new Rejected(`a browser handoff link lasts at most ${HANDOFF_MAX_SECONDS / 60} minutes`);
      if (re !== undefined && !(yield* this.message(re, messages))) return yield* new Rejected(`no message #${re}`);
      const to = [...new Set([humanOf(state, this.me), ownerOf(state)].filter((n): n is string => !!n))];
      if (!to.length) return yield* new Rejected("there's no person in this channel to escalate to");
      if (ask.choices && handoff) return yield* new Rejected("a browser handoff has its own Done and Couldn't answers; leave out the options");
      const unknown = ask.holds?.find((id) => !state.tasks.has(id) && !state.askHeads.has(id));
      if (unknown !== undefined) return yield* new Rejected(`${unknown} is neither a task nor a person's message here: --holds names tasks like T7 and asks like #18`);
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
        ...(ask.holds?.length ? { holds: ask.holds } : {}),
        ...(ask.decision ? { decision: ask.decision } : {}),
        ...(ask.step ? { step: ask.step } : {}),
        ...(ask.id ? { id: ask.id } : {}),
        ...(ask.permission ? { permission: ask.permission } : {}),
        ...(re !== undefined ? { re: [re] } : {}),
      });
      return {
        seq,
        to,
        also: decidersOf(state, { esc: true, to, ...(handoff ? { handoff } : {}), ...(ask.permission ? { permission: ask.permission } : {}), ...(ask.step ? { step: ask.step } : {}) }),
      };
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
        const { state } = yield* this.state();
        const final = replies.find((r) => {
          const who = state.members.get(r.from);
          return !!who && isPerson(who) && (r.body.startsWith(HANDOFF_DONE) || r.body.startsWith(HANDOFF_FAILED));
        });
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
    function* (this: SessionMessaging, detected: Card, given: { model?: string; note?: string; tools?: string[]; fresh?: number } = {}) {
      const { state } = yield* this.state();
      const me = state.members.get(this.me);
      const merged = mergeCard(detected, me?.card, given);
      const card = me?.runs ? omit(merged, "harness", "model") : merged;
      if (!me || isPerson(me) || !canPost(me.scopes) || state.hold || sameCard(me.card, card)) return { sent: false, card };
      yield* this.event({ op: "card", ...card }, `card: ${cardLine(card)}`);
      return { sent: true, card };
    },
    oneLook,
  );

  readonly refreshWhere = Effect.fn("AgentSession.refreshWhere")(
    { self: this },
    function* (this: SessionMessaging, where: Where) {
      const { state } = yield* this.state();
      const was = state.members.get(this.me)?.card;
      if (!was) return { sent: false };
      return yield* this.refreshCard(movedCard(was, where));
    },
    oneLook,
  );

  readonly markFresh = Effect.fn("AgentSession.markFresh")(
    { self: this },
    function* (this: SessionMessaging, where: Where, at: number) {
      const { state } = yield* this.state();
      const was = state.members.get(this.me)?.card;
      if (!was) return { sent: false };
      return yield* this.refreshCard(movedCard(was, where), { fresh: at });
    },
    oneLook,
  );

  readonly closeAsk = Effect.fn("AgentSession.closeAsk")({ self: this }, function* (this: SessionMessaging, ask: number, why: string | undefined) {
    return yield* this.event({ op: "ask.close", ask, ...(why ? { why } : {}) }, why ? `closed #${ask}: ${why}` : `closed #${ask}`, undefined, ask);
  });

  readonly setFact = Effect.fn("AgentSession.setFact")({ self: this }, function* (this: SessionMessaging, key: string, value: string, ttlSec?: number) {
    return yield* this.event({ op: "fact.set", key, value, ...(ttlSec ? { ttl: ttlSec } : {}) }, `${key} = ${value}`);
  });

  readonly delFact = Effect.fn("AgentSession.delFact")({ self: this }, function* (this: SessionMessaging, key: string) {
    return yield* this.event({ op: "fact.del", key }, `unset ${key}`);
  });

  readonly proposeCompact = Effect.fn("AgentSession.proposeCompact")(
    { self: this },
    function* (this: SessionMessaging, summary: string) {
      const text = summary.trim();
      if (!text) return yield* new Rejected("write the summary: what happened, what's decided, and every open task (T7) and open question (#123) by its id");
      if (text.length > MAX_SUMMARY) return yield* new Rejected(`a summary is at most ${MAX_SUMMARY} characters`);
      const { state } = yield* this.state();
      const tasks = unnamedTasks(text, state.tasks.values());
      const asks = unnamedAsks(text, state.openAsks);
      if (tasks.length || asks.length)
        return yield* new Rejected(`the summary must name everything still open; it leaves out ${[...tasks.map((id) => `T${id}`), ...asks.map((seq) => `#${seq}`)].join(", ")}`);
      const owner = ownerOf(state);
      const seq = yield* this.event({ op: "compact.propose", summary: text, through: state.head }, `proposed compacting the history through #${state.head}`, owner ? [owner] : undefined);
      return { seq, through: state.head, state: yield* this.confirm(seq) };
    },
    oneLook,
  );

  readonly lease = Effect.fn("AgentSession.lease")(
    { self: this },
    function* (this: SessionMessaging, name: string, ttlSec: number, note?: string) {
      if (!LEASE_NAME_RE.test(name)) return yield* new Rejected("a lease is named in lowercase letters, digits and . _ / -, up to 64 characters: kiwi lock build");
      if (ttlSec < 60 || ttlSec > MAX_LEASE_SECONDS) return yield* new Rejected(`a lease lasts from a minute to ${MAX_LEASE_SECONDS / 3600}h`);
      const seq = yield* this.event({ op: "lease.take", name, ttl: Math.round(ttlSec), ...(note ? { note } : {}) }, `asked for ${name}`);
      const after = yield* this.confirm(seq);
      const lease = after.leases.get(name);
      if (!lease) return yield* new Rejected(`${name} didn't take`);
      return lease;
    },
    oneLook,
  );

  readonly unlease = Effect.fn("AgentSession.unlease")(
    { self: this },
    function* (this: SessionMessaging, name: string) {
      const { state } = yield* this.state();
      const lease = state.leases.get(name);
      const me = state.members.get(this.me);
      const person = !!me && isPerson(me);
      if (!lease || (lease.holder !== this.me && !placeIn(lease, this.me) && !person)) return yield* new Rejected(`you neither hold nor wait for ${name}`);
      const next = lease.holder && (lease.holder === this.me || person) ? nextIn(lease, Date.now()) : undefined;
      const seq = yield* this.event({ op: "lease.free", name }, next ? `${name} is yours now, ${next}` : `let go of ${name}`, next ? [next] : undefined);
      return { state: yield* this.confirm(seq), next };
    },
    oneLook,
  );
}
