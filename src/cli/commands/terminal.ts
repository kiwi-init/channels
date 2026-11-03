import * as Effect from "effect/Effect";
import { isTerminalId, PLACE_NAMES, readPlacedSeat, type TerminalId, type TerminalRow, type TerminalsStatus } from "@kiwi/core/terminals.ts";
import { loadConfig, updateConfig } from "../../config.ts";
import { showNeedsYou, type NeedsYou, type ShowWhy } from "../../status.ts";
import { helpersOn, placeTools, seatPlaces, showSeat, switchHelpers, terminalPlugin, terminalPlugins } from "../../terminals/registry.ts";
import { parseJson } from "../../terminals/shared/json.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out } from "../context.ts";

const USAGE = "usage: kiwi terminal [status] [--json] | kiwi terminal download|remove rex|tmux | kiwi terminal seats [--json] | kiwi terminal show --needs-you | kiwi terminal show --seat SEAT";

async function terminalsStatus(): Promise<TerminalsStatus> {
  const cfg = loadConfig();
  const plugins = await terminalPlugins(placeTools());
  const terminals = await Promise.all(
    plugins.map(async (p): Promise<TerminalRow> => {
      const found = await p.detect();
      return { id: p.manifest.id, name: p.manifest.name, found: found.found, running: found.running, helpers: p.manifest.helpers ? (helpersOn(p.manifest.id, cfg) ? "on" : "off") : null };
    }),
  );
  return { terminals };
}

function statusText(s: TerminalsStatus): string {
  const rows = s.terminals.map((t) => {
    const state = !t.found ? "not installed" : t.running ? "running" : "installed, not running";
    return `${t.name}: ${state}${t.helpers ? `, helpers ${t.helpers}` : ""}`;
  });
  return rows.join("\n");
}

export function setHelpers(id: TerminalId, on: boolean) {
  return Effect.gen(function* () {
    const plugin = yield* Effect.promise(() => terminalPlugin(id));
    if (!plugin.helpers) return yield* die(`${plugin.manifest.name} has no helpers to download yet`);
    const helpers = plugin.helpers;
    if (on) yield* Effect.promise(() => helpers.download());
    updateConfig((c) => {
      c.terminals = switchHelpers(c.terminals ?? {}, id, on);
    });
    if (!on) yield* Effect.promise(() => helpers.remove());
  });
}

const SHOW_WHY: Record<ShowWhy, string> = {
  "no-rex": "Rex isn't installed",
  "no-server": "its terminal's server isn't running",
  "no-app": "nothing is open to show it in",
  "remote-control": "Rex's remote control is off",
  failed: "its window is gone",
};

function needsYouText(got: Extract<NeedsYou, { shown: null }>): string {
  if (got.failed) return `Couldn't show ${got.failed.waiting.agent} in ${got.failed.waiting.alias}: ${SHOW_WHY[got.failed.why]}`;
  return got.seats ? "Nothing needs you right now" : "No seat here runs where Kiwi can show it (Rex or tmux, with its helpers on)";
}

export const terminalCommands: Record<string, Command> = {
  terminal: () =>
    Effect.gen(function* () {
      const sub = args[1] ?? "status";
      const id = args[2];
      if (sub === "status") {
        const s = yield* Effect.promise(() => terminalsStatus());
        return out(opt.json ? JSON.stringify(s) : statusText(s));
      }
      if (sub === "download" || sub === "remove") {
        if (!isTerminalId(id)) return yield* die(USAGE);
        yield* setHelpers(id, sub === "download");
        return out(statusText(yield* Effect.promise(() => terminalsStatus())));
      }
      if (sub === "show" && opt.seat !== undefined) {
        const seat = readPlacedSeat(parseJson(opt.seat));
        if (!seat) return yield* die("usage: kiwi terminal show --seat SEAT, with SEAT one of kiwi terminal seats --json");
        return out(JSON.stringify(yield* Effect.promise(() => showSeat(seat))));
      }
      if (sub === "show") {
        if (!opt["needs-you"]) return yield* die(USAGE);
        const got = yield* Effect.promise(() => showNeedsYou(loadConfig()));
        if (got.shown) return;
        out(needsYouText(got));
        return got.failed ? 1 : 0;
      }
      if (sub === "seats") {
        const seats = yield* Effect.promise(() => seatPlaces());
        return out(opt.json ? JSON.stringify(seats) : seats.map((s) => `${s.alias} ${s.agent} ${PLACE_NAMES[s.place]}${s.place !== "rex" && s.attach ? `: ${s.attach}` : ""}`).join("\n"));
      }
      return yield* die(USAGE);
    }),
};
