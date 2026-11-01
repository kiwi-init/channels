import { delegationLive } from "../delegation.ts";
import { listedComputer, type DeviceList } from "../devices.ts";
import { cleanPersona, personaScopes, type Persona } from "../personality.ts";
import * as Effect from "effect/Effect";
import { newChannelKey } from "../crypto.ts";
import { sign } from "../identity.ts";
import { inlineText, makeRecord, sealRecord, type Member, type PersonPowers } from "../membership.ts";
import { omit } from "../omit.ts";
import { Rejected } from "../refusals.ts";
import { canPost, SCOPES, scopesOf, type Scope } from "../scopes.ts";
import type { ChannelState } from "../state.ts";
import type { ChannelCore } from "./core.ts";
import { RelayError, type MemberRefusal, type Refused } from "./errors.ts";
import type { ChannelInfo, MemberRow } from "./info.ts";
import { ownerStatement, wrapFor } from "./keys.ts";
import type { Relay } from "./relay.ts";
import { newestEpoch, stale } from "./sealed.ts";

const NO_RECORD = "that key has no record the owner signed: remove it instead";

export interface MembersFx {
  leave(): Effect.Effect<void, MemberRefusal, Relay>;
  setCanPost(pk: string, post: boolean): Effect.Effect<void, Refused, Relay>;
  updateScopes(m: Member, scopes: readonly Scope[], since: number): Effect.Effect<void, Refused, Relay>;
  updateRole(m: Member, role: string | null, about: string | null | undefined, since: number): Effect.Effect<void, Refused, Relay>;
  updatePersona(m: Member, persona: Persona | null, since: number): Effect.Effect<void, Refused, Relay>;
  updateNickname(m: Member, nickname: string | null): Effect.Effect<void, Refused, Relay>;
  updatePowers(m: Member, powers: PersonPowers): Effect.Effect<void, Refused, Relay>;
  reconcilePosting(state: Pick<ChannelState, "members" | "scopeSets" | "roleSets">, members?: Member[]): Effect.Effect<string[], Refused, Relay>;
  remove(pk: string): Effect.Effect<void, Refused, Relay>;
  cutDevices(list: DeviceList): Effect.Effect<Member[], Refused, Relay>;
  dropDelegates(pks: readonly string[]): Effect.Effect<string[], Refused, Relay>;
  rotate(): Effect.Effect<number, Refused, Relay>;
  rotateIfDue(): Effect.Effect<boolean, Refused, Relay>;
  close(): Effect.Effect<void, Refused, Relay>;
}

export class ChannelMembers {
  constructor(
    private readonly ch: ChannelCore,
    private readonly info: ChannelInfo,
  ) {}

