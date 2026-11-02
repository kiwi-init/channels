// The owner's side of a channel, in-process: what the Kiwi app does for a channel it owns, on top of
// an AgentSession signed with the owner key. Agents never get one (the CLI holds no owner key); the
// demo and the tests play the owner with it, through the client library.

import * as Effect from "effect/Effect";
import { AgentSession } from "./agent.ts";
import { Channel, keepAnswersIn, keepRecordsIn, type Relay } from "@kiwi/core/client.ts";
import { Keystore, type ChannelConfig } from "./config.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { personaScopes, type Persona } from "@kiwi/core/personality.ts";
import { describeScopes, SCOPES, wireScopes, type Scope } from "@kiwi/core/scopes.ts";
import { MAX_CHARTER, SNAPSHOT_EVERY, type Event } from "@kiwi/core/protocol.ts";
import { fold, newRoomId, type FoldBase } from "@kiwi/core/state.ts";

class OwnerSession extends AgentSession {
  private snapshotAt: number | null = null;
  private failedAt = 0;
  private published: number | null = null;
  private forced = false;

  /** The owner key's handle on the channel (the same as `ch`: this session signs as the owner). */
  get ownerCh(): Channel {
    return this.ch;
  }

  /** Pending join requests, checked within this computer's budget. */
  readonly requests = Effect.fn("OwnerSession.requests")({ self: this }, function* (this: OwnerSession) {
    return yield* this.ch.fx.requests({ budget: (yield* Keystore).budget });
  });

  /** Every look finishes what the owner already decided: a rotation owed to someone leaving, the relay's can-post bits. */
  protected override chores() {
    return Effect.gen({ self: this }, function* () {
      const owner = this.ch;
      if (yield* owner.fx.rotateIfDue()) yield* this.ch.fx.refreshKeys();
      if (this.snapshotAt === null) {
        const got = yield* Effect.orElseSucceed(owner.fx.snapshotAt(), () => undefined);
        if (got !== undefined) this.snapshotAt = got ?? 0;
      }
      // The relay's "can post" bit follows the log's scopes: check once a session, and again whenever
      // the roster changes or a scope.set's second step failed. (Not state(): it calls this.)
      if (this.postingChecked) return;
      const [messages, roster] = yield* Effect.all([this.sync(), this.members()], { concurrency: "unbounded" });
      yield* owner.fx.reconcilePosting(fold(messages, roster, Date.now(), undefined, undefined, this.base));
      this.postingChecked = true;
    });
  }

  protected override snapshotDue(head: number): boolean {
    if (this.partial) return false;
    return this.forced || (this.snapshotAt !== null && head - this.snapshotAt >= SNAPSHOT_EVERY && head > this.failedAt);
  }

  protected override publish(base: FoldBase): Effect.Effect<void, never, Relay> {
    return Effect.catchCause(
      Effect.gen({ self: this }, function* () {
        const n = yield* this.ch.fx.putSnapshot(base);
        this.snapshotAt = n;
        this.published = n;
      }),
      () =>
        Effect.sync(() => {
          this.failedAt = base.n;
        }),
    );
  }

  readonly snapshot = Effect.fn("OwnerSession.snapshot")({ self: this }, function* (this: OwnerSession) {
    this.forced = true;
    this.published = null;
    yield* Effect.ensuring(
      this.state(),
      Effect.sync(() => {
        this.forced = false;
      }),
    );
    return this.published;
  });

  /** Owner: make a room. Its id is made here and never changes; the name can (renameRoom). */
  readonly createRoom = Effect.fn("OwnerSession.createRoom")({ self: this }, function* (this: OwnerSession, name: string) {
    const owner = this.ch;
    const id = newRoomId();
    const state = yield* this.roomEvent(owner, { op: "room.create", id, name }, `made the room #${name}`);
    return { id, state };
  });

  /** Owner: rename a room (general too; ids stay). */
  readonly renameRoom = Effect.fn("OwnerSession.renameRoom")({ self: this }, function* (this: OwnerSession, nameOrId: string, name: string) {
    const owner = this.ch;
    const id = yield* this.roomId(nameOrId);
    return yield* this.roomEvent(owner, { op: "room.rename", id, name }, `renamed a room to #${name}`);
  });

  /** Send a room event as the owner, confirm it, then sign the room list into the settings as of it. */
  private roomEvent(owner: Channel, ev: Event, body: string) {
    return Effect.gen({ self: this }, function* () {
      const seq = yield* owner.fx.send(body, { kind: "event", ev });
      const state = yield* this.confirm(seq);
      const list = [...state.rooms.values()].map(({ id, name }) => ({ id, name }));
      yield* owner.fx.setRooms({ list, since: seq });
      this.roomsFloor = { list, since: seq };
      return state;
    });
  }

