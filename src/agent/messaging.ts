import type { Frozen, Lease } from "@kiwi/core/state.ts";
import { omit } from "@kiwi/core/omit.ts";
import { personaAnswers } from "@kiwi/core/personality.ts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { mergeCard, movedCard, sameCard, type Where } from "../card.ts";
import { here, realSession, type Here } from "../seats.ts";
import { sessionFingerprint } from "@kiwi/core/session-print.ts";
import { eachLive, OfflineReads, RelayError, type Live, type Refused, type SendOptions } from "@kiwi/core/client.ts";
import { Cursor } from "../config.ts";
import { cardLine } from "@kiwi/core/format.ts";
import { changeTo, mentionsOf } from "@kiwi/core/changes.ts";
import { wakeList } from "@kiwi/core/phone-wake.ts";
import {
  AFTER_SKEW_MS,
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
  type FileAttachment,
  type Handoff,
  type ImageAttachment,
  type Kind,
  type Message,
  type Step,
} from "@kiwi/core/protocol.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { canPost, describeScopes, refusal } from "@kiwi/core/scopes.ts";
import {
  allowedOnHold,
  checkChangeRefusal,
  decidersOf,
  directThreadStart,
  handedOver,
  escalationTargets,
  isPerson,
  landingTouchedByClose,
  leadForAsk,
  LEASE_WAIT_MS,
  nextIn,
  ON_HOLD,
  ownerOf,
  placeIn,
  taskId,
  unnamedAsks,
  unnamedTasks,
  type ChannelState,
  handedToLead,
  leadHoldsFor,
} from "@kiwi/core/state.ts";
import type { BlockMedia } from "@kiwi/core/doc/blocks.ts";
import { addressed, blockMedia, docPlaceOfMessage, dropBlock, editBlock, readDoc, writeBlock, type DocPlace } from "./docs.ts";
import { SessionListen } from "./listen.ts";
import { EVERYONE, Look, oneLook, type Agent } from "./shared.ts";

const ANSWERING_TTL = 600_000;
const READ_RETRY_FIRST_MS = 1_000;
const READ_RETRY_MAX_MS = 8_000;
const READ_RETRY_LAST_MS = 250;
const RENEW_CONFIRM_MS = 120_000;
const RENEW_RACES = 5;
const FIRST_READ_WAIT_MS = 60_000;

const readLimited = (err: unknown): boolean => err instanceof RelayError && err.status === 429;

const clockTime = (at: number): string => new Date(at).toTimeString().slice(0, 8);

const stillLimited = (name: string) =>
  new Rejected(`the relay kept limiting history reads for ${FIRST_READ_WAIT_MS / 1000}s and this computer has no copy of the channel, so nothing was sent for ${name} (kiwi lock ${name} tries again)`);

const unsure = (name: string) =>
  new Rejected(
    `the relay was limiting history reads when you asked, and once a read came through no hold on ${name} was yours, so this can't tell whether it ran out meanwhile: nothing was sent (kiwi lock ${name} asks again)`,
  );

const relayRefused = (err: unknown, tag: string): boolean => err instanceof RelayError && err.tag === tag;

const tooLate = (name: string, until: number) =>
  new Rejected(`your hold on ${name} ends at ${clockTime(until)}, and with less than ${AFTER_SKEW_MS / 1000}s left a renewal could land after it, so none was sent (kiwi lock ${name} asks again)`);

const endedFirst = (name: string) => new Rejected(`your hold on ${name} ended before it could be renewed, so none was sent (kiwi lock ${name} asks again)`);

const keptMoving = (name: string) => new Rejected(`the channel kept moving while ${name} was being renewed, so no renewal was stored (kiwi lock ${name} tries again)`);

const offClock = new Rejected(`the relay's clock and this computer's differ by more than ${AFTER_SKEW_MS / 1000}s, so no renewal was stored: kiwi doctor shows the difference`);

const unconfirmed = (name: string) => new Rejected(`the renewal of ${name} is sent, but the relay is still limiting history reads, so it isn't confirmed: kiwi status shows whether you hold ${name}`);

const answeringKey = (seq: number): string => `answering #${seq}`;

