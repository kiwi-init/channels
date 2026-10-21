import type { Config, HelperId } from "../config.ts";
import { loginPath, loginShell } from "../launch/shell.ts";
import { appManifest } from "./app/manifest.ts";
import type { PlaceTools, SeatPlace, TerminalId, TerminalManifest, TerminalPlugin } from "./plugin.ts";
import { placeFrom, rexBinary } from "./rex/locate.ts";
import { rexManifest } from "./rex/manifest.ts";
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
  return placeFrom(env);
}

export function helpersOn(id: TerminalId, cfg: Pick<Config, "terminals">): boolean {
  return id !== "app" && cfg.terminals?.helpers?.[id] === "on";
}

export function preferred(cfg: Pick<Config, "terminals">): TerminalId {
  const prefer = cfg.terminals?.prefer;
  return prefer && helpersOn(prefer, cfg) ? prefer : "app";
}

export function switchHelpers(terminals: NonNullable<Config["terminals"]>, id: HelperId, on: boolean): NonNullable<Config["terminals"]> {
  const { prefer, ...rest } = terminals;
  return { ...rest, ...(prefer && (on || prefer !== id) ? { prefer } : {}), helpers: { ...terminals.helpers, [id]: on ? "on" : "off" } };
}

export function launchesOn(cfg: Pick<Config, "launch">): boolean {
  return cfg.launch !== "off";
}
