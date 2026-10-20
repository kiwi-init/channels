import * as Effect from "effect/Effect";
import { resolve } from "node:path";
import { isKnownHarness, KNOWN_HARNESSES } from "@kiwi/core/harnesses.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out } from "../context.ts";

const LAUNCH_USAGE = `usage: kiwi launch HARNESS --code CODE [--folder DIR] [--nick NAME] [--persona TOKEN] [--relay URL] [--json] (HARNESS: ${KNOWN_HARNESSES.join(", ")})`;

export const launchCommands: Record<string, Command> = {
  harnesses: () =>
    Effect.gen(function* () {
      const { daemonHarnesses, ensureDaemon } = yield* Effect.promise(() => import("../../daemon.ts"));
      const { inventoryText } = yield* Effect.promise(() => import("../../launch/harnesses.ts"));
      yield* Effect.promise(() => ensureDaemon());
      const rows = yield* Effect.promise(() => daemonHarnesses());
      out(opt.json ? JSON.stringify(rows) : inventoryText(rows));
    }),

  launch: () =>
    Effect.gen(function* () {
      const harness = args[1];
      const code = opt.code?.trim();
      if (!isKnownHarness(harness) || !code) return yield* die(LAUNCH_USAGE);
      const relay = opt.relay ?? process.env.KIWI_RELAY;
      const req = {
        harness,
        code,
        folder: resolve(opt.folder ?? process.cwd()),
        ...(relay ? { relay: relay.replace(/\/+$/, "") } : {}),
        ...(opt.nick ? { nick: opt.nick } : {}),
        ...(opt.persona ? { persona: opt.persona } : {}),
      };
      const { daemonLaunch, ensureDaemon } = yield* Effect.promise(() => import("../../daemon.ts"));
      const { launchedText } = yield* Effect.promise(() => import("../../launch/wire.ts"));
      yield* Effect.promise(() => ensureDaemon());
      const launched = yield* Effect.promise(() => daemonLaunch(req));
      if (opt.json) out(JSON.stringify(launched));
      else if (launched.ok) out(launchedText(launched));
      else return yield* die(launchedText(launched));
      return launched.ok ? 0 : 1;
    }),
};
