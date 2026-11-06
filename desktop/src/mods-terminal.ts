import { createHash } from "node:crypto";

export type Run = (argv: readonly string[]) => Promise<{ status: number | null; stdout: string; stderr: string }>;

interface TmuxPlace {
  socket: string;
  pane: string;
}

interface RexPlace {
  server: string;
  session: string;
  block: string;
}

export interface TerminalSeat {
  id: string;
  room: string;
  channel: string;
  agent: string;
  in: "tmux" | "rex";
}

export interface PlacedSeat extends TerminalSeat {
  tmux?: TmuxPlace;
  rex?: RexPlace;
  pid: number | null;
}

export interface TerminalMark {
  asks: number;
  tasks: number[];
}

export interface TerminalDeps {
  seats(): Promise<PlacedSeat[]>;
  run: Run;
  tmux(): string | null;
  rex(): string | null;
  write(device: string, text: string): boolean;
  front(): Promise<void>;
}

const ROOM = /^[0-9a-f]{32}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SOCKET = /^\/[\x20-\x7e]{1,1023}$/;
const PANE = /^%\d{1,10}$/;
const SERVER = /^[\x21-\x7e]{1,512}$/;
const SESSION = /^session:[0-9a-f-]{36}$/;
const BLOCK = /^block:[0-9a-f-]{36}$/;
const WINDOW = /^@\d{1,10}$/;
const SEAT_ID = /^[0-9a-f]{16}$/;
const TTY = /^ttys?\d{1,4}$|^pts\/\d{1,5}$/;
const TASKS_SHOWN = 3;
const MAX_ASKS = 999;
const MAX_TASKS = 20;
const NO_SERVER = /no server running|error connecting to/;

export const seatId = (room: string, agent: string): string => createHash("sha256").update(`${room}\u0000${agent}`).digest("hex").slice(0, 16);

const text = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);

function placeOf(v: unknown): { tmux: TmuxPlace } | { rex: RexPlace } | null {
  if (!v || typeof v !== "object") return null;
  const { tmux, rex } = v as { tmux?: Record<string, unknown>; rex?: Record<string, unknown> };
  if (tmux && text(tmux["socket"], SOCKET) && text(tmux["pane"], PANE)) return { tmux: { socket: tmux["socket"], pane: tmux["pane"] } };
  if (rex && text(rex["server"], SERVER) && text(rex["session"], SESSION) && text(rex["block"], BLOCK)) return { rex: { server: rex["server"], session: rex["session"], block: rex["block"] } };
  return null;
}

export function placedSeatsOf(stdout: string): PlacedSeat[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Not JSON: an older CLI's words, or nothing. No seat says where it sits.
    return [];
  }
  const rows = parsed && typeof parsed === "object" ? (parsed as { seats?: unknown }).seats : undefined;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r: unknown): PlacedSeat[] => {
    if (!r || typeof r !== "object") return [];
    const { room, alias, agent, place, pid } = r as Record<string, unknown>;
    const at = placeOf(place);
    if (!text(room, ROOM) || !text(alias, NAME) || !text(agent, NAME) || !at) return [];
    const proc = typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
    return [{ id: seatId(room, agent), room, channel: alias, agent, in: "tmux" in at ? "tmux" : "rex", ...at, pid: proc }];
  });
}

function readMark(v: unknown): TerminalMark | null {
  if (v === null) return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("a mark is { asks, tasks }, or null to clear it");
  const { asks = 0, tasks = [], ...rest } = v as Record<string, unknown>;
  if (Object.keys(rest).length) throw new Error(`a mark holds only asks and tasks, not ${Object.keys(rest).join(", ")}`);
  if (typeof asks !== "number" || !Number.isSafeInteger(asks) || asks < 0 || asks > MAX_ASKS) throw new Error("a mark's asks is a whole number from 0 to 999");
  if (!Array.isArray(tasks) || tasks.length > MAX_TASKS || !tasks.every((t) => typeof t === "number" && Number.isSafeInteger(t) && t > 0))
    throw new Error("a mark's tasks is a list of up to 20 task numbers");
  const list = [...new Set(tasks as number[])].sort((a, b) => a - b);
  return asks || list.length ? { asks, tasks: list } : null;
}