  readonly givePersona = Effect.fn("OwnerSession.givePersona")({ self: this }, function* (this: OwnerSession, member: string, persona: Persona | null) {
    const owner = this.ch;
    const { state } = yield* this.state();
    const m = state.members.get(member);
    if (!m?.active) return yield* new Rejected(`no member named ${member}`);
    const rec = (yield* owner.fx.members()).find((x) => x.active && x.name === member && x.pk === m.pk);
    if (!rec || rec.owner || rec.kind === "human") return yield* new Rejected("only an agent carries a personality");
    const scopes = wireScopes(persona ? personaScopes(persona) : [...SCOPES]);
    const ev: Event = { op: "scope.set", member, pk: m.pk, scopes, lead: persona?.role === "lead", wasLead: rec.persona?.role === "lead" };
    const seq = yield* owner.fx.send(persona ? `made ${member} ${persona.name}` : `took ${member}'s personality away`, { kind: "event", ev, to: [member] });
    yield* owner.fx.updatePersona(rec, persona, seq);
    return yield* this.confirm(seq);
  });

  /**
   * Owner: what a member may do besides read (null: everything). Signed by the owner key, so every
   * client checks it's the owner's word; it names the member's key, so it never carries over to
   * whoever is admitted under that name next. The relay is told the one bit it enforces itself.
   */
  readonly setScopes = Effect.fn("OwnerSession.setScopes")({ self: this }, function* (this: OwnerSession, member: string, scopes: Scope[] | null) {
    const owner = this.ch;
    const { state } = yield* this.state();
    const m = state.members.get(member);
    if (!m?.active) return yield* new Rejected(`no member named ${member}`);
    if (m.owner) return yield* new Rejected("the owner may do everything");
    const wire = wireScopes(scopes);
    const ev: Event = { op: "scope.set", member, pk: m.pk, scopes: wire, keepLead: true };
    const seq = yield* owner.fx.send(`set what ${member} may do: ${wire ? describeScopes(wire) : "full"}`, { kind: "event", ev });
    const after = yield* this.confirm(seq);
    // Then the member's record says it too (for clients holding only the log's tail), with the relay's
    // bit. If this fails, ownerChores puts both right next time.
    const rec = (yield* owner.fx.members()).find((r) => r.pk === m.pk);
    const recheck = Effect.sync(() => {
      this.postingChecked = false;
    });
    yield* rec ? owner.fx.updateScopes(rec, after.members.get(member)?.scopes ?? [], seq).pipe(Effect.catchCause(() => recheck)) : recheck;
    return after;
  });

  /**
   * Owner: what the channel is for and where its limits are (null clears it). Every agent is shown it,
   * and told to escalate what falls outside it instead of doing it.
   */
  readonly setCharter = Effect.fn("OwnerSession.setCharter")({ self: this }, function* (this: OwnerSession, text: string | null) {
    const owner = this.ch;
    const clean = text?.trim() || null;
    if (clean && clean.length > MAX_CHARTER) return yield* new Rejected(`a charter is at most ${MAX_CHARTER} characters`);
    const since = yield* owner.fx.send(clean ? `charter: ${clean}` : "cleared the charter", { kind: "event", ev: { op: "charter.set", text: clean } });
    // Then the settings say it too, for clients holding only the log's tail.
    yield* owner.fx.setCharter({ text: clean, since });
    this.guardFloor = undefined;
    return yield* this.confirm(since);
  });

  /**
   * Owner: stop every agent, or let them carry on. While on hold every client refuses an agent's work
   * (tasks, facts, messages to other agents); agents may still answer people.
   */
  readonly setHold = Effect.fn("OwnerSession.setHold")({ self: this }, function* (this: OwnerSession, on: boolean, note?: string) {
    const owner = this.ch;
    const clean = note?.trim().slice(0, 500) || undefined;
    const since = yield* owner.fx.send(on ? `on hold${clean ? `: ${clean}` : ""}` : "hold lifted", { kind: "event", ev: { op: "hold.set", on, ...(clean ? { note: clean } : {}) } });
    yield* owner.fx.setHold({ on, ...(clean ? { note: clean } : {}), since });
    this.guardFloor = undefined;
    return yield* this.confirm(since);
  });
}

/** The owner's session on a channel whose owner key this computer holds under `name` (the demo, tests). */
export const openOwnerSession = Effect.fn("OwnerSession.open")(function* (alias: string, cfg: ChannelConfig, name: string) {
  const keys = yield* Keystore;
  keepRecordsIn(keys.records);
  keepAnswersIn(keys.answers ?? null);
  const identity = yield* keys.identity(name, cfg.roomId);
  if (identity.pk !== cfg.ownerPk) return yield* new Rejected(`${name} isn't this channel's owner key`);
  const session = new OwnerSession(alias, cfg, identity, (a) => Effect.runSync(keys.saveAccess(alias, a)));
  session.ownerCh.opensRooms = false;
  return session;
});
