import * as Effect from "effect/Effect";
import { loadConfig, updateConfig } from "../../config.ts";
import { rexStatus } from "../../rex.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out } from "../context.ts";

const USAGE = "usage: kiwi rex on|off|status [--json]";

interface RexStatusJson {
  found: boolean;
  version?: string;
  server: "running" | "stopped";
  helpers: "on" | "off";
  rotation: "on" | "off";
}

function statusJson(): RexStatusJson {
  const cfg = loadConfig();
  const rex = rexStatus();
  return {
    found: rex.found,
    ...(rex.version ? { version: rex.version } : {}),
    server: rex.server,
    helpers: cfg.rex === "on" ? "on" : "off",
    rotation: cfg.rotate === "on" ? "on" : "off",
  };
}

function statusText(): string {
  const s = statusJson();
  const where = !s.found ? "Rex isn't installed on this computer" : s.server === "running" ? `Rex${s.version ? ` ${s.version}` : ""} is running` : "Rex is installed but its server isn't running";
  const on =
    s.helpers === "on"
      ? "the Rex helpers are on for this computer: a seat in a terminal that takes OSC 7501 shows when a person is needed or work waits for review. Stays on this computer"
      : "the Rex helpers are off for this computer (kiwi rex on turns them on; nothing of them is loaded while off)";
  return `${where}; ${on} Rotation for this computer is ${s.rotation}.`;
}

export const rexCommands: Record<string, Command> = {
  rex: () =>
    Effect.gen(function* () {
      const sub = args[1] ?? "status";
      if (sub === "status") return out(opt.json ? JSON.stringify(statusJson()) : statusText());
      if (sub === "on" || sub === "off") {
        updateConfig((c) => {
          c.rex = sub;
        });
        if (sub === "off") {
          const { clearStatus } = yield* Effect.promise(() => import("../../status.ts"));
          yield* Effect.promise(() => clearStatus());
        }
        return out(statusText());
      }
      return yield* die(USAGE);
    }),
};
