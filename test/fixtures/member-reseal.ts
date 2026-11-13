import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { delegationDue } from "@kiwi/core/delegation.ts";
import { cleanPersona, personaScopes, type Persona } from "@kiwi/core/personality.ts";
import { MAX_NICKNAME } from "@kiwi/core/protocol.ts";
import { inlineText, makeRecord, sealRecord, type Member, type PersonPowers } from "@kiwi/core/membership.ts";
import { omit } from "@kiwi/core/omit.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { canPost, SCOPES, scopesOf, type Scope } from "@kiwi/core/scopes.ts";
import type { ChannelCore } from "@kiwi/core/client/core.ts";
import type { MembersFx } from "@kiwi/core/client/members.ts";
import type { Computer, DelegationsFx, Tended } from "@kiwi/core/client/delegations.ts";
const NO_RECORD = "that key has no record the owner signed: remove it instead";

export const MEMBER_RESEAL_BASE = "287b8f932fe14786fb382c598fb34d281c865b75";

export class BaseMembers {
  constructor(private readonly ch: ChannelCore) {}
  readonly fx: Pick<MembersFx, "updateScopes" | "updatePersona" | "updateRole" | "updateNickname" | "updatePowers"> = {
    updateScopes: Effect.fn("Channel.updateScopes")({ self: this }, function* (this: BaseMembers, m: Member, scopes: readonly Scope[], since: number) {
      yield* this.ch.ownerOnly();
      if (m.unverified) return yield* new Rejected(NO_RECORD);
      if (m.owner) return yield* new Rejected("the owner may do everything");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const info = omit(m, "active", "readOnly", "unverified", "at");
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, { ...info, later: { scopes: [...scopes], since } })));
      yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    updatePersona: Effect.fn("Channel.updatePersona")({ self: this }, function* (this: BaseMembers, m: Member, persona: Persona | null, since: number) {
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

    updateRole: Effect.fn("Channel.updateRole")({ self: this }, function* (this: BaseMembers, m: Member, role: string | null, about: string | null | undefined, since: number) {
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

    updateNickname: Effect.fn("Channel.updateNickname")({ self: this }, function* (this: BaseMembers, m: Member, nickname: string | null) {
      yield* this.ch.ownerOnly();
      if (m.unverified) return yield* new Rejected(NO_RECORD);
      if (m.owner || m.kind === "human") return yield* new Rejected("only an agent's nickname is changed this way");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const info = omit(m, "active", "readOnly", "unverified", "at", "display");
      const display = inlineText(nickname ?? "", MAX_NICKNAME);
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, { ...info, ...(display ? { display } : {}) })));
      const scopes = m.later?.scopes ?? scopesOf(m);
      yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    updatePowers: Effect.fn("Channel.updatePowers")({ self: this }, function* (this: BaseMembers, m: Member, powers: PersonPowers) {
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
  };
}

export class BaseDelegations {
  constructor(private readonly ch: ChannelCore) {}
  readonly fx: Pick<DelegationsFx, "tendDelegations"> = {
    tendDelegations: Effect.fn("Channel.tendDelegations")({ self: this }, function* (this: BaseDelegations, computers: readonly Computer[], person: string) {
      yield* this.ch.ownerOnly();
      const now = Date.now();
      const held = yield* this.ch.fx.delegations();
      const mine = new Set(computers.map((c) => c.pk));
      const issued: string[] = [];
      for (const c of computers) {
        const d = held.find((h) => h.delegate === c.pk);
        if (d && d.person === person && d.dxpk === c.xpk && !delegationDue(d, now)) continue;
        if (Exit.isSuccess(yield* Effect.exit(this.ch.fx.delegate(c, person)))) issued.push(c.pk);
      }
      const stale = held.filter((d) => !mine.has(d.delegate)).map((d) => d.delegate);
      const dropped = stale.length ? yield* this.ch.fx.dropDelegates(stale) : [];
      const adopted: string[] = [];
      for (const m of yield* this.ch.fx.members()) {
        if (!m.active || m.unverified || m.owner || !m.signedBy || !mine.has(m.signedBy)) continue;
        const e = this.ch.access.epoch;
        const key = this.ch.access.keys[String(e)]!;
        const info = omit(m, "active", "readOnly", "unverified", "at", "signedBy");
        const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, info)));
        yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: !m.readOnly }) });
        adopted.push(m.pk);
      }
      return { issued, dropped, adopted } satisfies Tended;
    }),
  };
}
