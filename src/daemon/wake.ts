import type { Subprocess } from "bun";
import { appendFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config, type WakeHook } from "../config.ts";
import { seatHeldAway } from "../hold.ts";
import { listenHooksInstalled } from "../hooks/install/claude.ts";
import { mimoInstalled } from "../hooks/install/mimo.ts";
import { piInstalled } from "../hooks/install/pi.ts";
import { kimiServer, promptKimi } from "../kimi-server.ts";
import { wakeArgv, wakeKey, wakePath, wakePrompt, type WakePath, type WakeVia } from "@kiwi/core/wake.ts";
import { withDeadline, type DaemonWake } from "./protocol.ts";
import { seatRecordFor, wakeOn } from "./reach.ts";
import type { HostedTmux } from "./hosted-tmux.ts";
import type { Seat } from "./seat.ts";
import { typeWake } from "./wake-typing.ts";
import { onHostedSocket } from "../terminals/shared/tmux.ts";

const WAKE_LOG_KEEP_BYTES = 1_000_000;

export function appendRotated(file: string, line: string, keepBytes = WAKE_LOG_KEEP_BYTES): void {
  if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > keepBytes) renameSync(file, `${file}.1`);
  appendFileSync(file, line, { mode: 0o600 });
}

export interface WakeRow {
  at: number;
  alias: string;
  agent: string;
  via: WakeVia;
  unread: number;
  result: "ok" | "failed" | "handed";
  why: string | null;
  cursor: number;
}

export function appendWakeRow(dir: string, w: WakeRow): void {
  try {
    appendRotated(join(dir, "wake.log"), `${new Date(w.at).toISOString()}\t${w.alias}\t${w.agent}\t${w.via}\t${w.unread}\t${w.result}\t${w.why ?? ""}\t${w.cursor}\n`);
  } catch {
    return;
  }
}

const WAKE_RUN_MS = 60_000;

type Session = import("../agent.ts").AgentSession;

function findExecutable(cmd: string): string | null {
  const user = process.env.HOME || homedir();
  const dirs = [process.env.PATH ?? "", join(user, ".local", "bin"), join(user, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":");
  return Bun.which(cmd, { PATH: dirs });
}

export async function runBounded(argv: string[], ms: number, started: (child: Subprocess) => void = () => {}): Promise<{ code: number; err: string } | null> {
  const child = Bun.spawn(argv, { env: { ...process.env }, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  started(child);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, ms);
  });
  const done = Promise.all([child.exited, new Response(child.stderr).text()]).then(([code, err]) => ({ code, err }));
  try {
    return await Promise.race([done, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}
const UNREAD_CHECK_MS = 30_000;
const TYPE_RETRY_MS = 10_000;

export const pathOf = async (cfg: Config, alias: string, agent: string): Promise<WakePath> => {
  const record = seatRecordFor(cfg, alias, agent);
  const hosted = record?.tmux && onHostedSocket(record.tmux.socket) ? record.tmux.pane : undefined;
  const seen = record && {
    ...record,
    held: seatHeldAway(cfg, alias, agent, {}),
    ...(record.harness === "kimi" ? { served: !!kimiServer(record.pid) } : {}),
    ...(hosted ? { hosted } : {}),
  };
  return wakePath(seen, listenHooksInstalled(), !!cfg.wakeHooks?.[wakeKey(alias, agent)], {
    pi: piInstalled(),
    mimo: mimoInstalled(),
  });
};

async function postWake(hook: WakeHook, body: { channel: string; agent: string; unread: number; prompt: string }): Promise<string | null> {
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(hook.authorization ? { authorization: hook.authorization } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WAKE_RUN_MS),
    });
    return res.ok ? null : `webhook answered ${res.status}`;
  } catch (err) {
    return `webhook unreachable: ${oneLine(err instanceof Error ? err.message : String(err))}`;
  }
}

interface WakeContext {
  dir: string;
  wakeDelayMs: number;
  wakeGapMs: number;
  wakeOutstandingMs: number;
  stopped: () => boolean;
  current: (seat: Seat) => boolean;
  hosted: HostedTmux;
}