  readonly fx: MembersFx = {
    leave: Effect.fn("Channel.leave")({ self: this }, function* (this: ChannelMembers) {
      const me = this.ch.identity;
      yield* Effect.ignore(this.ch.fx.send(`left`, { kind: "event", ev: { op: "member.gone", member: me.name, pk: me.pk } }));
      yield* this.ch.request("/members/me", { method: "DELETE" });
    }),

    setCanPost: Effect.fn("Channel.setCanPost")({ self: this }, function* (this: ChannelMembers, pk: string, post: boolean) {
      yield* this.ch.ownerOnly();
      yield* this.ch.request(`/members/${pk}/post`, { method: "PUT", body: JSON.stringify({ post }) });
    }),

    updateScopes: Effect.fn("Channel.updateScopes")({ self: this }, function* (this: ChannelMembers, m: Member, scopes: readonly Scope[], since: number) {
      yield* this.ch.ownerOnly();
      if (m.unverified) return yield* new Rejected(NO_RECORD);
      if (m.owner) return yield* new Rejected("the owner may do everything");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const info = omit(m, "active", "readOnly", "unverified", "at");
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, { ...info, later: { scopes: [...scopes], since } })));
      yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    updatePersona: Effect.fn("Channel.updatePersona")({ self: this }, function* (this: ChannelMembers, m: Member, persona: Persona | null, since: number) {
      yield* this.ch.ownerOnly();
      if (m.unverified) return yield* new Rejected(NO_RECORD);
      if (m.owner || m.kind === "human") return yield* new Rejected("only an agent's record carries a personality");
      const clean = persona === null ? null : cleanPersona(persona);
      if (clean === null && persona !== null) return yield* new Rejected("that personality isn't one a record can carry: check its name, role, capabilities, areas and instructions");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const info = omit(m, "active", "readOnly", "unverified", "at", "persona");
      const scopes = clean ? personaScopes(clean) : [...SCOPES];
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, { ...info, ...(clean ? { persona: clean } : {}), later: { scopes, since } })));
      yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    updateRole: Effect.fn("Channel.updateRole")({ self: this }, function* (this: ChannelMembers, m: Member, role: string | null, about: string | null | undefined, since: number) {
      yield* this.ch.ownerOnly();
      if (m.unverified) return yield* new Rejected(NO_RECORD);
      if (m.owner) return yield* new Rejected("the owner's record isn't changed this way");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const info = omit(m, "active", "readOnly", "unverified", "at");
      const laterRole = { role, ...(about !== undefined ? { about } : {}), since };
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, { ...info, laterRole })));
      const scopes = m.later?.scopes ?? scopesOf(m);
      yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    updateNickname: Effect.fn("Channel.updateNickname")({ self: this }, function* (this: ChannelMembers, m: Member, nickname: string | null) {
      yield* this.ch.ownerOnly();
      if (m.unverified) return yield* new Rejected(NO_RECORD);
      if (m.owner || m.kind === "human") return yield* new Rejected("only an agent's nickname is changed this way");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const info = omit(m, "active", "readOnly", "unverified", "at", "display");
      const display = inlineText(nickname ?? "", 40);
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, { ...info, ...(display ? { display } : {}) })));
      const scopes = m.later?.scopes ?? scopesOf(m);
      yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    updatePowers: Effect.fn("Channel.updatePowers")({ self: this }, function* (this: ChannelMembers, m: Member, powers: PersonPowers) {
      yield* this.ch.ownerOnly();
      if (m.unverified) return yield* new Rejected(NO_RECORD);
      if (m.owner || m.kind !== "human") return yield* new Rejected("only a person's record says whether they add agents, answer decisions or manage agents");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const info = omit(m, "active", "readOnly", "unverified", "at", "addsAgents", "answersDecisions", "managesAgents");
      const addsAgents = powers.addsAgents ?? !!m.addsAgents;
      const answersDecisions = powers.answersDecisions ?? !!m.answersDecisions;
      const managesAgents = powers.managesAgents ?? !!m.managesAgents;
      const rec = yield* Effect.promise(async () =>
        sealRecord(
          key,
          await makeRecord(this.ch.identity, this.ch.roomId, {
            ...info,
            ...(addsAgents ? { addsAgents } : {}),
            ...(answersDecisions ? { answersDecisions } : {}),
            ...(managesAgents ? { managesAgents } : {}),
          }),
        ),
      );
      const scopes = m.later?.scopes ?? scopesOf(m);
      yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    reconcilePosting: Effect.fn("Channel.reconcilePosting")({ self: this }, function* (this: ChannelMembers, state: Pick<ChannelState, "members" | "scopeSets" | "roleSets">, members?: Member[]) {
      yield* this.ch.ownerOnly();
      const changed: string[] = [];
      for (let m of members ?? (yield* this.ch.fx.members())) {
        if (!m.active || m.owner || m.unverified) continue;
        const folded = state.members.get(m.name);
        if (!folded || folded.pk !== m.pk) continue;
        const roleSet = state.roleSets.get(m.name);
        if (roleSet && (m.laterRole?.since ?? -1) < roleSet.seq) {
          yield* this.ch.fx.updateRole(m, roleSet.role, roleSet.about, roleSet.seq);
          changed.push(m.pk);
          m = { ...m, laterRole: { role: roleSet.role, ...(roleSet.about !== undefined ? { about: roleSet.about } : {}), since: roleSet.seq } };
        }
        const set = state.scopeSets.get(m.pk);
        if (set && (m.later?.since ?? -1) < set.seq) {
          if (set.persona !== undefined && m.kind === "agent") yield* this.ch.fx.updatePersona(m, set.persona, set.seq);
          else yield* this.ch.fx.updateScopes(m, set.scopes, set.seq);
          if (!changed.includes(m.pk)) changed.push(m.pk);
          continue;
        }
        const want = canPost(folded.scopes);
        if (want === !m.readOnly) continue;
        yield* this.ch.fx.setCanPost(m.pk, want);
        if (!changed.includes(m.pk)) changed.push(m.pk);
      }
      return changed;
    }),

    remove: Effect.fn("Channel.remove")({ self: this }, function* (this: ChannelMembers, pk: string) {
      yield* this.ch.ownerOnly();
      const who = (yield* this.ch.fx.members()).find((m) => m.pk === pk);
      if (who) yield* this.ch.fx.send(`removed ${who.name}`, { kind: "event", ev: { op: "member.gone", member: who.name, pk } });
      yield* this.ch.request(`/members/${pk}`, { method: "DELETE" });
      yield* Effect.ignore(Effect.try({ try: () => this.info.markGone(pk), catch: (err) => err }));
      yield* this.rotation(pk);
    }),

    cutDevices: Effect.fn("Channel.cutDevices")({ self: this }, function* (this: ChannelMembers, list: DeviceList) {
      yield* this.ch.ownerOnly();
      const revoked = new Set(list.revoked);
      const certOnly = (pk: string): boolean => !!list.reroots.length && !listedComputer(list, pk);
      const cut = (yield* this.ch.fx.members()).filter(
        (m) =>
          m.active &&
          !m.owner &&
          !m.unverified &&
          ((!!m.device?.pk && revoked.has(m.device.pk) && m.person === list.person) || (!!m.from && (revoked.has(m.from.pk) || certOnly(m.from.pk)) && m.sponsor?.user === list.person)),
      );
      const dropped = (yield* this.ch.fx.delegations().pipe(Effect.catchCause(() => Effect.succeed([])))).filter((d) => d.person === list.person && revoked.has(d.delegate));
      if (!cut.length && !dropped.length) return cut;
      for (const d of dropped) yield* this.ch.fx.undelegate(d.delegate);
      for (const m of cut) {
        yield* this.ch.fx.send(`removed ${m.name}`, { kind: "event", ev: { op: "member.gone", member: m.name, pk: m.pk } });
        yield* this.ch.request(`/members/${m.pk}`, { method: "DELETE" });
        yield* Effect.ignore(Effect.try({ try: () => this.info.markGone(m.pk), catch: (err) => err }));
      }
      yield* this.rotation();
      return cut;
    }),

    dropDelegates: Effect.fn("Channel.dropDelegates")({ self: this }, function* (this: ChannelMembers, pks: readonly string[]) {
      yield* this.ch.ownerOnly();
      const listed = new Set((yield* this.ch.fx.delegations()).map((d) => d.delegate));
      const dropped = pks.filter((pk) => listed.has(pk));
      if (!dropped.length) return dropped;
      for (const pk of dropped) yield* this.ch.fx.undelegate(pk);
      yield* this.rotation();
      return dropped;
    }),

    rotate: Effect.fn("Channel.rotate")({ self: this }, function* (this: ChannelMembers) {
      return yield* this.rotation();
    }),

    rotateIfDue: Effect.fn("Channel.rotateIfDue")({ self: this }, function* (this: ChannelMembers) {
      if (!this.ch.isOwner) return false;
      this.info.forgetInfo();
      const info = yield* this.ch.fx.info();
      const legacy = (yield* Effect.promise(() => ownerStatement(this.ch.roomId, info))) === "legacy";
      if (!info.rotate && !legacy) {
        if (stale(info, this.ch.access.keys)) {
          yield* Effect.ignoreCause(this.ch.fx.resealTitle());
          yield* Effect.ignoreCause(this.ch.fx.resealSettings());
        }
        return false;
      }
      yield* this.rotation(undefined, legacy);
      return true;
    }),

    close: Effect.fn("Channel.close")({ self: this }, function* (this: ChannelMembers) {
      yield* this.ch.ownerOnly();
      yield* this.ch.request("/", { method: "DELETE" });
    }),
  };

  private rotation(without?: string, restate?: boolean): Effect.Effect<number, Refused, Relay> {
    return Effect.gen({ self: this }, function* () {
      yield* this.ch.ownerOnly();
      const rows = yield* this.ch.fx.memberRows();
      const members = (yield* this.ch.fx.members(rows)).filter((m) => m.active && !m.unverified && m.pk !== without);
      this.info.forgetInfo();
      const { epoch, ownerXpk } = yield* this.ch.fx.info();
      const next = Math.max(epoch, newestEpoch(this.ch.access.keys)) + 1;
      if (!Number.isSafeInteger(next) || this.ch.access.keys[String(next)]) return yield* new Rejected(`the relay named epoch ${epoch}, which can't be the channel's next key: not rotating`);
      if (restate && (!this.ch.identity.xpk || this.ch.identity.xpk !== ownerXpk)) {
        return yield* new Rejected("the relay names another exchange key for this channel's owner than the one held here: not restating");
      }
      const key = newChannelKey();
      const stated = restate ? yield* Effect.promise(() => sign(this.ch.identity, { room: this.ch.roomId, xpk: this.ch.identity.xpk!, v: 2 })) : null;
      const delegates = (yield* this.ch.fx.delegations().pipe(Effect.catchCause(() => Effect.succeed([])))).filter((d) => delegationLive(d));
      const holders: { pk: string; xpk: string }[] = members.map((m) => ({ pk: m.pk, xpk: m.xpk }));
      for (const d of delegates) if (!holders.some((h) => h.pk === d.delegate)) holders.push({ pk: d.delegate, xpk: d.dxpk });
      const { keys, older } = yield* Effect.promise(async () => {
        const wrapped: Record<string, string> = {};
        const prior: Record<string, Record<string, string>> = {};
        for (const h of holders) {
          wrapped[h.pk] = await wrapFor(this.ch.identity, this.ch.roomId, next, h.pk, h.xpk, key);
          if (restate) {
            prior[h.pk] = {};
            for (const [e, k] of Object.entries(this.ch.access.keys)) if (Number(e) < next) prior[h.pk]![e] = await wrapFor(this.ch.identity, this.ch.roomId, e, h.pk, h.xpk, k);
          }
        }
        return { keys: wrapped, older: restate ? prior : undefined };
      });
      yield* this.ch
        .request("/epochs", {
          method: "POST",
          body: JSON.stringify({ epoch: next, keys, ...(older ? { older } : {}), ...(stated ? { owner: { pk: this.ch.identity.pk, xpk: this.ch.identity.xpk!, sig: stated.sig } } : {}) }),
        })
        .pipe(
          Effect.mapError((err) => this.stillListed(err, rows, without)),
          Effect.ensuring(Effect.sync(() => this.info.forgetInfo())),
        );
      this.ch.access = { ...this.ch.access, epoch: next, keys: { ...this.ch.access.keys, [String(next)]: key }, ...(restate ? { signedKeys: true } : {}) };
      this.ch.onAccess?.(this.ch.access);
      this.ch.rotating = true;
      yield* Effect.all([Effect.ignoreCause(this.ch.fx.resealTitle()), Effect.ignoreCause(this.ch.fx.resealSettings()), Effect.ignoreCause(this.ch.fx.resealIcon())]).pipe(
        Effect.ensuring(Effect.sync(() => void (this.ch.rotating = false))),
      );
      return next;
    });
  }

  private stillListed(err: MemberRefusal, rows: readonly MemberRow[], without?: string): MemberRefusal | Rejected {
    const said = err instanceof RelayError ? err.message : "";
    const pk8 = /missing wrapped key for ([\w-]{8})$/.exec(said)?.[1];
    if (!pk8 || !rows.some((r) => r.pk.startsWith(pk8) && (r.pk === without || this.info.removed(r.pk)))) return err;
    return new Rejected(`the relay still lists a key this channel removed (${pk8}…), so it won't take the new key: that's the relay's doing; ask whoever runs it (${said})`);
  }
}
