import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { delegationDue, makeDelegation, readDelegation, type Delegation } from "../delegation.ts";
import { makeRecord, sealRecord } from "../membership.ts";
import { omit } from "../omit.ts";
import type { ChannelCore } from "./core.ts";
import type { Refused } from "./errors.ts";
import { wrapAllFor } from "./keys.ts";
import type { Relay } from "./relay.ts";

export interface Computer {
  pk: string;
  xpk: string;
}

export interface Tended {
  issued: string[];
  dropped: string[];
  adopted: string[];
}

export interface DelegationsFx {
  delegate(device: { pk: string; xpk: string }, person: string): Effect.Effect<Delegation, Refused, Relay>;
  undelegate(pk: string): Effect.Effect<void, Refused, Relay>;
  delegations(): Effect.Effect<Delegation[], Refused, Relay>;
  tendDelegations(computers: readonly Computer[], person: string): Effect.Effect<Tended, Refused, Relay>;
}

export class ChannelDelegations {
  constructor(private readonly ch: ChannelCore) {}

  readonly fx: DelegationsFx = {
    delegate: Effect.fn("Channel.delegate")({ self: this }, function* (this: ChannelDelegations, device: { pk: string; xpk: string }, person: string) {
      yield* this.ch.ownerOnly();
      const d = yield* Effect.promise(() => makeDelegation(this.ch.identity, this.ch.roomId, device, person));
      const keys = yield* Effect.promise(() => wrapAllFor(this.ch.identity, this.ch.roomId, this.ch.access.keys, device.pk, device.xpk));
      yield* this.ch.request("/delegations", { method: "PUT", body: JSON.stringify({ d, keys }) });
      return d;
    }),

    undelegate: Effect.fn("Channel.undelegate")({ self: this }, function* (this: ChannelDelegations, pk: string) {
      yield* this.ch.ownerOnly();
      yield* this.ch.request(`/delegations/${pk}`, { method: "DELETE" });
    }),

    delegations: Effect.fn("Channel.delegations")({ self: this }, function* (this: ChannelDelegations) {
      yield* this.ch.ownerOnly();
      const { delegations } = yield* this.ch.request<{ delegations: { d: string }[] }>("/delegations");
      const out: Delegation[] = [];
      for (const row of delegations) {
        const d = yield* Effect.promise(() => readDelegation(row.d, this.ch.roomId, this.ch.access.ownerPk));
        if (d) out.push(d);
      }
      return out;
    }),

    tendDelegations: Effect.fn("Channel.tendDelegations")({ self: this }, function* (this: ChannelDelegations, computers: readonly Computer[], person: string) {
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
