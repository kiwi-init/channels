import { needsPerson, type Need } from "@kiwi/core/work.ts";
import { openRound, type ChannelState, type Task } from "@kiwi/core/state.ts";
import { allSeats, loadConfig, type Config, type SeatRecord } from "./config.ts";
import { seatRecordFor } from "./daemon/reach.ts";
import type { ShowResult, StatusRecord, TerminalId, TerminalPlugin } from "./terminals/plugin.ts";
import { markerOf, marking, showsIn, terminalPlugin } from "./terminals/registry.ts";
import { askId, reviewId, statusFrame } from "./terminals/shared/osc7501.ts";

const STATUS_EVERY_MS = 3_000;
const RATE_MS = 1_000;
const REFOLD_MS = 60_000;

const asksFrom = (state: ChannelState, agent: string): Need[] => needsPerson(state).filter((n) => n.from === agent);

const inReview = (state: ChannelState, agent: string): Task[] => [...state.tasks.values()].filter((t) => t.owner === agent && t.state === "review" && !t.archived);

export function seatRecords(state: ChannelState, alias: string, agent: string): StatusRecord[] {
  const asks = asksFrom(state, agent).length;
  const records: StatusRecord[] = asks ? [{ id: askId(alias), state: "blocked", kind: "question", count: asks, msg: `${asks} question${asks === 1 ? "" : "s"} for a person in ${alias}` }] : [];
  const review = inReview(state, agent).sort((a, b) => a.id - b.id);
  for (const task of review) records.push({ id: reviewId(alias, task.id), state: "done", task: task.id, msg: `T${task.id} waits for review` });
  return records;
}

interface Waiting {
  alias: string;
  agent: string;
  question: boolean;
  at: number;
}

function seatWaiting(state: ChannelState, alias: string, agent: string): Waiting[] {
  return [
    ...asksFrom(state, agent).map((n): Waiting => ({ alias, agent, question: true, at: n.at })),
    ...inReview(state, agent).map((t): Waiting => ({ alias, agent, question: false, at: openRound(t)?.ts ?? t.updatedAt })),
  ];
}

function oldestFirst(all: readonly Waiting[]): Waiting[] {
  return [...all].sort((a, b) => Number(b.question) - Number(a.question) || a.at - b.at || a.alias.localeCompare(b.alias) || a.agent.localeCompare(b.agent));
}

export function foldStillFresh(kept: { head: number; at: number } | null, head: number | undefined, now = Date.now()): boolean {
  return !!kept && head !== undefined && kept.head === head && now - kept.at < REFOLD_MS;
}

interface StatusSeat {
  key: string;
  alias: string;
  agent: string;
  head?: number;
}

export interface StatusWatchOptions {
  seats: () => StatusSeat[];
  current: (seat: StatusSeat) => boolean;
  stopped: () => boolean;
  everyMs?: number;
}

type Session = import("./agent.ts").AgentSession;

interface Watched {
  written: Map<string, string>;
  where: string;
  at: number;
  retryAt: number;
  session: Session | null;
  folded: { head: number; at: number; state: ChannelState } | null;
}

async function openSession(alias: string, agent: string): Promise<Session | null> {
  const cfg = loadConfig().channels[alias];
  if (!cfg) return null;
  try {
    const { AgentSession } = await import("./agent.ts");
    return await AgentSession.open(alias, cfg, agent);
  } catch {
    return null;
  }
}

async function channelState(session: Session): Promise<ChannelState | null> {
  try {
    const { runAgent } = await import("./agent.ts");
    const { state } = await runAgent(session.state());
    return state;
  } catch {
    return null;
  }
}

async function seatState(alias: string, agent: string): Promise<ChannelState | null> {
  const session = await openSession(alias, agent);
  return session ? channelState(session) : null;
}

export type ShowWhy = Extract<ShowResult, { ok: false }>["why"];

export type NeedsYou = { shown: Waiting } | { shown: null; seats: number; failed: { waiting: Waiting; why: ShowWhy } | null };

async function showWith(by: TerminalId, record: SeatRecord): Promise<ShowResult> {
  return (await (await terminalPlugin(by)).show?.(record)) ?? { ok: false, why: "failed" };
}

