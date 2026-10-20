import * as Effect from "effect/Effect";
import { loadConfig, updateConfig } from "../../config.ts";
import { installPalette, removePalette, rexConfigPath } from "../../rex-palette.ts";
import { rexBinary, rexStatus, runRex } from "../../rex.ts";
import { localRexSeats, showInRex } from "../../rex-show.ts";
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

function reloadPalette(): void {
  const bin = rexBinary();
  if (!bin || rexStatus().server !== "running") return;
  runRex(bin, ["config", "reload"], 5_000);
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
          removePalette();
          yield* Effect.promise(() => clearStatus());
          reloadPalette();
        } else {
          installPalette();
          reloadPalette();
        }
        return out(statusText());
      }
      if (sub === "seats") {
        const seats = localRexSeats();
        return out(opt.json ? JSON.stringify(seats) : seats.map((s) => `${s.alias} ${s.agent} ${s.block}`).join("\n"));
      }
      if (sub === "show") {
        const server = opt.server;
        const session = opt.session;
        const block = opt.block;
        if (!server || !session || !block) return yield* die("usage: kiwi rex show --server SERVER --session SESSION --block BLOCK");
        const seat = localRexSeats().find((s) => s.server === server && s.session === session && s.block === block);
        if (!seat) return out(JSON.stringify({ ok: false, why: "failed" }));
        return out(JSON.stringify(showInRex(seat)));
      }
      return yield* die(`${USAGE}\n  rex's config: ${rexConfigPath()}`);
    }),
};
