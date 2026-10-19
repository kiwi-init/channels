import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { reason } from "@kiwi/core/client.ts";
import { Keystore } from "../../config.ts";
import {
  EXTRA_HARNESSES,
  extraInstalled,
  hooksInstalled,
  hooksStatus,
  installDetected,
  installExtra,
  installHooks,
  runHook,
  uninstallDetected,
  uninstallExtra,
  uninstallHooks,
  type ExtraHarness,
} from "../../hooks.ts";
import { args } from "../args.ts";
import { type Command, die, out } from "../context.ts";

export const hookCommands: Record<string, Command> = {
  hook: () =>
    runHook(args[1] ?? "").pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          process.stderr.write(`kiwi: hooks are off until this is fixed: ${reason(Cause.squash(cause))}\n`);
          return 0;
        }),
      ),
    ),

  hooks: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const sub = args[1] ?? "status";
      const raw = args[2];
      const usage = "usage: kiwi hooks install|uninstall|status [claude|codex|gemini|cursor|grok|kimi|pi]";
      let name: "claude" | ExtraHarness | undefined;
      if (raw) {
        if (raw !== "claude" && !EXTRA_HARNESSES.includes(raw as ExtraHarness)) return yield* die(usage);
        name = raw as "claude" | ExtraHarness;
      }
      const allOn = () => Object.fromEntries(EXTRA_HARNESSES.map((h) => [h, "on" as const]));
      const allOff = () => Object.fromEntries(EXTRA_HARNESSES.map((h) => [h, "off" as const]));
      if (sub === "install") {
        if (!name || name === "claude") {
          yield* keys.update((c) => {
            c.claudeHooks = "on";
          });
        }
        if (!name) {
          yield* keys.update((c) => {
            c.harnessHooks = allOn();
          });
          return out(`installed hooks in ${installDetected().join(", ")}`);
        }
        if (name !== "claude") {
          const h = name;
          yield* keys.update((c) => {
            c.harnessHooks = { ...c.harnessHooks, [h]: "on" };
          });
          return out(`installed hooks in ${installExtra(h)}`);
        }
        return out(`installed hooks in ${installHooks()}`);
      }
      if (sub === "uninstall") {
        if (!name) {
          yield* keys.update((c) => {
            c.claudeHooks = "off";
            c.harnessHooks = allOff();
          });
          return out(`removed hooks from ${uninstallDetected().join(", ")}`);
        }
        if (name === "claude") {
          yield* keys.update((c) => {
            c.claudeHooks = "off";
          });
          return out(`removed hooks from ${uninstallHooks()}`);
        }
        const h = name;
        yield* keys.update((c) => {
          c.harnessHooks = { ...c.harnessHooks, [h]: "off" };
        });
        return out(`removed hooks from ${uninstallExtra(h)}`);
      }
      if (sub === "status") {
        if (!name) return out(hooksStatus());
        if (name === "claude") return out(hooksInstalled() ? "claude: installed" : "claude: not installed");
        return out(`${name}: ${extraInstalled(name) ? "installed" : "not installed"}`);
      }
      return yield* die(usage);
    }),
};
