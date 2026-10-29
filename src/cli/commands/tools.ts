import * as Effect from "effect/Effect";
import { existsSync } from "node:fs";
import { join as joinPath } from "node:path";
import { opt } from "../args.ts";
import { type Command, out, session } from "../context.ts";

export const toolCommands: Record<string, Command> = {
  mcp: () =>
    Effect.gen(function* () {
      const { runMcp } = yield* Effect.promise(() => import("../../mcp.ts"));
      yield* runMcp(yield* session(), { push: opt.push });
    }),

  relay: () =>
    Effect.gen(function* () {
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
