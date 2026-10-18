import { cleanPersona, personaScopes, type Persona } from "../personality.ts";
import * as Effect from "effect/Effect";
import { newChannelKey } from "../crypto.ts";
import { inlineText, makeRecord, sealRecord, type Member } from "../membership.ts";
import { omit } from "../omit.ts";
import { Rejected } from "../refusals.ts";
import { canPost, SCOPES, scopesOf, type Scope } from "../scopes.ts";
import type { ChannelState } from "../state.ts";
import type { ChannelCore } from "./core.ts";
import type { MemberRefusal, Refused } from "./errors.ts";
import type { ChannelInfo } from "./info.ts";
import { wrapFor } from "./keys.ts";
import type { Relay } from "./relay.ts";

export interface MembersFx {
  leave(): Effect.Effect<void, MemberRefusal, Relay>;
  setCanPost(pk: string, post: boolean): Effect.Effect<void, Refused, Relay>;
  updateScopes(m: Member, scopes: readonly Scope[], since: number): Effect.Effect<void, Refused, Relay>;
  updateRole(m: Member, role: string | null, about: string | null | undefined, since: number): Effect.Effect<void, Refused, Relay>;
  updatePersona(m: Member, persona: Persona | null, since: number): Effect.Effect<void, Refused, Relay>;
  updateNickname(m: Member, nickname: string | null): Effect.Effect<void, Refused, Relay>;
  reconcilePosting(state: Pick<ChannelState, "members" | "scopeSets" | "roleSets">, members?: Member[]): Effect.Effect<string[], Refused, Relay>;
  remove(pk: string): Effect.Effect<void, Refused, Relay>;
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
      yield* this.ch.request("/members/me", { method: "DELETE" });
    }),

    setCanPost: Effect.fn("Channel.setCanPost")({ self: this }, function* (this: ChannelMembers, pk: string, post: boolean) {
      yield* this.ch.ownerOnly();
      yield* this.ch.request(`/members/${pk}/post`, { method: "PUT", body: JSON.stringify({ post }) });
    }),

    updateScopes: Effect.fn("Channel.updateScopes")({ self: this }, function* (this: ChannelMembers, m: Member, scopes: readonly Scope[], since: number) {
      yield* this.ch.ownerOnly();
      if (m.owner) return yield* new Rejected("the owner may do everything");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const info = omit(m, "active", "readOnly", "unverified", "at");
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, { ...info, later: { scopes: [...scopes], since } })));
      yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    updatePersona: Effect.fn("Channel.updatePersona")({ self: this }, function* (this: ChannelMembers, m: Member, persona: Persona | null, since: number) {
      yield* this.ch.ownerOnly();
      if (m.owner || m.kind === "human") return yield* new Rejected("only an agent's record carries a personality");
      const clean = persona === null ? null : cleanPersona(persona);
      if (clean === null && persona !== null) return yield* new Rejected("that personality isn't one a record can carry: check its name, role, capabilities, areas and instructions");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const { persona: _was, ...info } = omit(m, "active", "readOnly", "unverified", "at");
      const scopes = clean ? personaScopes(clean) : [...SCOPES];
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, { ...info, ...(clean ? { persona: clean } : {}), later: { scopes, since } })));
      yield* this.ch.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    updateRole: Effect.fn("Channel.updateRole")({ self: this }, function* (this: ChannelMembers, m: Member, role: string | null, about: string | null | undefined, since: number) {
      yield* this.ch.ownerOnly();
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
      if (m.owner || m.kind === "human") return yield* new Rejected("only an agent's nickname is changed this way");
      const e = this.ch.access.epoch;
      const key = this.ch.access.keys[String(e)]!;
      const info = omit(m, "active", "readOnly", "unverified", "at", "display");
      const display = inlineText(nickname ?? "", 40);
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.ch.identity, this.ch.roomId, { ...info, ...(display ? { display } : {}) })));
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
          yield* this.ch.fx.updateScopes(m, set.scopes, set.seq);
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
      yield* this.ch.request(`/members/${pk}`, { method: "DELETE" });
      yield* this.ch.fx.rotate();
    }),

    rotate: Effect.fn("Channel.rotate")({ self: this }, function* (this: ChannelMembers) {
      yield* this.ch.ownerOnly();
      const members = (yield* this.ch.fx.members()).filter((m) => m.active && !m.unverified);
      this.info.forgetInfo();
      const { epoch } = yield* this.ch.fx.info();
      const next = epoch + 1;
      const key = newChannelKey();
      const keys = yield* Effect.promise(async () => {
        const out: Record<string, string> = {};
        for (const m of members) out[m.pk] = await wrapFor(this.ch.identity, this.ch.roomId, next, m.pk, m.xpk, key);
        return out;
      });
      yield* this.ch.request("/epochs", { method: "POST", body: JSON.stringify({ epoch: next, keys }) }).pipe(Effect.ensuring(Effect.sync(() => this.info.forgetInfo())));
      this.ch.access = { ...this.ch.access, epoch: next, keys: { ...this.ch.access.keys, [String(next)]: key } };
      this.ch.onAccess?.(this.ch.access);
      return next;
    }),

    rotateIfDue: Effect.fn("Channel.rotateIfDue")({ self: this }, function* (this: ChannelMembers) {
      if (!this.ch.isOwner) return false;
      this.info.forgetInfo();
      if (!(yield* this.ch.fx.info()).rotate) return false;
      yield* this.ch.fx.rotate();
      return true;
    }),

    close: Effect.fn("Channel.close")({ self: this }, function* (this: ChannelMembers) {
      yield* this.ch.ownerOnly();
      yield* this.ch.request("/", { method: "DELETE" });
    }),
  };
}
