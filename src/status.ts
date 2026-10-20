import { spawnSync } from "node:child_process";
import { closeSync, openSync, statSync, writeSync } from "node:fs";
import { needsPerson } from "@kiwi/core/work.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import { loadConfig, type SeatRecord } from "./config.ts";
import { activityEnv, seatRecordFor } from "./daemon/reach.ts";
import { harnessActivity } from "./harness.ts";
import { askId, clearFrame, reviewId, rexForeground, rexRootState, statusFrame, takesStatus, type StatusRecord } from "./rex.ts";

const STATUS_EVERY_MS = 3_000;
const RATE_MS = 1_000;
const MAX_BYTES = 4_096;

export function seatRecords(state: ChannelState, alias: string, agent: string): StatusRecord[] {
  const asks = needsPerson(state).filter((n) => n.from === agent).length;
  const records: StatusRecord[] = asks ? [{ id: askId(alias), state: "blocked", kind: "question", msg: `${asks} question${asks === 1 ? "" : "s"} for a person in ${alias}` }] : [];
  const review = [...state.tasks.values()].filter((t) => t.owner === agent && t.state === "review" && !t.archived).sort((a, b) => a.id - b.id);
  for (const task of review) records.push({ id: reviewId(alias, task.id), state: "done", msg: `T${task.id} waits for review` });
  return records;
}

interface Device {
  tty: string;
  path: string;
}

function uid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function leadsTerminal(pid: number): Device | null {
  if (process.platform === "win32" || !Number.isSafeInteger(pid) || pid <= 0) return null;
  const r = spawnSync("ps", ["-o", "tty=,tpgid=,pgid=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 });
  const [tty, fg, group] = r.status === 0 ? r.stdout.trim().split(/\s+/) : [];
  if (!tty || tty === "?" || fg !== String(pid) || group !== String(pid)) return null;
  const path = `/dev/${tty}`;
  try {
    const stat = statSync(path);
    if (!stat.isCharacterDevice()) return null;
    const owner = uid();
    if (owner !== null && stat.uid !== owner) return null;
  } catch {
    return null;
  }
  return { tty, path };
}

function writeStatus(device: string, frames: string): boolean {
  if (!frames || Buffer.byteLength(frames) > MAX_BYTES) return false;
  let fd: number | null = null;
  try {
    fd = openSync(device, "w");
    writeSync(fd, frames);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Closing a device that just went away changes nothing: the write already failed or landed.
      }
    }
  }
}

interface ReadyOptions {
  idle?: boolean;
  rexCheck?: boolean;
}

async function readyDevice(record: SeatRecord, opts: ReadyOptions = {}): Promise<string | null> {
  if (!takesStatus(record.term) || !record.pid) return null;
  const device = leadsTerminal(record.pid);
  if (!device) return null;
  if (record.rex) {
    if (opts.rexCheck !== false && rexForeground(record.rex) !== record.pid) return null;
    if (opts.idle !== false) {
      const state = rexRootState(record.rex);
      if (state !== "done" && state !== "idle") return null;
    }
  } else if (opts.idle !== false) {
    const env = activityEnv(record, process.env);
    const activity = env ? await harnessActivity(env) : undefined;
    if (activity?.state !== "idle") return null;
  }
  return device.path;
}

function uniqueRecords(): SeatRecord[] {
  const seen = new Set<string>();
  const out: SeatRecord[] = [];
  for (const records of Object.values(loadConfig().bindings ?? {})) {
    for (const record of Array.isArray(records) ? records : [records]) {
      const key = `${record.alias}\u0000${record.as}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(record);
    }
  }
  return out;
}

export async function clearStatus(): Promise<number> {
  let cleared = 0;
  for (const record of uniqueRecords()) {
    if (!takesStatus(record.term)) continue;
    const device = await readyDevice(record, { idle: false, rexCheck: false });
    if (device && writeStatus(device, clearFrame("kiwi"))) cleared++;
  }
  return cleared;
}

interface StatusSeat {
  key: string;
  alias: string;
  agent: string;
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
  at: number;
  retryAt: number;
  session: Session | null;
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

export function startStatusWatch(opts: StatusWatchOptions): { stop(): void } {
  const everyMs = opts.everyMs ?? STATUS_EVERY_MS;
  const watched = new Map<string, Watched>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const round = async (): Promise<void> => {
    if (stopped) return;
    try {
      const cfg = loadConfig();
      if (cfg.rex !== "on") {
        watched.clear();
        return;
      }
      const live = new Set<string>();
      for (const seat of opts.seats()) {
        if (stopped || !opts.current(seat)) continue;
        live.add(seat.key);
        let seen = watched.get(seat.key);
        if (!seen) {
          seen = { written: new Map(), at: 0, retryAt: 0, session: null };
          watched.set(seat.key, seen);
        }
        const record = seatRecordFor(cfg, seat.alias, seat.agent);
        if (!record || !record.term || !takesStatus(record.term)) {
          seen.written.clear();
          continue;
        }
        if (!seen.session && Date.now() < seen.retryAt) continue;
        seen.session ??= await openSession(seat.alias, seat.agent);
        if (!seen.session) {
          seen.retryAt = Date.now() + 60_000;
          continue;
        }
        const state = await channelState(seen.session);
        if (!state) continue;
        const desired = new Map(seatRecords(state, seat.alias, seat.agent).map((r): [string, string] => [r.id, statusFrame(r)]));
        const frames: string[] = [];
        for (const [id, frame] of desired) if (seen.written.get(id) !== frame) frames.push(frame);
        for (const id of seen.written.keys()) if (!desired.has(id)) frames.push(clearFrame(id));
        if (!frames.length || Date.now() - seen.at < RATE_MS) continue;
        const device = await readyDevice(record);
        if (!device || !writeStatus(device, frames.join(""))) continue;
        seen.written = desired;
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