export function seatWakes({ dir, wakeDelayMs, wakeGapMs, wakeOutstandingMs, stopped, current, hosted }: WakeContext): { scheduleWake: (seat: Seat, delay?: number) => void } {
  const sessions = new Map<string, { fp: string; session: Session }>();
  const nothingAt = new Map<string, number>();

  const unreadFor = async (seat: Seat): Promise<{ unread: number; cursor: number; seqs: number[] } | { unread: 0 }> => {
    const c = loadConfig().channels[seat.alias];
    if (!c) return { unread: 0 };
    const { AgentSession, runAgent } = await import("../agent.ts");
    const fp = JSON.stringify(c);
    let kept = sessions.get(seat.key);
    if (!kept || kept.fp !== fp) {
      kept = { fp, session: await AgentSession.open(seat.alias, c, seat.agent) };
      sessions.set(seat.key, kept);
    }
    const { messages, state } = await runAgent(kept.session.state());
    const looped = !!seatRecordFor(loadConfig(), seat.alias, seat.agent)?.loop;
    return runAgent(kept.session.unreadAt(state, messages, looped ? { loop: true } : {}));
  };

  const runWake = async (seat: Seat, [cmd, ...rest]: string[]): Promise<string | null> => {
    const exe = cmd ? findExecutable(cmd) : null;
    if (!exe) return `${cmd ?? "command"} not found on PATH`;
    let mine: Subprocess | null = null;
    try {
      const ran = await runBounded([exe, ...rest], WAKE_RUN_MS, (child) => {
        mine = child;
        seat.wakeChild = child;
      });
      if (ran === null) return `no answer in ${WAKE_RUN_MS / 1000} s`;
      return ran.code === 0 ? null : `exit ${ran.code}${oneLine(ran.err) ? `: ${oneLine(ran.err)}` : ""}`;
    } catch (err) {
      return `could not start: ${oneLine(err instanceof Error ? err.message : String(err))}`;
    } finally {
      if (mine && seat.wakeChild === mine) seat.wakeChild = null;
    }
  };

  const wakeKimi = async (seat: Seat, session: string, prompt: string): Promise<string | null> => {
    const server = kimiServer(seatRecordFor(loadConfig(), seat.alias, seat.agent)?.pid);
    return server ? promptKimi(server, session, prompt, WAKE_RUN_MS) : "Kimi's server for this session is gone";
  };

  const logWake = (seat: Seat, w: DaemonWake, why: string | null, cursor: number): void =>
    appendWakeRow(dir, { at: w.at, alias: seat.alias, agent: seat.agent, via: w.via, unread: w.unread, result: w.ok ? "ok" : "failed", why, cursor });

  const scheduleWake = (seat: Seat, delay = wakeDelayMs): void => {
    if (seat.wakeTimer || stopped()) return;
    seat.wakeTimer = setTimeout(() => {
      seat.wakeTimer = null;
      void fireWake(seat).catch(() => {});
    }, delay);
  };

  const commandPath = async (seat: Seat): Promise<Extract<WakePath, { kind: "command" }> | null> => {
    const cfg = loadConfig();
    if (!wakeOn(cfg, seat.alias, seat.agent)) return null;
    const path = await pathOf(cfg, seat.alias, seat.agent);
    return path.kind === "command" ? path : null;
  };

  const fireWake = async (seat: Seat): Promise<void> => {
    if (!current(seat)) return;
    if (seat.waking) {
      seat.wakeAgain = true;
      return;
    }
    if (!(await commandPath(seat))) return;
    const since = Date.now() - (seat.lastWake?.at ?? 0);
    if (since < wakeGapMs) return scheduleWake(seat, wakeGapMs - since);
    if (nothingAt.get(seat.key) === seat.head) return;
    seat.waking = true;
    try {
      const head = seat.head;
      const counted = await withDeadline(unreadFor(seat), UNREAD_CHECK_MS).catch(() => null);
      if (counted === null) {
        seat.wakeAgain = false;
        return scheduleWake(seat, wakeGapMs);
      }
      if (!("cursor" in counted) || !counted.unread) nothingAt.set(seat.key, head);
      else nothingAt.delete(seat.key);
      if (!("cursor" in counted) || !counted.unread || !current(seat)) return;
      const { unread, cursor, seqs } = counted;
      const path = await commandPath(seat);
      if (!path || !current(seat)) return;
      const hook = loadConfig().wakeHooks?.[wakeKey(seat.alias, seat.agent)];
      const to = path.via === "webhook" ? (hook?.url ?? "") : `${path.via} ${path.session}`;
      const pending = seat.outstanding;
      if (pending && pending.to === to && Date.now() - pending.at < wakeOutstandingMs && pending.seqs.every((seq) => seqs.includes(seq))) {
        seat.wakeAgain = false;
        return scheduleWake(seat, wakeGapMs);
      }
      seat.outstanding = null;
      const prompt = wakePrompt(seat.alias, seat.agent);
      let retry = false;
      const why =
        path.via === "webhook"
          ? hook
            ? await postWake(hook, { channel: seat.alias, agent: seat.agent, unread, prompt })
            : "no webhook set"
          : path.via === "kimi-server"
            ? await wakeKimi(seat, path.session, prompt)
            : path.via === "hosted-typing"
              ? await typeWake(hosted, path.session, prompt).then((t) => (t.ok ? null : ((retry = t.retry), t.why)))
              : await runWake(seat, wakeArgv(path.via, path.session, prompt));
      if (!current(seat)) return;
      if (retry) {
        seat.wakeAgain = false;
        return scheduleWake(seat, Math.min(wakeGapMs, TYPE_RETRY_MS));
      }
      seat.lastWake = { at: Date.now(), via: path.via, unread, ok: why === null };
      if (why === null) seat.outstanding = { seqs, to, at: seat.lastWake.at };
      logWake(seat, seat.lastWake, why, cursor);
    } finally {
      seat.waking = false;
      if (seat.wakeAgain && current(seat)) {
        seat.wakeAgain = false;
        scheduleWake(seat);
      }
    }
  };

  return { scheduleWake };
}
