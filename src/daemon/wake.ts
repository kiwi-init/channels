import type { Subprocess } from "bun";
import { appendFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type Config, type WakeHook } from "../config.ts";
import { pendingDocWakes } from "../config/doc-wakes.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import { commandOf, findOnPath, runnable } from "../harness-bin.ts";
import { seatHeldAway } from "../hold.ts";
import { pinSeatBin } from "../seats.ts";
import { listenHooksInstalled } from "../hooks/install/claude.ts";
import { mimoInstalled } from "../hooks/install/mimo.ts";
import { piInstalled } from "../hooks/install/pi.ts";
import { kimiServer, promptKimi } from "../kimi-server.ts";
import { wakeArgv, wakeKey, wakePath, wakePrompt, type WakePath, type WakeVia } from "@kiwi/core/wake.ts";
import { withDeadline, type DaemonWake } from "./protocol.ts";
import { seatRecordFor, wakeOn } from "./reach.ts";
import { tmuxPane } from "../tmux-pane.ts";
import { typeWake } from "./wake-pane.ts";
import type { Seat } from "./seat.ts";
import { codexControlSocket, codexHome, codexLastTurn, codexRollout, codexWindowRestart, startCodexQueue } from "./codex-queue.ts";

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
const CODEX_QUIET_MS = 10 * 60_000;
const UNTAKEN_WHY_MAX = 300;

const utc = (at: number): string => `${new Date(at).toISOString().slice(11, 16)} UTC`;
const TYPE_RETRY_MS = 10_000;

