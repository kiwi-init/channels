import type { PlacedSeat, ShowResult } from "@kiwi/core/terminals.ts";
import { loadConfig, type Config, type SeatRecord } from "../config.ts";
import { loginShell } from "../launch/shell.ts";
import { attachArgv, attachLine, hostedTmuxBin, showHosted, type TerminalOpener } from "./hosted.ts";
import type { PlaceTools, SeatPlace, TerminalId, TerminalManifest, TerminalPlugin } from "./plugin.ts";
import { placeFrom, rexBinary } from "./rex/locate.ts";
import { rexManifest } from "./rex/manifest.ts";
import { takesStatus } from "./shared/osc7501.ts";
import { onHostedSocket } from "./shared/tmux.ts";
import { tmuxPlaceFrom } from "./tmux/locate.ts";
import { tmuxManifest } from "./tmux/manifest.ts";
import { hostedSeats } from "./tmux/seats.ts";

export const MANIFESTS: readonly TerminalManifest[] = [rexManifest, tmuxManifest];

const LOAD: Record<TerminalId, () => Promise<(t: PlaceTools) => TerminalPlugin>> = {
  rex: async () => (await import("./rex/index.ts")).rexTerminal,
  tmux: async () => (await import("./tmux/index.ts")).tmuxTerminal,
};

export async function terminalPlugins(tools: PlaceTools): Promise<TerminalPlugin[]> {
  return Promise.all(MANIFESTS.filter((m) => m.platforms.includes(tools.platform)).map(async (m) => (await LOAD[m.id]())(tools)));
}

export function placeTools(): PlaceTools {
  return { platform: process.platform, shell: loginShell(), rex: rexBinary() };
}

export async function terminalPlugin(id: TerminalId, tools: PlaceTools = placeTools()): Promise<TerminalPlugin> {
  return (await LOAD[id]())(tools);
}

export function locate(env: Record<string, string | undefined>): SeatPlace {
  return { ...placeFrom(env), ...tmuxPlaceFrom(env) };
}

export function helpersOn(id: TerminalId, cfg: Pick<Config, "terminals">): boolean {
  return cfg.terminals?.helpers?.[id] === "on";
}

export function switchHelpers(terminals: NonNullable<Config["terminals"]>, id: TerminalId, on: boolean): NonNullable<Config["terminals"]> {
  return { ...terminals, helpers: { ...terminals.helpers, [id]: on ? "on" : "off" } };
}

export function launchesOn(cfg: Pick<Config, "launch">): boolean {
  return cfg.launch !== "off";
}

export function remoteBypassOn(cfg: Pick<Config, "remoteBypass">): boolean {
  return cfg.remoteBypass === "on";
}

interface Plugins {
  manifests: readonly TerminalManifest[];
  load(id: TerminalId): Promise<TerminalPlugin>;
}

const BUILT_IN: Plugins = { manifests: MANIFESTS, load: (id) => terminalPlugin(id) };

function placeOf(seat: PlacedSeat): SeatPlace {
  return seat.place !== "rex" ? { tmux: { socket: seat.socket, pane: seat.pane } } : { rex: { server: seat.server, session: seat.session, block: seat.block } };
}

const samePlace = (a: PlacedSeat, b: PlacedSeat): boolean => JSON.stringify(placeOf(a)) === JSON.stringify(placeOf(b));

function showing(from: Plugins, on: (id: TerminalId) => boolean): Promise<TerminalPlugin[]> {
  const ids = from.manifests.filter((m) => m.platforms.includes(process.platform) && m.can.includes("show") && on(m.id)).map((m) => m.id);
  return Promise.all(ids.map((id) => from.load(id)));
}

export async function seatPlaces(cfg: Config = loadConfig(), from: Plugins = BUILT_IN, tmux?: string): Promise<PlacedSeat[]> {
  const listed = hostedSeats(cfg);
  const bin = listed.length ? (tmux ?? (await hostedTmuxBin())) : "tmux";
  const hosted = listed.map((seat): PlacedSeat => ({ place: "hosted", ...seat, attach: attachLine(attachArgv(bin, seat)) }));
  return [...hosted, ...(await showing(from, (id) => helpersOn(id, cfg))).flatMap((plugin) => plugin.seats?.(cfg) ?? [])];
}

export interface HostedShow {
  tmux: string;
  opener: TerminalOpener;
}

export async function showSeat(seat: PlacedSeat, cfg: Config = loadConfig(), from: Plugins = BUILT_IN, hosted?: HostedShow): Promise<ShowResult> {
  if (seat.place === "hosted") {
    const mine = hostedSeats(cfg).find((s) => s.socket === seat.socket && s.pane === seat.pane);
    if (!mine) return { ok: false, why: "failed" };
    return showHosted(mine, hosted?.tmux ?? (await hostedTmuxBin()), hosted?.opener);
  }
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
  if (record.tmux) return !onHostedSocket(record.tmux.socket) && on.includes("tmux") ? "tmux" : null;
  return takesStatus(record.term) && on.includes("rex") ? "rex" : null;
}

export function showsIn(record: SeatPlace, cfg: Pick<Config, "terminals">): TerminalId | null {
  if (record.tmux) return !onHostedSocket(record.tmux.socket) && helpersOn("tmux", cfg) ? "tmux" : null;
  return record.rex && helpersOn("rex", cfg) ? "rex" : null;
}
