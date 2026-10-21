import type { Config, SeatRecord } from "../config.ts";
import { loginPath, loginShell } from "../launch/shell.ts";
import { appManifest } from "./app/manifest.ts";
import type { PlaceTools, SeatPlace, TerminalId, TerminalManifest, TerminalPlugin } from "./plugin.ts";
import { placeFrom, rexBinary } from "./rex/locate.ts";
import { rexManifest } from "./rex/manifest.ts";
import { takesStatus } from "./shared/osc7501.ts";
import { tmuxHelpersStatus } from "./tmux/helpers.ts";
import { tmuxPlaceFrom } from "./tmux/locate.ts";
import { tmuxManifest } from "./tmux/manifest.ts";

export const MANIFESTS: readonly TerminalManifest[] = [rexManifest, tmuxManifest, appManifest];

const LOAD: Record<TerminalId, () => Promise<(t: PlaceTools) => TerminalPlugin>> = {
  rex: async () => (await import("./rex/index.ts")).rexTerminal,
  tmux: async () => (await import("./tmux/index.ts")).tmuxTerminal,
  app: async () => (await import("./app/index.ts")).appTerminal,
};

export async function placeTools(): Promise<PlaceTools> {
  return {
    platform: process.platform,
    shell: loginShell(),
    rex: rexBinary(),
    tmux: Bun.which("tmux", { PATH: await loginPath() }),
    osascript: process.platform === "darwin" ? (Bun.which("osascript") ?? "/usr/bin/osascript") : null,
  };
}

export async function terminalPlugins(tools: PlaceTools): Promise<TerminalPlugin[]> {
  return Promise.all(MANIFESTS.filter((m) => m.platforms.includes(tools.platform)).map(async (m) => (await LOAD[m.id]())(tools)));
}

function hereTools(): PlaceTools {
  return {
    platform: process.platform,
    shell: loginShell(),
    rex: rexBinary(),
    tmux: Bun.which("tmux"),
    osascript: process.platform === "darwin" ? (Bun.which("osascript") ?? "/usr/bin/osascript") : null,
  };
}

export async function terminalPlugin(id: TerminalId, tools: PlaceTools = hereTools()): Promise<TerminalPlugin> {
  return (await LOAD[id]())(tools);
}

export function locate(env: Record<string, string | undefined>): SeatPlace {
  return { ...placeFrom(env), ...tmuxPlaceFrom(env) };
}

export function helpersOn(id: TerminalId, cfg: Pick<Config, "rex">): boolean {
  if (id === "tmux") return tmuxHelpersStatus() === "on";
  return id === "rex" && cfg.rex === "on";
}

export function marking(cfg: Pick<Config, "rex">): TerminalId[] {
  return MANIFESTS.filter((m) => m.can.includes("mark") && helpersOn(m.id, cfg)).map((m) => m.id);
}

export function markerOf(record: SeatRecord, on: readonly TerminalId[]): TerminalId | null {
  if (record.tmux) return on.includes("tmux") ? "tmux" : null;
  return takesStatus(record.term) && on.includes("rex") ? "rex" : null;
}
