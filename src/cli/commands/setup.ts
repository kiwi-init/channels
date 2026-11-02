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
import { opt } from "../args.ts";
import { type Command, out, Quit, relayUrl } from "../context.ts";
import { confirm } from "../input.ts";

const plainKey = (key: string) => key.replace(/\s+/g, "").toLowerCase();

async function sameKey({ name, fingerprint }: { name: string; fingerprint: string }): Promise<boolean> {
  out(`The key that approved this computer is ${fingerprint} (it says it's ${name}).`);
  out(`Your app shows your key next to the digits it asks for, and in Settings as "Your key for new devices".`);
  if (typeof opt.fingerprint === "string") return plainKey(opt.fingerprint) === plainKey(fingerprint);
  process.stdout.write(`Is ${fingerprint} the key your app shows? [y/N] `);
  for await (const line of console) return /^y(es)?$/i.test(line.trim());
  return false;
}

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
      out("To let this computer's agents in on their own, run kiwi login here and type the digits it shows in your");
      out("Channels app: this computer becomes one of your devices, and your app can start agents on it.");
    }),

  login: () =>
    Effect.gen(function* () {
      if (typeof opt.fingerprint !== "string" && !process.stdin.isTTY)
        return yield* new Quit({
          message: `kiwi login asks you to check your key, and there's no terminal to ask on: run kiwi login --fingerprint "<Your key for new devices, from your app's Settings>"`,
          code: 1,
        });
      const { loginComputer } = yield* Effect.promise(() => import("../../login.ts"));
      const { ensureDaemon, loadPairedMachine, PairError } = yield* Effect.promise(() => import("../../daemon.ts"));
      yield* Effect.tryPromise({
        try: () => loginComputer({ relay: relayUrl(), ...(typeof opt.user === "string" ? { user: opt.user } : {}), confirm: sameKey }),
        catch: (err) => (err instanceof PairError ? new Quit({ message: err.message, code: err.code }) : err),
      });
      const paired = loadPairedMachine();
      if (!paired?.cert && !paired?.device?.links.length) return;
      const running = yield* Effect.promise(() =>
        ensureDaemon().then(
          () => true,
          () => false,
        ),
      );
      out(running ? "its kiwi daemon is running, so your app can start agents here now." : "its kiwi daemon didn't start: run kiwi daemon here, or your app can't reach this computer.");
    }),

  unpair: () =>
    Effect.gen(function* () {
      const { daemonUnpair, ensureDaemon } = yield* Effect.promise(() => import("../../daemon.ts"));
      yield* Effect.promise(() => ensureDaemon());
      yield* Effect.promise(() => daemonUnpair());
      out("your app can't start agents here any more: it takes no more asks from your app (kiwi login lets it again)");
    }),

  cleanup: () =>
    Effect.gen(function* () {
      const quiet = opt.quiet === true;
      const done = cleanup({ home: home(), bin: binDir() });
      const running = yield* Effect.promise(() => daemonHello().catch(() => null));
      if (running && compareVersions(running.version, VERSION) < 0) {
        yield* Effect.promise(() => stopDaemon());
        done.removed.push(`the kiwi ${running.version} daemon (the next kiwi command starts ${VERSION})`);
      }
      for (const r of done.removed) out(`removed ${r}`);
      for (const w of done.warnings) out(`note: ${w}`);
      if (!done.removed.length && !done.warnings.length && !quiet) out("nothing to clean up");
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
