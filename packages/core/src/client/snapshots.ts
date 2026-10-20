import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { SNAPSHOT_EVERY } from "../protocol.ts";
import { MissingKey } from "../refusals.ts";
import { openSnapshot, sealSnapshot, wellFormedSnapshot } from "../snapshot.ts";
import { fold, toRoster, type FoldBase } from "../state.ts";
import type { ChannelCore } from "./core.ts";
import type { MemberRefusal, Refused } from "./errors.ts";
import type { ChannelHistory } from "./history.ts";
import type { Relay } from "./relay.ts";

export interface SnapshotsFx {
  snapshot(): Effect.Effect<FoldBase | null, never, Relay>;
  snapshotAt(): Effect.Effect<number | null, MemberRefusal, Relay>;
  putSnapshot(base: FoldBase): Effect.Effect<number, Refused, Relay>;
  snapshotIfDue(every?: number): Effect.Effect<number | null, Refused, Relay>;
}

export class ChannelSnapshots {
  constructor(
    private readonly ch: ChannelCore,
    private readonly history: ChannelHistory,
  ) {}

  readonly fx: SnapshotsFx = {
    snapshot: Effect.fn("Channel.snapshot")({ self: this }, function* (this: ChannelSnapshots) {
      const got = yield* Effect.exit(this.ch.request<{ snapshot: unknown }>("/snapshot"));
      if (Exit.isFailure(got) || !wellFormedSnapshot(got.value.snapshot)) return null;
      const s = got.value.snapshot;
      yield* this.history.keyFor(s.e);
      return yield* Effect.promise(() => openSnapshot(this.ch.access, s).catch(() => null));
    }),

    snapshotAt: Effect.fn("Channel.snapshotAt")({ self: this }, function* (this: ChannelSnapshots) {
      const { snapshot } = yield* this.ch.request<{ snapshot: { n?: unknown } | null }>("/snapshot", {}, { only: "n" });
      return typeof snapshot?.n === "number" ? snapshot.n : null;
    }),

    putSnapshot: Effect.fn("Channel.putSnapshot")({ self: this }, function* (this: ChannelSnapshots, base: FoldBase) {
      yield* this.ch.ownerOnly();
      yield* this.history.keyFor(this.ch.access.epoch);
      const sealed = yield* Effect.promise(() => sealSnapshot(this.ch.identity, this.ch.access, base));
      if (!sealed) return yield* new MissingKey(this.ch.access.keys[String(this.ch.access.epoch)] ? "the snapshot is too large to store" : "can't seal a snapshot without this epoch's key");
      return (yield* this.ch.request<{ n: number }>("/snapshot", { method: "PUT", body: JSON.stringify({ snapshot: sealed }) })).n;
    }),

    snapshotIfDue: Effect.fn("Channel.snapshotIfDue")({ self: this }, function* (this: ChannelSnapshots, every: number = SNAPSHOT_EVERY) {
      yield* this.ch.ownerOnly();
      const at = (yield* this.ch.fx.snapshotAt()) ?? 0;
      if ((yield* this.ch.fx.head()) - at < Math.max(every, 1)) return null;
      const from = at ? yield* this.ch.fx.snapshot() : null;
      const since = from?.n ?? 0;
      const [{ messages, head: top, through }, members, rooms, guard] = yield* Effect.all(
        [this.ch.fx.history(since), this.ch.fx.members(), Effect.orElseSucceed(this.ch.fx.rooms(), () => null), Effect.orElseSucceed(this.ch.fx.guard(), () => null)],
        { concurrency: "unbounded" },
      );
      if (through !== top || messages.some((m) => m.seq <= since || m.seq > top)) return null;
      const kept: { base?: FoldBase } = {};
      fold(messages, members.map(toRoster), Date.now(), rooms, guard, from, (b) => void (kept.base = b));
      return kept.base && kept.base.n > at ? yield* this.ch.fx.putSnapshot(kept.base) : null;
    }),
  };
}
