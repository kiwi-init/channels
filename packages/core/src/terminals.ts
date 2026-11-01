import { readLaunch } from "./membership.ts";

export const PLACE_NAMES = { rex: "Rex", tmux: "tmux", hosted: "Channels" } as const;

export type PlaceKind = keyof typeof PLACE_NAMES;

export const OWN_TMUX_DIR = "tmux";

const LAUNCH_REFUSALS = ["bad-request", "not-installed", "no-recipe", "no-place", "not-allowed", "failed"] as const;

export type LaunchRefusal = (typeof LAUNCH_REFUSALS)[number];

export interface RexPlace {
  server: string;
  session: string;
  block: string;
}

export type Opened = { ok: true; place: "hosted"; socket: string; window: string; pane: string; pid?: number };

export type Launched = { ok: true; launch: string; placed: Opened } | { ok: false; why: LaunchRefusal; detail: string };

export type LaunchedView = { ok: true; launch: string; place: "hosted"; window: string } | Extract<Launched, { ok: false }>;

export interface RexStatus {
  found: boolean;
  version?: string;
  server: "running" | "stopped";
  helpers: "on" | "off";
  rotation: "on" | "off";
}

export interface RexSeat extends RexPlace {
  alias: string;
  agent: string;
  room?: string;
}

export interface TmuxSeat {
  alias: string;
  agent: string;
  room?: string;
  socket: string;
  pane: string;
  attach?: string;
}

export type PlacedSeat = ({ place: "rex" } & RexSeat) | ({ place: "tmux" | "hosted" } & TmuxSeat);

const SHOW_REFUSALS = ["no-rex", "no-server", "no-app", "remote-control", "failed"] as const;

export type ShowRefusal = (typeof SHOW_REFUSALS)[number];

export type ShowResult = { ok: true } | { ok: false; why: ShowRefusal };

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

const positive = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined);

const isLaunchRefusal = (v: unknown): v is LaunchRefusal => typeof v === "string" && (LAUNCH_REFUSALS as readonly string[]).includes(v);

const isShowRefusal = (v: unknown): v is ShowRefusal => typeof v === "string" && (SHOW_REFUSALS as readonly string[]).includes(v);

function readRexPlace(x: unknown): RexPlace | null {
  const r = record(x);
  const server = text(r?.server, 512);
  const session = text(r?.session, 128);
  const block = text(r?.block, 128);
  return server && session && block ? { server, session, block } : null;
}

export function readOpened(x: unknown): Opened | null {
  const p = record(x);
  if (p?.ok !== true || p.place !== "hosted") return null;
  const socket = text(p.socket, 4096);
  const window = text(p.window, 32);
  const pane = text(p.pane, 32);
  const pid = positive(p.pid);
  return socket && window && pane ? { ok: true, place: "hosted", socket, window, pane, ...(pid ? { pid } : {}) } : null;
}

export function readLaunched(x: unknown): Launched | null {
  const r = record(x);
  if (r?.ok === false) return { ok: false, why: isLaunchRefusal(r.why) ? r.why : "failed", detail: typeof r.detail === "string" ? r.detail : "" };
  const launch = readLaunch(r?.launch);
  const placed = r?.ok === true ? readOpened(r.placed) : null;
  return launch && placed ? { ok: true, launch, placed } : null;
}

export const REX_UNKNOWN: RexStatus = { found: false, server: "stopped", helpers: "off", rotation: "off" };

const VERSION = /^[\x21-\x7e]{1,64}$/;

export function readRexStatus(x: unknown): RexStatus {
  const s = record(x);
  if (!s) return REX_UNKNOWN;
  const version = typeof s.version === "string" && VERSION.test(s.version) ? s.version : null;
  return {
    found: s.found === true,
    ...(version ? { version } : {}),
    server: s.server === "running" ? "running" : "stopped",
    helpers: s.helpers === "on" ? "on" : "off",
    rotation: s.rotation === "on" ? "on" : "off",
  };
}

export function readRexSeat(x: unknown): RexSeat | null {
  const s = record(x);
  const alias = text(s?.alias, 200);
  const agent = text(s?.agent, 64);
  const place = readRexPlace(s);
  if (!alias || !agent || !place) return null;
  const room = text(s?.room, 128);
  return { alias, agent, ...(room ? { room } : {}), ...place };
}

const PANE = /^%\d{1,10}$/;
const CONTROL = /[\x00-\x1f\x7f]/;

function readTmuxSeat(x: unknown): TmuxSeat | null {
  const s = record(x);
  const alias = text(s?.alias, 200);
  const agent = text(s?.agent, 64);
  const socket = text(s?.socket, 4096);
  const pane = typeof s?.pane === "string" && PANE.test(s.pane) ? s.pane : undefined;
  if (!alias || !agent || !socket?.startsWith("/") || CONTROL.test(socket) || !pane) return null;
  const room = text(s?.room, 128);
  const attach = text(s?.attach, 8192);
  return { alias, agent, ...(room ? { room } : {}), socket, pane, ...(attach && !CONTROL.test(attach) ? { attach } : {}) };
}

export function readPlacedSeat(x: unknown): PlacedSeat | null {
  const place = record(x)?.place;
  if (place === "rex") {
    const seat = readRexSeat(x);
    return seat ? { place, ...seat } : null;
  }
  if (place === "tmux" || place === "hosted") {
    const seat = readTmuxSeat(x);
    return seat ? { place, ...seat } : null;
  }
  return null;
}

export function readShowResult(x: unknown): ShowResult {
  const r = record(x);
  if (r?.ok === true) return { ok: true };
  return { ok: false, why: isShowRefusal(r?.why) ? r.why : "failed" };
}

const TERMINAL_IDS = ["rex", "tmux"] as const;

export type TerminalId = (typeof TERMINAL_IDS)[number];

export const isTerminalId = (v: unknown): v is TerminalId => typeof v === "string" && (TERMINAL_IDS as readonly string[]).includes(v);

export interface TerminalRow {
  id: TerminalId;
  name: string;
  found: boolean;
  running: boolean;
  helpers: "on" | "off" | null;
}

export interface TerminalsStatus {
  launch: "on" | "off";
  bypass: "on" | "off";
  terminals: TerminalRow[];
}

function readTerminalRow(x: unknown): TerminalRow | null {
  const r = record(x);
  const name = text(r?.name, 64);
  if (!r || !isTerminalId(r.id) || !name) return null;
  return { id: r.id, name, found: r.found === true, running: r.running === true, helpers: r.helpers === "on" || r.helpers === "off" ? r.helpers : null };
}

export function readTerminalsStatus(x: unknown): TerminalsStatus | null {
  const s = record(x);
  if (!s || (s.launch !== "on" && s.launch !== "off") || !Array.isArray(s.terminals)) return null;
  const terminals = s.terminals.map(readTerminalRow).filter((t): t is TerminalRow => t !== null);
  return { launch: s.launch, bypass: s.bypass === "on" ? "on" : "off", terminals };
}