export const pathOf = async (cfg: Config, alias: string, agent: string): Promise<WakePath> => {
  const record = seatRecordFor(cfg, alias, agent);
  const seen = record && {
    ...record,
    held: seatHeldAway(cfg, alias, agent, {}),
    ...(record.harness === "kimi" ? { served: !!kimiServer(record.pid) } : {}),
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
  wakeTakeMs: number;
  stopped: () => boolean;
  current: (seat: Seat) => boolean;
}

export function seatWakes({ dir, wakeDelayMs, wakeGapMs, wakeOutstandingMs, wakeTakeMs, stopped, current }: WakeContext): {
  scheduleWake: (seat: Seat, delay?: number) => void;
  stateOf: (seat: Seat) => Promise<ChannelState | null>;
  viewOf: (seat: Seat) => Promise<{ state: ChannelState; messages: Message[] } | null>;
  sessionOf: (seat: Seat) => Promise<Session | null>;
  wakeable: (seat: Seat) => Promise<boolean>;
} {
  const sessions = new Map<string, { fp: string; session: Session }>();
  const nothingAt = new Map<string, number>();

  const sessionOf = async (seat: Seat): Promise<Session | null> => {
    const c = loadConfig().channels[seat.alias];
    if (!c) return null;
    const { AgentSession } = await import("../agent.ts");
    const fp = JSON.stringify(c);
    let kept = sessions.get(seat.key);
    if (!kept || kept.fp !== fp) {
      kept = { fp, session: await AgentSession.open(seat.alias, c, seat.agent) };
      sessions.set(seat.key, kept);
    }
    return kept.session;
  };

  const wakingDocs = (seat: Seat): number => pendingDocWakes(seat.alias, seat.agent).filter((w) => !seat.clock?.holds(w.block)).length;

  const viewOf = async (seat: Seat): Promise<{ state: ChannelState; messages: Message[] } | null> => {
    const session = await sessionOf(seat);
    if (!session) return null;
    const { runAgent } = await import("../agent.ts");
    return await runAgent(session.state());
  };

  const stateOf = async (seat: Seat): Promise<ChannelState | null> => (await viewOf(seat))?.state ?? null;

  const unreadFor = async (seat: Seat): Promise<{ unread: number; cursor: number; seqs: number[] } | { unread: 0 }> => {
    const session = await sessionOf(seat);
    if (!session) return { unread: 0 };
    const { runAgent } = await import("../agent.ts");
    const { messages, state } = await runAgent(session.state());
    const looped = !!seatRecordFor(loadConfig(), seat.alias, seat.agent)?.loop;
    const counted = await runAgent(session.unreadAt(state, messages, looped ? { loop: true } : {}));
    const docs = wakingDocs(seat);
    return docs ? { ...counted, unread: counted.unread + docs } : counted;
  };

  const pinnedExe = (seat: Seat, cmd: string): { exe: string } | { why: string } => {
    const record = seatRecordFor(loadConfig(), seat.alias, seat.agent);
    if (record?.bin && commandOf(record.harness) === cmd)
      return runnable(record.bin) ? { exe: record.bin } : { why: `${cmd} pinned at ${record.bin} is gone; join again from the harness to pin it anew` };
    const found = findOnPath(cmd);
    if (!found) return { why: `${cmd} not found on PATH` };
    if (record && commandOf(record.harness) === cmd) pinSeatBin(seat.alias, seat.agent, record.session, found);
    return { exe: found };
  };

  const runWake = async (seat: Seat, [cmd, ...rest]: string[]): Promise<string | null> => {
    if (!cmd) return "command not found on PATH";
    const pinned = pinnedExe(seat, cmd);
    if ("why" in pinned) return pinned.why;
    const { exe } = pinned;
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

  const logGivenUp = (seat: Seat, err: unknown): void =>
    appendWakeRow(dir, {
      at: Date.now(),
      alias: seat.alias,
      agent: seat.agent,
      via: seat.wakeVia ?? seat.lastWake?.via ?? "hooks",
      unread: 0,
      result: "failed",
      why: `the wake attempt ended on an error: ${oneLine(err instanceof Error ? err.message : String(err))}`,
      cursor: 0,
    });

  const setUntaken = (seat: Seat, why: string | null): void => {
    const was = seat.untaken;
    if (why === null) {
      seat.untaken = null;
      if (was) seat.announce?.();
      return;
    }
    const text = why.slice(0, UNTAKEN_WHY_MAX);
    if (was?.why === text) return;
    seat.untaken = { since: was?.since ?? Date.now(), why: text };
    seat.announce?.();
  };

  const watchTake = (seat: Seat, thread: string, seqs: number[], at: number, resumed: boolean): void => {
    if (seat.taking) clearTimeout(seat.taking.timer);
    seat.taking = null;
    if (stopped()) return;
    const timer = setTimeout(() => {
      void checkTake(seat).catch((err: unknown) => setUntaken(seat, `Kiwi's check of this Codex wake ended on an error: ${oneLine(err instanceof Error ? err.message : String(err))}`));
    }, wakeTakeMs);
    seat.taking = { thread, seqs, at, resumed, timer };
  };

  const checkTake = async (seat: Seat): Promise<void> => {
    const t = seat.taking;
    seat.taking = null;
    if (!t || !current(seat) || stopped()) return;
    const record = () => {
      const r = seatRecordFor(loadConfig(), seat.alias, seat.agent);
      return r?.harness === "codex" && r.session === t.thread ? r : null;
    };
    const unread = async (): Promise<{ cursor: number } | "read" | null> => {
      const counted = await withDeadline(unreadFor(seat), UNREAD_CHECK_MS).catch(() => null);
      if (counted === null) return null;
      return "cursor" in counted && t.seqs.some((seq) => counted.seqs.includes(seq)) ? { cursor: counted.cursor } : "read";
    };
    const again = (): void => watchTake(seat, t.thread, t.seqs, t.at, t.resumed);
    const bound = record();
    if (!bound) return setUntaken(seat, null);
    const left = await unread();
    if (left === null) return again();
    if (left === "read") return setUntaken(seat, null);
    const home = codexHome();
    const rollout = await codexRollout(home, t.thread);
    if (!rollout) {
      setUntaken(seat, `Codex took the wake but has no record of thread ${t.thread}: run a kiwi command in the Codex session you use, so Kiwi wakes that one`);
      return again();
    }
    const last = codexLastTurn(rollout);
    if (last.kind === "running") {
      const turn =
        last.at < t.at
          ? `the wake is queued behind thread ${t.thread}'s turn that started at ${utc(last.at)}, before the wake, and is still running`
          : `a turn on thread ${t.thread} started at ${utc(last.at)}, after the wake, but hasn't read it yet`;
      const quiet = last.quietFor >= CODEX_QUIET_MS ? `; nothing written to it since ${utc(Date.now() - last.quietFor)}: if the session moved to another thread, run a kiwi command there` : "";
      setUntaken(seat, `${turn}${quiet}`);
      return again();
    }
    if (last.kind !== "aborted") {
      setUntaken(seat, `Codex queued the wake for thread ${t.thread} but no turn read it in ${Math.round(wakeTakeMs / 1000)} s: if the session moved to another thread, run a kiwi command there`);
      return again();
    }
    const restart = codexWindowRestart(bound, t.thread, last.at);
    if (restart.kind === "live") {
      setUntaken(seat, `paused by you: the turn was interrupted at ${utc(last.at)} in the running session, so Codex holds its queue until you type in its window`);
      return again();
    }
    if (restart.kind === "unknown") {
      setUntaken(
        seat,
        `paused: Codex holds thread ${t.thread}'s queue since its turn was interrupted at ${utc(last.at)}, and Kiwi can't tell if the session restarted since (${restart.why}); type in its window to continue`,
      );
      return again();
    }
    if (t.resumed) {
      setUntaken(seat, `Kiwi resumed thread ${t.thread}'s paused queue, but no turn has read the wake yet; type in its window to continue`);
      return again();
    }
    let cursor = left.cursor;
    let restartedAt = restart.at;
    let settled: "moved" | "read" | null = null;
    const stillOwed = async (): Promise<string | null> => {
      const owed = await unread();
      if (!current(seat) || stopped()) return "the daemon let this seat go";
      const now = record();
      if (!now) {
        settled = "moved";
        return "the seat's binding moved off this thread";
      }
      if (owed === null) return "the wake's unread state can't be read";
      if (owed === "read") {
        settled = "read";
        return "the wake was read";
      }
      cursor = owed.cursor;
      const lastNow = codexLastTurn(rollout);
      if (lastNow.kind !== "aborted" || lastNow.turn !== last.turn) return "the thread's last turn changed";
      const restartNow = codexWindowRestart(now, t.thread, last.at);
      if (restartNow.kind !== "restarted") return "the restart can no longer be proven";
      restartedAt = restartNow.at;
      return null;
    };
    const started = await startCodexQueue(codexControlSocket(home), t.thread, stillOwed);
    if (started.kind === "abandoned") {
      if (settled) return setUntaken(seat, null);
      return again();
    }
    appendWakeRow(dir, {
      at: Date.now(),
      alias: seat.alias,
      agent: seat.agent,
      via: "codex-queue",
      unread: t.seqs.length,
      result: started.kind === "started" ? "ok" : "failed",
      why: started.kind === "started" ? `resumed Codex's paused queue: the session restarted at ${utc(restartedAt)}, after its turn was interrupted at ${utc(last.at)}` : started.why,
      cursor,
    });
    if (started.kind === "failed") {
      setUntaken(seat, `Codex paused thread ${t.thread}'s queue when its turn was interrupted at ${utc(last.at)}, and resuming it failed: ${started.why}`);
      return again();
    }
    setUntaken(seat, null);
    watchTake(seat, t.thread, t.seqs, t.at, true);
  };

  const scheduleWake = (seat: Seat, delay = wakeDelayMs): void => {
    if (seat.wakeTimer || stopped()) return;
    seat.wakeTimer = setTimeout(() => {
      seat.wakeTimer = null;
      void fireWake(seat).catch((err: unknown) => logGivenUp(seat, err));
    }, delay);
  };

  const commandPath = async (seat: Seat): Promise<Extract<WakePath, { kind: "command" }> | null> => {
    const cfg = loadConfig();
    if (!wakeOn(cfg, seat.alias, seat.agent)) return null;
    const path = await pathOf(cfg, seat.alias, seat.agent);
    return path.kind === "command" ? path : null;
  };

  const typeInto = async (seat: Seat, pane: string, prompt: string): Promise<{ why: string | null; retry: boolean }> => {
    const record = seatRecordFor(loadConfig(), seat.alias, seat.agent);
    const place = record?.tmux?.pane === pane ? record.tmux : null;
    const typed = await typeWake(place ? tmuxPane(place, process.env.KIWI_TMUX || "tmux") : null, prompt, record?.harness);
    return typed.ok ? { why: null, retry: false } : { why: typed.why, retry: typed.retry };
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
    if (nothingAt.get(seat.key) === seat.head && !wakingDocs(seat)) return;
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
      const attempts = seat.clock?.invoked() ?? [];
      const why =
        path.via === "webhook"
          ? hook
            ? await postWake(hook, { channel: seat.alias, agent: seat.agent, unread, prompt })
            : "no webhook set"
          : path.via === "kimi-server"
            ? await wakeKimi(seat, path.session, prompt)
            : path.via === "tmux-typing"
              ? await typeInto(seat, path.session, prompt).then((t) => ((retry = t.retry), t.why))
              : await runWake(seat, wakeArgv(path.via, path.session, prompt));
      if (!current(seat)) return;
      if (retry) {
        seat.clock?.rearm(attempts);
        seat.wakeAgain = false;
        return scheduleWake(seat, Math.min(wakeGapMs, TYPE_RETRY_MS));
      }
      seat.lastWake = { at: Date.now(), via: path.via, unread, ok: why === null };
      if (why === null) {
        seat.outstanding = { seqs, to, at: seat.lastWake.at };
        seat.clock?.delivered(attempts);
        if (path.via === "codex-queue") watchTake(seat, path.session, seqs, seat.lastWake.at, false);
      }
      logWake(seat, seat.lastWake, why, cursor);
    } finally {
      seat.waking = false;
      if (seat.wakeAgain && current(seat)) {
        seat.wakeAgain = false;
        scheduleWake(seat);
      }
    }
  };

  return { scheduleWake, stateOf, viewOf, sessionOf, wakeable: async (seat) => (await commandPath(seat)) !== null };
}
