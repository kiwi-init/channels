import * as Effect from "effect/Effect";
import { decodedWhole, olderRules, SNAPSHOT_EVERY, SNAPSHOT_TOO_LARGE, type DocEnvelope } from "../protocol.ts";
import { MissingKey } from "../refusals.ts";
import { openSnapshot, sealSnapshot, wellFormedSnapshot } from "../snapshot.ts";
import { fold, rosterOf, type FoldBase } from "../state.ts";
import type { SecretRoom } from "../state/types.ts";
import { publicView } from "../room-rules.ts";
import type { ChannelCore } from "./core.ts";
import type { MemberRefusal, Refused } from "./errors.ts";
import type { ChannelHistory } from "./history.ts";
import type { Relay } from "./relay.ts";

export interface SnapshotsFx {
  snapshot(): Effect.Effect<FoldBase | null, MemberRefusal, Relay>;
  snapshotAt(): Effect.Effect<number | null, MemberRefusal, Relay>;
  putSnapshot(base: FoldBase): Effect.Effect<number, Refused, Relay>;
  snapshotIfDue(every?: number): Effect.Effect<number | null, Refused, Relay>;
  docList(): Effect.Effect<DocStat[], Refused, Relay>;
  pruneDocs(th: readonly string[]): Effect.Effect<DocsPruned, Refused, Relay>;
  docVersions(th: string): Effect.Effect<DocVersionStat[], Refused, Relay>;
  docVersion(th: string, upto: number): Effect.Effect<DocEnvelope & { snap?: true }, Refused, Relay>;
}

export interface DocVersionStat {
  upto: number;
  ts: number;
  bytes: number;
}

export interface DocStat {
  th: string;
  bytes: number;
  n: number;
  upto: number;
  last: number;
}

export interface DocsPruned {
  dropped: string[];
  kept: string[];
  freed: number;
}

export class ChannelSnapshots {
  constructor(
    private readonly ch: ChannelCore,
    private readonly history: ChannelHistory,
  ) {}

  private readonly sealedSnapshot = Effect.gen({ self: this }, function* () {
    const { snapshot: s } = yield* this.ch.request<{ snapshot: unknown }>("/snapshot");
    if (!wellFormedSnapshot(s)) return null;
    yield* this.history.keyFor(s.e);
    return yield* Effect.promise(() => openSnapshot(this.ch.access, s).catch(() => null));
  });

  readonly fx: SnapshotsFx = {
    snapshot: Effect.fn("Channel.snapshot")({ self: this }, function* (this: ChannelSnapshots) {
      const base = yield* this.sealedSnapshot;
      return base && (yield* this.ch.fx.openRooms(base));
    }),

    snapshotAt: Effect.fn("Channel.snapshotAt")({ self: this }, function* (this: ChannelSnapshots) {
      const { snapshot } = yield* this.ch.request<{ snapshot: { n?: unknown } | null }>("/snapshot", {}, { only: "n" });
      return typeof snapshot?.n === "number" ? snapshot.n : null;
    }),

    putSnapshot: Effect.fn("Channel.putSnapshot")({ self: this }, function* (this: ChannelSnapshots, base: FoldBase) {
      yield* this.ch.ownerOnly();
      yield* this.history.keyFor(this.ch.access.epoch);
      const { keptSeals } = yield* Effect.promise(() => import("../private-room.ts"));
      const kept = base.secret ? { ...base, secret: base.secret.map(([id, r]): [string, SecretRoom] => [id, { ...r, seals: keptSeals(r.seals, (x) => x.n) }]) } : base;
      const sealed = yield* Effect.promise(() => sealSnapshot(this.ch.identity, this.ch.access, kept));
      if (!sealed) return yield* new MissingKey(this.ch.access.keys[String(this.ch.access.epoch)] ? SNAPSHOT_TOO_LARGE : "can't seal a snapshot without this epoch's key");
      return (yield* this.ch.request<{ n: number }>("/snapshot", { method: "PUT", body: JSON.stringify({ snapshot: sealed }) })).n;
    }),

    docList: Effect.fn("Channel.docList")({ self: this }, function* (this: ChannelSnapshots) {
      yield* this.ch.ownerOnly();
      return (yield* this.ch.request<{ docs: DocStat[] }>("/docs")).docs;
    }),

    pruneDocs: Effect.fn("Channel.pruneDocs")({ self: this }, function* (this: ChannelSnapshots, th: readonly string[]) {
      yield* this.ch.ownerOnly();
      if (!th.length) return { dropped: [], kept: [], freed: 0 };
      return yield* this.ch.request<DocsPruned>("/docs/prune", { method: "POST", body: JSON.stringify({ th }) });
    }),

    docVersions: Effect.fn("Channel.docVersions")({ self: this }, function* (this: ChannelSnapshots, th: string) {
      return (yield* this.ch.request<{ versions: DocVersionStat[] }>("/docs/versions", {}, { th })).versions;
    }),

    docVersion: Effect.fn("Channel.docVersion")({ self: this }, function* (this: ChannelSnapshots, th: string, upto: number) {
      return (yield* this.ch.request<{ version: DocEnvelope & { snap?: true } }>("/docs/version", {}, { th, upto: String(upto) })).version;
    }),

    snapshotIfDue: Effect.fn("Channel.snapshotIfDue")({ self: this }, function* (this: ChannelSnapshots, every: number = SNAPSHOT_EVERY) {
      yield* this.ch.ownerOnly();
      const at = (yield* this.ch.fx.snapshotAt()) ?? 0;
      if ((yield* this.ch.fx.head()) - at < Math.max(every, 1)) return null;
      const prior = at ? yield* this.sealedSnapshot : null;
      const whole = prior && olderRules(prior) ? yield* this.ch.fx.history(0) : null;
      const from = whole && decodedWhole(whole) ? null : prior;
      const since = from?.n ?? 0;
      const [{ messages, head: top, through }, members, rooms, guard] = yield* Effect.all(
        [
          whole && !from ? Effect.succeed(whole) : this.ch.fx.history(since),
          this.ch.fx.members(),
          Effect.orElseSucceed(this.ch.fx.rooms(), () => null),
          Effect.orElseSucceed(this.ch.fx.guard(), () => null),
        ],
        { concurrency: "unbounded" },
      );
      if (through !== top || messages.some((m) => m.seq <= since || m.seq > top)) return null;
      const kept: { base?: FoldBase } = {};
      fold(publicView(messages), rosterOf(members), Date.now(), rooms, guard, from, (b) => void (kept.base = b));
      return kept.base && kept.base.n > at ? yield* this.ch.fx.putSnapshot(kept.base) : null;
    }),
  };
}
