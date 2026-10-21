import { readLaunch } from "./membership.ts";

export const PLACE_NAMES = { rex: "Rex", tmux: "tmux", terminal: "Terminal" } as const;

export type PlaceKind = keyof typeof PLACE_NAMES;

const LAUNCH_REFUSALS = ["bad-request", "not-installed", "no-recipe", "no-place", "not-allowed", "failed"] as const;

export type LaunchRefusal = (typeof LAUNCH_REFUSALS)[number];

export interface RexPlace {
  server: string;
  session: string;
  block: string;
}

export type Opened =
  | { ok: true; place: "rex"; rex: RexPlace; window: string; pid?: number }
  | { ok: true; place: "tmux"; socket: string; session: string; window: string; pane: string; pid?: number }
  | { ok: true; place: "terminal"; window?: number };

export type Launched = { ok: true; launch: string; placed: Opened } | { ok: false; why: LaunchRefusal; detail: string };

export type LaunchedView =
  | { ok: true; launch: string; place: "rex"; rex: RexPlace }
  | { ok: true; launch: string; place: "tmux"; session: string; window: string }
  | { ok: true; launch: string; place: "terminal" }
  | Extract<Launched, { ok: false }>;

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

export type PlacedSeat = { place: "rex" } & RexSeat;

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

function readOpened(x: unknown): Opened | null {
  const p = record(x);
  if (p?.ok !== true) return null;
  const pid = positive(p.pid);
  if (p.place === "terminal") {
    const window = positive(p.window);
    return { ok: true, place: "terminal", ...(window ? { window } : {}) };
  }
  if (p.place === "tmux") {
    const socket = text(p.socket, 4096);
    const session = text(p.session, 128);
    const window = text(p.window, 32);
    const pane = text(p.pane, 32);
    return socket && session && window && pane ? { ok: true, place: "tmux", socket, session, window, pane, ...(pid ? { pid } : {}) } : null;
  }
  if (p.place === "rex") {
    const rex = readRexPlace(p.rex);
    const window = text(p.window, 128);
    return rex && window ? { ok: true, place: "rex", rex, window, ...(pid ? { pid } : {}) } : null;
  }
  return null;
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

export function readPlacedSeat(x: unknown): PlacedSeat | null {
  const seat = record(x)?.place === "rex" ? readRexSeat(x) : null;
  return seat ? { place: "rex", ...seat } : null;
}

export function readShowResult(x: unknown): ShowResult {
  const r = record(x);
  if (r?.ok === true) return { ok: true };
  return { ok: false, why: isShowRefusal(r?.why) ? r.why : "failed" };
}
