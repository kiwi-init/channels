import type { PlacedSeat, ShowResult } from "@kiwi/core/terminals.ts";
import { loadConfig, type Config, type HelperId, type SeatRecord } from "../config.ts";
import { loginPath, loginShell } from "../launch/shell.ts";
import { appManifest } from "./app/manifest.ts";
import type { PlaceTools, SeatPlace, TerminalId, TerminalManifest, TerminalPlugin } from "./plugin.ts";
import { placeFrom, rexBinary } from "./rex/locate.ts";
import { rexManifest } from "./rex/manifest.ts";
import { takesStatus } from "./shared/osc7501.ts";
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

interface Plugins {
  manifests: readonly TerminalManifest[];
  load(id: TerminalId): Promise<TerminalPlugin>;
}

const BUILT_IN: Plugins = { manifests: MANIFESTS, load: (id) => terminalPlugin(id) };

function placeOf(seat: PlacedSeat): SeatPlace {
  return seat.place === "tmux" ? { tmux: { socket: seat.socket, pane: seat.pane } } : { rex: { server: seat.server, session: seat.session, block: seat.block } };
}

const samePlace = (a: PlacedSeat, b: PlacedSeat): boolean => JSON.stringify(placeOf(a)) === JSON.stringify(placeOf(b));

function showing(from: Plugins, on: (id: TerminalId) => boolean): Promise<TerminalPlugin[]> {
  const ids = from.manifests.filter((m) => m.platforms.includes(process.platform) && m.can.includes("show") && on(m.id)).map((m) => m.id);
  return Promise.all(ids.map((id) => from.load(id)));
}

export async function seatPlaces(cfg: Config = loadConfig(), from: Plugins = BUILT_IN): Promise<PlacedSeat[]> {
  return (await showing(from, (id) => helpersOn(id, cfg))).flatMap((plugin) => plugin.seats?.(cfg) ?? []);
}

export async function showSeat(seat: PlacedSeat, cfg: Config = loadConfig(), from: Plugins = BUILT_IN): Promise<ShowResult> {
  for (const plugin of await showing(from, () => true)) {
    const mine = plugin.seats?.(cfg).find((s) => samePlace(s, seat));
    if (mine && plugin.show) return plugin.show(placeOf(mine));
  }
  return { ok: false, why: "failed" };
}

export function marking(cfg: Pick<Config, "terminals">): TerminalId[] {
  return MANIFESTS.filter((m) => m.can.includes("mark") && helpersOn(m.id, cfg)).map((m) => m.id);
}

export function markerOf(record: SeatRecord, on: readonly TerminalId[]): TerminalId | null {
  if (record.tmux) return on.includes("tmux") ? "tmux" : null;
  return takesStatus(record.term) && on.includes("rex") ? "rex" : null;
}

export function showsIn(record: SeatPlace, cfg: Pick<Config, "terminals">): TerminalId | null {
  if (record.tmux) return helpersOn("tmux", cfg) ? "tmux" : null;
  return record.rex && helpersOn("rex", cfg) ? "rex" : null;
}
