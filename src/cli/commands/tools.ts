import * as Effect from "effect/Effect";
import { existsSync } from "node:fs";
import { join as joinPath } from "node:path";
import { opt } from "../args.ts";
import { type Command, die, out } from "../context.ts";

export const toolCommands: Record<string, Command> = {
  relay: () =>
    Effect.gen(function* () {
      if (typeof Bun.serve !== "function")
        return yield* die(
          "kiwi relay isn't available in this kiwi: it runs inside Channels on the system JavaScriptCore, which can't serve. Run a relay with the standalone CLI: curl -fsSL https://channels.kiwiinit.com/install | sh",
        );
      const { runRelay } = yield* Effect.promise(() => import("../../relay/bun.ts"));
      runRelay(process.argv.slice(3), "kiwi relay");
      return yield* Effect.never;
    }),

  demo: () =>
    Effect.gen(function* () {
      const { demo } = yield* Effect.promise(() => import("../../demo.ts"));
      const built = joinPath(import.meta.dir, "../../../ui/dist");
      yield* demo({ stay: !!opt.stay, ...(existsSync(joinPath(built, "index.html")) ? { web: built } : {}), ...(opt.n ? { pace: Number(opt.n) } : {}) });
    }),

  doctor: () =>
    Effect.gen(function* () {
      const { checks, doctor } = yield* Effect.promise(() => import("../doctor.ts"));
      if (!opt.json) return yield* doctor();
      out(JSON.stringify({ findings: yield* checks() }));
      return 0;
    }),
};
