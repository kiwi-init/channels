import * as Effect from "effect/Effect";
import { makeDelegation, readDelegation, type Delegation } from "../delegation.ts";
import type { ChannelCore } from "./core.ts";
import type { Refused } from "./errors.ts";
import { wrapAllFor } from "./keys.ts";
import type { Relay } from "./relay.ts";

export interface DelegationsFx {
  delegate(device: { pk: string; xpk: string }, person: string): Effect.Effect<Delegation, Refused, Relay>;
  undelegate(pk: string): Effect.Effect<void, Refused, Relay>;
  delegations(): Effect.Effect<Delegation[], Refused, Relay>;
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
  };
}
