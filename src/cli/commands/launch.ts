import * as Effect from "effect/Effect";
import { opt } from "../args.ts";
import { type Command, out } from "../context.ts";

export const launchCommands: Record<string, Command> = {
  harnesses: () =>
    Effect.gen(function* () {
      const { daemonHarnesses, ensureDaemon } = yield* Effect.promise(() => import("../../daemon.ts"));
      const { inventoryText } = yield* Effect.promise(() => import("../../launch/harnesses.ts"));
      yield* Effect.promise(() => ensureDaemon());
      const rows = yield* Effect.promise(() => daemonHarnesses());
      out(opt.json ? JSON.stringify(rows) : inventoryText(rows));
    }),
};