export function markText(marks: Iterable<TerminalMark>): string {
  let asks = 0;
  const tasks = new Set<number>();
  for (const m of marks) {
    asks += m.asks;
    for (const t of m.tasks) tasks.add(t);
  }
  const shown = [...tasks].sort((a, b) => a - b);
  const more = shown.length - TASKS_SHOWN;
  return [...(asks ? [`${asks}?`] : []), ...shown.slice(0, TASKS_SHOWN).map((t) => `T${t}`), ...(more > 0 ? [`+${more}`] : [])].join(" ");
}

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

function words(m: TerminalMark): string {
  const asks = m.asks ? [m.asks === 1 ? "1 question for you" : `${m.asks} questions for you`] : [];
  const tasks = m.tasks.length
    ? [
        `${m.tasks
          .slice(0, TASKS_SHOWN)
          .map((t) => `T${t}`)
          .join(" ")}${m.tasks.length > TASKS_SHOWN ? ` +${m.tasks.length - TASKS_SHOWN}` : ""} for review`,
      ]
    : [];
  return [...asks, ...tasks].join(" · ");
}

export function statusFrame(id: string, m: TerminalMark | null): string {
  const record = `kiwi/${id}`;
  if (!m) return `\x1b]7501;state=clear:app=kiwi:id=${record}\x1b\\`;
  const state = m.asks ? "state=blocked:kind=question" : "state=done";
  return `\x1b]7501;${state}:app=kiwi:id=${record}:title=${b64("Kiwi")}:msg=${b64(words(m))}\x1b\\`;
}

function foreground(stdout: string): unknown {
  try {
    return (JSON.parse(stdout) as { foreground?: { pid?: unknown } }).foreground?.pid;
  } catch {
    // Rex didn't answer in JSON: treat the block as not holding the agent.
    return null;
  }
}