interface Placed {
  seq: number;
  under?: { answer: number; by: string };
}

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
      const inThread = !!opts.re?.length;
      const sending = { ...opts, to, room, ...(inThread ? { task: undefined, dm: undefined } : {}) };
      const seq = yield* this.ch.fx.send(body, { ...sending, wake: wakeList(state, this.me, sending) });
      return seq;
    },
    oneLook,
  );

  readonly sendToDoc = Effect.fn("AgentSession.sendToDoc")(
    { self: this },
    function* (this: SessionMessaging, text: string, at: DocPlace, opts: SendOptions = {}) {
      yield* this.mayI({ kind: "msg", to: yield* this.resolveTo(opts.to) });
      const body = opts.re?.length ? text : addressed(text, opts.to);
      const id = yield* this.postedBlock(body, at, opts.imgs, opts.files);
      return yield* this.send(body, { ...opts, block: { th: at.th, id } }).pipe(Effect.tapError(() => this.unwrite(at, id)));
    },
    oneLook,
  );

  private unwrite(at: DocPlace, id: string) {
    return Effect.gen({ self: this }, function* () {
      const { state } = yield* this.state();
      yield* Effect.tryPromise(() => dropBlock(this.ch, state.head, at, id)).pipe(Effect.ignore);
    });
  }

  private postedBlock(body: string, at: DocPlace, imgs: readonly ImageAttachment[] = [], files: readonly FileAttachment[] = []) {
    return Effect.gen({ self: this }, function* () {
      const { state } = yield* this.state();
      const me = state.members.get(this.me);
      const agent = !me || !isPerson(me);
      const stored = yield* Effect.forEach(
        imgs,
        (img) =>
          img.ref || img.data === undefined ? Effect.succeed<ImageAttachment>(img) : this.ch.fx.putImage({ name: img.name, mime: img.mime, data: img.data }).pipe(Effect.orElseSucceed(() => img)),
        { concurrency: 4 },
      );
      const media: BlockMedia[] = [...stored.flatMap((img): BlockMedia[] => (img.ref ? [{ image: { ...img, ref: img.ref } }] : [])), ...files.map((file) => ({ file }))];
      return yield* Effect.tryPromise({
        try: () => writeBlock(this.ch, state.head, at, this.me, body, agent, true, media),
        catch: (e) => new Rejected(`couldn't write to the shared doc: ${e instanceof Error ? e.message : "error"}; nothing was sent`),
      });
    });
  }

  readonly withBlockMedia = Effect.fn("AgentSession.withBlockMedia")({ self: this }, function* (this: SessionMessaging, m: Message) {
    if (!m.block || m.imgs?.length || m.files?.length || !/\[(?:image|file): /.test(m.body ?? "")) return m;
    const { state } = yield* this.state();
    const at = docPlaceOfMessage(state, m);
    if (!at) return yield* new Rejected(`#${m.seq}'s line is in a direct conversation's doc, which agents can't open`);
    const id = m.block.id;
    const { imgs, files } = yield* Effect.tryPromise({
      try: () => blockMedia(this.ch, state.head, at, id),
      catch: (e) => new Rejected(`couldn't read #${m.seq}'s images from the shared doc: ${e instanceof Error ? e.message : "error"}`),
    });
    return { ...m, ...(imgs.length ? { imgs } : {}), ...(files.length ? { files } : {}) };
  });

  readonly docText = Effect.fn("AgentSession.docText")({ self: this }, function* (this: SessionMessaging, at: DocPlace, ms?: number, docOnly = false) {
    const { state } = yield* this.state();
    return yield* Effect.tryPromise({
      try: () => readDoc(this.ch, state.head, at, ms, docOnly),
      catch: (e) => new Rejected(`couldn't read the shared doc: ${e instanceof Error ? e.message : "error"}`),
    });
  });

  private mayI(m: { kind: Kind; ev?: Frozen<Event>; to?: string[] }) {
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

  readonly replyPlaced = Effect.fn("AgentSession.replyPlaced")(
    { self: this },
    function* (this: SessionMessaging, seq: number, body: string, kind: Kind = "msg", imgs?: ImageAttachment[], extra: Pick<SendOptions, "settled" | "files"> = {}, at: DocPlace | null = null) {
      const { messages, state } = yield* this.state();
      const orig = yield* this.message(seq, messages);
      if (!orig) return yield* new Rejected(`no message #${seq}`);
      const lead = orig.from === this.me ? null : leadHoldsFor(state, this.me);
      if (lead !== null && handedToLead(state, seq))
        return yield* new Rejected(`#${seq} is handed to ${lead}, the Lead: only the Lead or a person answers it, so tell @${lead} what you know in a message instead`);
      const to = orig.from === this.me ? orig.to : [orig.from];
      yield* this.mayI({ kind, to });
      const block = at && kind === "msg" ? { th: at.th, id: yield* this.postedBlock(body, at, imgs, extra.files) } : undefined;
      const replying = { to, kind, re: [seq], side: true, imgs, room: state.roomOf.get(seq) ?? orig.room, ...extra, ...(block ? { block } : {}) };
      const me = state.members.get(this.me);
      const shared = orig.from !== this.me && !(orig.to?.length === 1 && orig.to[0] === this.me) && !(me && isPerson(me));
      const asked = state.lead === this.me || !!orig.to?.includes(this.me) || mentionsOf(orig.body).has(this.me.toLowerCase());
      const post = (re: number, claim: boolean) =>
        this.ch.fx.send(body, { ...replying, re: [re], ...(claim ? { slot: { name: `re:${seq}`, ttl: ANSWERING_TTL } } : {}), wake: wakeList(state, this.me, replying) });
      const placed = post(seq, shared && !asked).pipe(
        Effect.map((sent): Placed => ({ seq: sent })),
        Effect.catchIf(
          (err): err is RelayError => err instanceof RelayError && err.tag === "Taken",
          (err) =>
            Effect.gen({ self: this }, function* () {
              const holds = Number(/#(\d+)/.exec(err.message)?.[1] ?? 0);
              const held = holds ? (yield* this.ch.fx.page(holds - 1, 1).pipe(Effect.orElseSucceed((): Message[] => []))).find((m) => m.seq === holds) : undefined;
              const answers = (m: Message) => m.kind !== "event" && !!m.re?.includes(seq);
              const first = held && held.from !== this.me ? (messages.find((m) => m.from === held.from && answers(m)) ?? (answers(held) ? held : undefined)) : undefined;
              if (!first) return { seq: yield* post(seq, false) };
              const mine = messages.find((m) => m.from === this.me && m.re?.includes(first.seq));
              if (mine) return yield* new Rejected(`you already added #${mine.seq} under ${first.from}'s answer to #${seq}: carry on there with kiwi reply ${mine.seq} "…"`);
              return { seq: yield* post(first.seq, false), under: { answer: first.seq, by: first.from } };
            }),
        ),
      );
      return yield* placed.pipe(Effect.tapError(() => (at && block ? this.unwrite(at, block.id) : Effect.void)));
    },
    oneLook,
  );

  readonly reply = Effect.fn("AgentSession.reply")(
    { self: this },
    function* (this: SessionMessaging, seq: number, body: string, kind: Kind = "msg", imgs?: ImageAttachment[], extra: Pick<SendOptions, "settled" | "files"> = {}, at: DocPlace | null = null) {
      return (yield* this.replyPlaced(seq, body, kind, imgs, extra, at)).seq;
    },
  );

  readonly answering = Effect.fn("AgentSession.answering")(
    { self: this },
    function* (this: SessionMessaging, seq: number) {
      const { messages, state } = yield* this.state();
      if (!(yield* this.message(seq, messages)) || ignored(state.trust.get(seq))) return yield* new Rejected(`no message #${seq}`);
      const sent = yield* this.event({ op: "fact.set", key: answeringKey(seq), value: this.me, ttl: ANSWERING_TTL / 1000 }, `answering #${seq}`, undefined, undefined, {
        slot: { name: `re:${seq}`, ttl: ANSWERING_TTL },
      }).pipe(this.taken((who) => `${who} is already answering #${seq}; a reply of yours still goes out, under theirs`));
      return yield* this.confirm(sent);
    },
    oneLook,
  );

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
      const done = yield* this.confirm(sent);
      const at = docPlaceOfMessage(state, original);
      if (at && original.block) {
        const id = original.block.id;
        yield* Effect.tryPromise(() => (body === null ? dropBlock(this.ch, state.head, at, id) : editBlock(this.ch, state.head, at, id, body))).pipe(Effect.ignore);
      }
      return done;
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
      ask: {
        choices?: string[];
        task?: number;
        holds?: number[];
        decision?: DecisionKind;
        area?: string;
        step?: Step;
      } & Pick<SendOptions, "id" | "permission"> = {},
    ) {
      if (!body.trim()) return yield* new Rejected(`say what needs ${ask.step ? "doing" : "deciding"}: the text is empty`);
      const { messages, state } = yield* this.state();
      const me = state.members.get(this.me);
      if (me && isPerson(me)) return yield* new Rejected("escalating is for agents: you're a person, so you decide");
      if (handoff && handoff.expiresAt - Date.now() > HANDOFF_MAX_SECONDS * 1000 + 5000) return yield* new Rejected(`a browser handoff link lasts at most ${HANDOFF_MAX_SECONDS / 60} minutes`);
      if (re !== undefined && !(yield* this.message(re, messages))) return yield* new Rejected(`no message #${re}`);
      const to = escalationTargets(state, this.me);
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
      const lead = handoff || ask.permission || ask.decision === "irreversible" ? null : leadForAsk(state, this.me);
      const start = lead === null || re === undefined ? null : directThreadStart(state, re);
      const opener = start === null ? undefined : state.members.get((yield* this.message(start, messages))?.from ?? "");
      if (lead !== null && !(opener && isPerson(opener))) {
        const holds = ask.holds?.map((id) => (state.tasks.has(id) ? taskId(id) : `#${id}`));
        const handed = yield* this.send(
          handedOver(this.me, body, {
            ...(ask.choices ? { choices: ask.choices } : {}),
            ...(holds?.length ? { holds } : {}),
            ...(ask.decision ? { decision: ask.decision } : {}),
            ...(ask.area ? { area: ask.area } : {}),
            ...(ask.step ? { step: ask.step } : {}),
          }),
          { to: [lead], kind: "blocking", ...(ask.task !== undefined ? { task: ask.task } : {}), ...(re !== undefined ? { re: [re] } : {}) },
        );
        yield* this.confirm(handed);
        return { seq: handed, to: [lead], also: [], lead };
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
        ...(ask.area ? { area: ask.area } : {}),
        ...(ask.step ? { step: ask.step } : {}),
        ...(ask.id ? { id: ask.id } : {}),
        ...(ask.permission ? { permission: ask.permission } : {}),
        ...(re !== undefined ? { re: [re] } : {}),
      });
      yield* this.confirm(seq);
      return {
        seq,
        to,
        also: decidersOf(state, { esc: true, to, ...(handoff ? { handoff } : {}), ...(ask.permission ? { permission: ask.permission } : {}), ...(ask.step ? { step: ask.step } : {}) }),
        lead: null,
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

  protected event(ev: Event, body: string, to?: string[], re?: number, slots: Pick<SendOptions, "slot" | "free" | "occurrence" | "after"> = {}) {
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
      const real = realSession(here());
      const session = real ? yield* Effect.promise(() => sessionFingerprint(this.ch.roomId, real)) : me?.card?.session;
      const merged = { ...mergeCard(detected, me?.card, given), ...(session ? { session } : {}) };
      const card = me?.runs ? omit(merged, "harness", "model") : merged;
      if (!me || isPerson(me) || !canPost(me.scopes) || state.hold || sameCard(me.card, card)) return { sent: false, card };
      yield* this.event({ op: "card", ...card }, `card: ${cardLine(card)}`);
      return { sent: true, card };
    },
    oneLook,
  );

  readonly refreshSession = Effect.fn("AgentSession.refreshSession")(
    { self: this },
    function* (this: SessionMessaging, who: Here) {
      const real = realSession(who);
      if (!real) return { sent: false };
      const { state } = yield* this.state();
      const me = state.members.get(this.me);
      const session = yield* Effect.promise(() => sessionFingerprint(this.ch.roomId, real));
      if (!me || isPerson(me) || !canPost(me.scopes) || state.hold || me.card?.session === session) return { sent: false };
      const card = { ...(me.card ? omit(me.card, "at") : {}), session };
      yield* this.event({ op: "card", ...card }, `card: ${cardLine(card)}`);
      return { sent: true };
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
    const { state } = yield* this.state();
    const me = state.members.get(this.me);
    const lead = !!me && (!!me.owner || me.persona?.role === "lead" || state.lead === this.me);
    const late = checkChangeRefusal(landingTouchedByClose(state.tasks, state.checks, ask), { person: !!me && isPerson(me), lead }, "closes a check on");
    if (late) return yield* new Rejected(late);
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
      const ttl = Math.round(ttlSec);
      const held = yield* this.heldByMe(name);
      if (!held) {
        const seq = yield* this.event({ op: "lease.take", name, ttl, ...(note ? { note } : {}) }, `asked for ${name}`);
        const lease = (yield* this.confirm(seq)).leases.get(name);
        if (!lease) return yield* new Rejected(`${name} didn't take`);
        return lease;
      }
      const seq = yield* this.renewWhileHeld(name, ttl, note, held);
      const after = (yield* this.retryRead(this.state(), Date.now() + RENEW_CONFIRM_MS, unconfirmed(name))).state;
      const lease = after.leases.get(name);
      if (after.rejected.has(seq) || lease?.holder !== this.me) return yield* new Rejected(`${name} was renewed, but you no longer hold it: kiwi status shows who does`);
      return lease;
    },
    oneLook,
  );

  private heldByMe(name: string) {
    return Effect.gen({ self: this }, function* () {
      const asked = Date.now();
      let limited = false;
      const read = this.state().pipe(
        Effect.provideService(OfflineReads, { note: () => {} }),
        Effect.tapError((err) => Effect.sync(() => void (readLimited(err) && (limited = true)))),
      );
      const known = yield* this.retryRead(read, asked + FIRST_READ_WAIT_MS, stillLimited(name));
      const lease = known.state.leases.get(name);
      if (lease?.holder === this.me && lease.until > Date.now()) return lease;
      if (limited && this.mayHaveHeld(known.messages, lease, name, asked)) return yield* unsure(name);
      return null;
    });
  }

  private mayHaveHeld(messages: readonly Message[], lease: Frozen<Lease> | undefined, name: string, asked: number): boolean {
    if (lease?.holder && lease.holder !== this.me && lease.since <= asked) return false;
    const mine = messages.filter((m) => m.from === this.me && (m.ev?.op === "lease.take" || m.ev?.op === "lease.free") && m.ev.name === name);
    const last = mine.at(-1);
    if (last?.ev?.op !== "lease.take") return false;
    return (last.rts ?? last.ts) + LEASE_WAIT_MS + last.ev.ttl * 1000 > asked;
  }

  private renewWhileHeld(name: string, ttl: number, note: string | undefined, held: Frozen<Lease>) {
    const deadline = held.until - AFTER_SKEW_MS;
    const judgedAndSent = Effect.gen({ self: this }, function* () {
      const { state } = yield* this.retryRead(this.state(), deadline, tooLate(name, held.until));
      const lease = state.leases.get(name);
      if (lease?.holder !== this.me || lease.since !== held.since) return yield* endedFirst(name);
      const at = Date.now();
      if (lease.until - AFTER_SKEW_MS <= at) return yield* tooLate(name, lease.until);
      return yield* this.event({ op: "lease.take", name, ttl, ...(note ? { note } : {}) }, `renewed ${name}`, undefined, undefined, { after: { head: state.head, at } });
    });
    const inOwnLook = Effect.suspend(() => Effect.provideService(judgedAndSent, Look, { fetched: new WeakSet(), seen: new WeakMap() }));
    const race = (left: number): Effect.Effect<number, Refused | Rejected, Agent> =>
      Effect.catchIf(
        inOwnLook,
        (err) => relayRefused(err, "MovedOn") || relayRefused(err, "OffClock"),
        (err) => (left > 0 ? race(left - 1) : Effect.fail(relayRefused(err, "OffClock") ? offClock : keptMoving(name))),
      );
    return race(RENEW_RACES);
  }

  private retryRead<A, E, R>(read: Effect.Effect<A, E, R>, until: number, giveUp: Rejected): Effect.Effect<A, E | Rejected, R> {
    const attempt = (wait: number): Effect.Effect<A, E | Rejected, R> =>
      Effect.catchIf(read, readLimited, () => {
        const left = until - Date.now();
        if (left <= 0) return Effect.fail(giveUp);
        return Effect.andThen(Effect.sleep(Math.min(wait, Math.max(left / 2, READ_RETRY_LAST_MS))), attempt(Math.min(wait * 2, READ_RETRY_MAX_MS)));
      });
    return attempt(READ_RETRY_FIRST_MS);
  }

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
