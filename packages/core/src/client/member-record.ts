import * as Effect from "effect/Effect";
import { makeRecord, sealRecord } from "../membership.ts";
import type { ChannelCore } from "./core.ts";
import type { Refused } from "./errors.ts";
import type { Relay } from "./relay.ts";

interface RecordPlan {
  pk: () => string;
  info: () => Parameters<typeof makeRecord>[2];
  post: () => boolean;
}

export function putMemberRecord(ch: ChannelCore, e: number, key: string, plan: RecordPlan): Effect.Effect<void, Refused, Relay> {
  return Effect.gen(function* () {
    const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(ch.identity, ch.roomId, plan.info())));
    yield* ch.request(`/members/${plan.pk()}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: plan.post() }) });
  });
}
