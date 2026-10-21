import * as Effect from "effect/Effect";
import { loadConfig, updateConfig, type HelperId } from "../../config.ts";
import type { TerminalId } from "../../terminals/plugin.ts";
import { helpersOn, launchesOn, MANIFESTS, placeTools, preferred, switchHelpers, terminalPlugin, terminalPlugins } from "../../terminals/registry.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out } from "../context.ts";

const USAGE = "usage: kiwi terminal [status] [--json] | kiwi terminal download|remove rex|tmux | kiwi terminal prefer app|rex|tmux";
const LAUNCHES_USAGE = "usage: kiwi launches on|off|status [--json]";

interface TerminalRow {
  id: TerminalId;
  name: string;
  found: boolean;
  running: boolean;
  helpers: "on" | "off" | null;
}

interface TerminalsStatus {
  prefer: TerminalId;
  launch: "on" | "off";
  terminals: TerminalRow[];
}

const isHelperId = (id: string | undefined): id is HelperId => id === "rex" || id === "tmux";
const isTerminalId = (id: string | undefined): id is TerminalId => MANIFESTS.some((m) => m.id === id);
const nameOf = (id: TerminalId): string => MANIFESTS.find((m) => m.id === id)?.name ?? id;

async function terminalsStatus(): Promise<TerminalsStatus> {
  const cfg = loadConfig();
  const plugins = await terminalPlugins(await placeTools());
  const terminals = await Promise.all(
    plugins.map(async (p): Promise<TerminalRow> => {
      const found = await p.detect();
      return { id: p.manifest.id, name: p.manifest.name, found: found.found, running: found.running, helpers: p.manifest.helpers ? (helpersOn(p.manifest.id, cfg) ? "on" : "off") : null };
    }),
  );
  return { prefer: preferred(cfg), launch: launchesOn(cfg) ? "on" : "off", terminals };
}

function statusText(s: TerminalsStatus): string {
  const rows = s.terminals.map((t) => {
    const state = !t.found ? "not installed" : t.running ? "running" : "installed, not running";
    return `${t.name}: ${state}${t.helpers ? `, helpers ${t.helpers}` : ""}${t.id === s.prefer ? ", new agents open here" : ""}`;
  });
  return [...rows, launchesText(s.launch)].join("\n");
}

function launchesText(launch: "on" | "off"): string {
  return launch === "on"
    ? "Creating new agents is on for this computer: this app and your paired computers can start agents here (kiwi launches off stops it)"
    : "Creating new agents is off for this computer: every launch is refused, from this app or a paired computer (kiwi launches on allows it)";
}

export function setHelpers(id: HelperId, on: boolean) {
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
        if (!isHelperId(id)) return yield* die(USAGE);
        yield* setHelpers(id, sub === "download");
        return out(statusText(yield* Effect.promise(() => terminalsStatus())));
      }
      if (sub === "prefer") {
        if (!isTerminalId(id)) return yield* die(USAGE);
        if (id !== "app" && !helpersOn(id, loadConfig())) return yield* die(`Download the ${nameOf(id)} helpers first: kiwi terminal download ${id}`);
        updateConfig((c) => {
          c.terminals = { ...c.terminals, prefer: id };
        });
        return out(statusText(yield* Effect.promise(() => terminalsStatus())));
      }
      return yield* die(USAGE);
    }),

  launches: () =>
    Effect.gen(function* () {
      const sub = args[1] ?? "status";
      if (sub === "on" || sub === "off")
        updateConfig((c) => {
          c.launch = sub;
        });
      else if (sub !== "status") return yield* die(LAUNCHES_USAGE);
      const launch = launchesOn(loadConfig()) ? "on" : "off";
      return out(opt.json ? JSON.stringify({ launch }) : launchesText(launch));
    }),
};
