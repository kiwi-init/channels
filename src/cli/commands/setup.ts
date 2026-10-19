import * as Effect from "effect/Effect";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { home, Keystore } from "../../config.ts";
import { daemonHello, stopDaemon } from "../../daemon.ts";
import { cleanup } from "../../cleanup.ts";
import { VERSION } from "../../version.ts";
import { hooksInstalled, installHooks } from "../../hooks.ts";
import { binDir, ensureOnPath, profileFor } from "@kiwi/core/node/shell-path.ts";
import { compareVersions } from "@kiwi/core/versions.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, Quit, relayUrl } from "../context.ts";
import { confirm } from "../input.ts";

export const setupCommands: Record<string, Command> = {
  setup: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      out("Setting up Kiwi on this computer.\n");
      out(`1. What Kiwi keeps: everything lives in ${home()}, readable only by you. That's your agents' keys and the`);
      out("   channels they're in. Nothing else on this computer is touched.\n");
      if (existsSync(join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")))) {
        if (hooksInstalled()) {
          out("2. Claude Code: Kiwi keeps your agents reachable there (3 hooks). kiwi hooks uninstall removes them.\n");
        } else {
          out("2. Claude Code: Kiwi can keep agents reachable by adding 3 hooks to its settings. They only act in folders");
          out("   where an agent joined a channel: they remind it to listen and hand it messages it missed.");
          const yes = yield* confirm("   Add them?");
          yield* keys.update((c) => {
            c.claudeHooks = yes ? "on" : "off";
          });
          if (yes) installHooks();
          out(yes ? "   Added.\n" : "   Skipped. kiwi hooks install adds them any time.\n");
        }
      }
      if (!Bun.which("kiwi")) {
        const { file, line } = profileFor({ mark: "" });
        const added = ensureOnPath({ mark: "# Added by kiwi setup: puts the kiwi CLI on your PATH." });
        if (added) out(`PATH: added ${binDir()} to ${added}, so a new terminal finds plain kiwi.\n`);
        else if (process.platform === "win32") out(`PATH: to type plain kiwi, add ${binDir()} to your user Path.\n`);
        else out(`PATH: ${file} already names ${binDir()}; open a new terminal to type plain kiwi (or: ${line}).\n`);
      }
      out("To let this computer's agents in on their own, pair it with your Channels app: Your computers → Add a computer,");
      out("then run the kiwi pair kp1-… command it shows, here.");
    }),

  pair: () =>
    Effect.gen(function* () {
      const code = (args[1] ?? (yield* die("usage: kiwi pair kp1-… (the code your app shows)"))).trim();
      const { pairComputer, PairError } = yield* Effect.promise(() => import("../../daemon.ts"));
      yield* Effect.tryPromise({
        try: () => pairComputer(code, { relay: relayUrl() }),
        catch: (err) => (err instanceof PairError ? new Quit({ message: err.message, code: err.code }) : err),
      });
    }),

  cleanup: () =>
    Effect.gen(function* () {
      const done = cleanup({ home: home(), bin: binDir() });
      const running = yield* Effect.promise(() => daemonHello().catch(() => null));
      if (running && compareVersions(running.version, VERSION) < 0) {
        yield* Effect.promise(() => stopDaemon());
        done.removed.push(`the kiwi ${running.version} daemon (the next kiwi command starts ${VERSION})`);
      }
      for (const r of done.removed) out(`removed ${r}`);
      for (const w of done.warnings) out(`note: ${w}`);
      if (!done.removed.length && !done.warnings.length && !opt.quiet) out("nothing to clean up");
    }),

  daemon: () =>
    Effect.gen(function* () {
      const { runDaemonForeground, PairError } = yield* Effect.promise(() => import("../../daemon.ts"));
      yield* Effect.tryPromise({
        try: () => runDaemonForeground(),
        catch: (err) => (err instanceof PairError ? new Quit({ message: err.message, code: err.code }) : err),
      });
    }),
};
