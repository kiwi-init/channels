import * as Effect from "effect/Effect";
import { resolve } from "node:path";
import { isKnownHarness, KNOWN_HARNESSES } from "@kiwi/core/harnesses.ts";
import { PERMISSIONS, readContext, readLaunchChoices } from "@kiwi/core/launch-options.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out } from "../context.ts";

const LAUNCH_USAGE = `usage: kiwi launch HARNESS --code CODE [--folder DIR] [--nick NAME] [--persona TOKEN] [--relay URL] [--model ID] [--effort LEVEL] [--permission ${PERMISSIONS.join("|")}] [--context 1m|400k|…] [--json] (HARNESS: ${KNOWN_HARNESSES.join(", ")}; kiwi harnesses --json says which options each takes)`;

const FOLDERS_USAGE = "usage: kiwi folders [--room ROOM] [--json] · kiwi folders added [--json] · kiwi folders add|remove DIR [--json]";

export const launchCommands: Record<string, Command> = {
  harnesses: () =>
    Effect.gen(function* () {
      const { daemonHarnesses, ensureDaemon } = yield* Effect.promise(() => import("../../daemon.ts"));
      const { inventoryText } = yield* Effect.promise(() => import("../../launch/harnesses.ts"));
      yield* Effect.promise(() => ensureDaemon());
      const rows = yield* Effect.promise(() => daemonHarnesses());
      out(opt.json ? JSON.stringify(rows) : inventoryText(rows));
    }),

  folders: () =>
    Effect.gen(function* () {
      const { loadConfig, saveConfig } = yield* Effect.promise(() => import("../../config.ts"));
      const { launchFolders, withLaunchRoot, withoutLaunchRoot } = yield* Effect.promise(() => import("../../launch/folders.ts"));
      const verb = args[1];
      if (verb === "add" || verb === "remove") {
        const dir = args[2];
        if (!dir) return yield* die(FOLDERS_USAGE);
        const cfg = loadConfig();
        const next = verb === "add" ? withLaunchRoot(cfg, dir) : withoutLaunchRoot(cfg, dir);
        if (typeof next === "string") return yield* die(next);
        saveConfig(next);
        if (opt.json) return out(JSON.stringify({ roots: next.launchRoots ?? [] }));
        out(
          next.launchRoots?.length
            ? `agents can start in:\n${next.launchRoots.join("\n")}`
            : "no folders added: agents start where this computer's agents already work, and here also in your home folder's git repos",
        );
        return 0;
      }
      if (verb === "added") {
        const roots = loadConfig().launchRoots ?? [];
        return out(opt.json ? JSON.stringify({ roots }) : roots.join("\n") || "no folders added");
      }
      if (verb !== undefined) return yield* die(FOLDERS_USAGE);
      const folders = launchFolders(loadConfig(), opt.room);
      out(opt.json ? JSON.stringify(folders) : folders.join("\n"));
    }),

  launch: () =>
    Effect.gen(function* () {
      const harness = args[1];
      const code = opt.code?.trim();
      const context = opt.context === undefined ? undefined : readContext(opt.context);
      const choices = context === null ? null : readLaunchChoices({ model: opt.model, effort: opt.effort, permission: opt.permission, context });
      if (!isKnownHarness(harness) || !code || !choices) return yield* die(LAUNCH_USAGE);
      const relay = opt.relay ?? process.env.KIWI_RELAY;
      const req = {
        harness,
        code,
        folder: resolve(opt.folder ?? process.cwd()),
        ...(relay ? { relay: relay.replace(/\/+$/, "") } : {}),
        ...(opt.nick ? { nick: opt.nick } : {}),
        ...(opt.persona ? { persona: opt.persona } : {}),
        ...choices,
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