export async function showNeedsYou(
  cfg: Config,
  read: (alias: string, agent: string) => Promise<ChannelState | null> = seatState,
  show: (by: TerminalId, record: SeatRecord) => Promise<ShowResult> = showWith,
): Promise<NeedsYou> {
  const seats = new Map<string, { record: SeatRecord; by: TerminalId }>();
  for (const { alias, as } of allSeats(cfg)) {
    const record = seatRecordFor(cfg, alias, as);
    const by = record ? showsIn(record, cfg) : null;
    if (record && by) seats.set(`${alias}\u0000${as}`, { record, by });
  }
  const aliases = [...new Set([...seats.values()].map((s) => s.record.alias))];
  const waiting: Waiting[] = [];
  for (const alias of aliases) {
    const agents = [...seats.values()].filter((s) => s.record.alias === alias).map((s) => s.record.as);
    const state = await read(alias, agents[0]!);
    if (state) waiting.push(...agents.flatMap((agent) => seatWaiting(state, alias, agent)));
  }
  let failed: { waiting: Waiting; why: ShowWhy } | null = null;
  for (const w of oldestFirst(waiting)) {
    const seat = seats.get(`${w.alias}\u0000${w.agent}`);
    if (!seat) continue;
    const shown = await show(seat.by, seat.record);
    if (shown.ok) return { shown: w };
    failed ??= { waiting: w, why: shown.why };
  }
  return { shown: null, seats: seats.size, failed };
}

export function startStatusWatch(opts: StatusWatchOptions): { stop(): void } {
  const everyMs = opts.everyMs ?? STATUS_EVERY_MS;
  const watched = new Map<string, Watched>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const plugins = new Map<TerminalId, Promise<TerminalPlugin>>();
  const plugin = (id: TerminalId): Promise<TerminalPlugin> => {
    const loaded = plugins.get(id) ?? terminalPlugin(id);
    plugins.set(id, loaded);
    return loaded;
  };

  const round = async (): Promise<void> => {
    if (stopped) return;
    try {
      const cfg = loadConfig();
      const on = marking(cfg);
      if (!on.length) {
        watched.clear();
        return;
      }
      const live = new Set<string>();
      for (const seat of opts.seats()) {
        if (stopped || !opts.current(seat)) continue;
        live.add(seat.key);
        let seen = watched.get(seat.key);
        if (!seen) {
          seen = { written: new Map(), where: "", at: 0, retryAt: 0, session: null, folded: null };
          watched.set(seat.key, seen);
        }
        const record = seatRecordFor(cfg, seat.alias, seat.agent);
        const by = record ? markerOf(record, on) : null;
        if (!record || !by) {
          seen.written.clear();
          continue;
        }
        const where = JSON.stringify([by, record.tmux ?? null, record.rex ?? null]);
        const moved = seen.where !== where;
        if (!seen.session && Date.now() < seen.retryAt) continue;
        seen.session ??= await openSession(seat.alias, seat.agent);
        if (!seen.session) {
          seen.retryAt = Date.now() + 60_000;
          continue;
        }
        const kept = seen.folded;
        const fresh = foldStillFresh(kept, seat.head);
        const state = fresh && kept ? kept.state : await channelState(seen.session);
        if (!state) continue;
        if (!fresh) seen.folded = seat.head === undefined ? null : { head: seat.head, at: Date.now(), state };
        const wanted = seatRecords(state, seat.alias, seat.agent);
        const desired = new Map(wanted.map((r): [string, string] => [r.id, statusFrame(r)]));
        const changed = wanted.filter((r) => moved || seen.written.get(r.id) !== desired.get(r.id));
        const cleared = [...seen.written.keys()].filter((id) => !desired.has(id));
        if ((!changed.length && !cleared.length) || Date.now() - seen.at < RATE_MS) continue;
        if (!(await (await plugin(by)).mark?.(record, changed, cleared, wanted))) continue;
        seen.written = desired;
        seen.where = where;
        seen.at = Date.now();
      }
      for (const key of watched.keys()) if (!live.has(key)) watched.delete(key);
    } catch {
      // A round that could not read the channel or a terminal says nothing about the next one.
    } finally {
      if (!stopped) timer = setTimeout(() => void round(), everyMs);
    }
  };

  timer = setTimeout(() => void round(), 0);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      watched.clear();
    },
  };
}