export function terminalCalls(d: TerminalDeps) {
  const windows = new Map<string, Map<string, TerminalMark>>();
  const seatAt = new Map<string, string>();

  async function seat(id: unknown): Promise<PlacedSeat> {
    if (typeof id !== "string" || !SEAT_ID.test(id)) throw new Error("a terminal is named by the id terminals() gave");
    const found = (await d.seats()).find((s) => s.id === id);
    if (!found) throw new Error("no agent of this computer sits in that terminal now");
    return found;
  }

  const tmuxOf = (place: TmuxPlace): ((...args: string[]) => ReturnType<Run>) => {
    const bin = d.tmux();
    if (!bin) throw new Error("tmux isn't installed on this computer");
    return (...args) => d.run([bin, "-u", "-S", place.socket, ...args]);
  };

  async function windowOf(place: TmuxPlace): Promise<string> {
    const got = await tmuxOf(place)("display-message", "-p", "-t", place.pane, "#{window_id}");
    if (got.status !== 0 && NO_SERVER.test(got.stderr)) throw new Error("that agent's tmux server isn't running");
    const window = got.stdout.trim();
    if (got.status !== 0 || !WINDOW.test(window)) throw new Error("that agent's tmux pane is gone");
    return window;
  }

  const rexOf = (place: RexPlace): ((...args: string[]) => ReturnType<Run>) => {
    const bin = d.rex();
    if (!bin) throw new Error("Rex isn't installed on this computer");
    return (...args) => d.run([bin, "-S", place.server, "--autostart=false", ...args]);
  };

  const rexCall = (place: RexPlace, method: string, args: Record<string, unknown>) => rexOf(place)("api", "call", "-s", place.session, method, JSON.stringify(args));

  async function focusTmux(place: TmuxPlace): Promise<void> {
    const tmux = tmuxOf(place);
    const window = await windowOf(place);
    if ((await tmux("select-window", "-t", window)).status !== 0 || (await tmux("select-pane", "-t", place.pane)).status !== 0) throw new Error("tmux didn't bring that pane forward");
    const clients = await tmux("list-clients", "-F", "#{client_activity}\t#{client_name}");
    const latest = clients.stdout
      .split("\n")
      .map((line) => line.split("\t"))
      .flatMap(([at, name]) => (at && name && /^[\x21-\x7e]{1,256}$/.test(name) ? [{ at: Number(at) || 0, name }] : []))
      .sort((a, b) => b.at - a.at)[0];
    if (latest && (await tmux("switch-client", "-c", latest.name, "-t", place.pane)).status !== 0) throw new Error("tmux didn't switch to that pane");
  }

  async function focusRex(place: RexPlace): Promise<void> {
    if ((await rexCall(place, "session.focus_block", { block_id: place.block })).status !== 0) throw new Error("Rex didn't focus that agent's block: is Rex running?");
    await rexOf(place)("do", "session.select", `session_id=${place.session}`);
    await d.front();
  }

  async function paintTmux(place: TmuxPlace, window: string, held: Map<string, TerminalMark>): Promise<void> {
    const label = markText(held.values());
    const set = label ? ["set-option", "-w", "-t", window, "@kiwi", label] : ["set-option", "-wu", "-t", window, "@kiwi"];
    if ((await tmuxOf(place)(...set)).status !== 0) throw new Error("tmux didn't take the mark");
  }

  async function markTmux(s: PlacedSeat & { tmux: TmuxPlace }, m: TerminalMark | null): Promise<void> {
    const window = await windowOf(s.tmux);
    const at = `${s.tmux.socket}\u0000${window}`;
    const was = seatAt.get(s.id);
    if (was && was !== at) {
      const left = windows.get(was);
      left?.delete(s.id);
      if (left) await paintTmux(s.tmux, was.split("\u0000")[1]!, left).catch(() => undefined);
      if (!left?.size) windows.delete(was);
    }
    const held = windows.get(at) ?? new Map<string, TerminalMark>();
    if (m) held.set(s.id, m);
    else held.delete(s.id);
    if (held.size) {
      windows.set(at, held);
      seatAt.set(s.id, at);
    } else {
      windows.delete(at);
      seatAt.delete(s.id);
    }
    await paintTmux(s.tmux, window, held);
  }

  async function markRex(s: PlacedSeat & { rex: RexPlace }, m: TerminalMark | null): Promise<void> {
    if (!s.pid) throw new Error("that agent's process isn't known, so its Rex block can't be marked");
    const got = await rexCall(s.rex, "com.superlogical.terminal.process", { block_id: s.rex.block, args: {} });
    if (got.status !== 0 || foreground(got.stdout) !== s.pid) throw new Error("that agent isn't the program in its Rex block now");
    const tty = (await d.run(["ps", "-o", "tty=", "-p", String(s.pid)])).stdout.trim();
    if (!TTY.test(tty) || !d.write(`/dev/${tty}`, statusFrame(s.id, m))) throw new Error("Rex didn't take the mark");
  }

  return {
    async list(): Promise<TerminalSeat[]> {
      return (await d.seats()).map(({ id, room, channel, agent, in: kind }) => ({ id, room, channel, agent, in: kind }));
    },
    async focus(id: unknown): Promise<void> {
      const s = await seat(id);
      if (s.tmux) return focusTmux(s.tmux);
      if (s.rex) return focusRex(s.rex);
    },
    async mark(id: unknown, mark: unknown): Promise<void> {
      const s = await seat(id);
      const m = readMark(mark);
      if (s.tmux) return markTmux({ ...s, tmux: s.tmux }, m);
      if (s.rex) return markRex({ ...s, rex: s.rex }, m);
    },
  };
}
