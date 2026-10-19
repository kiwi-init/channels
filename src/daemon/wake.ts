import { appendFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config, type WakeHook } from "../config.ts";
import { listenHooksInstalled } from "../hooks/install/claude.ts";
import { piInstalled } from "../hooks/install/pi.ts";
import { wakeArgv, wakeKey, wakePath, wakePrompt, type WakePath } from "@kiwi/core/wake.ts";
import { withDeadline, type DaemonWake } from "./protocol.ts";
import { seatRecordFor, wakeOn } from "./reach.ts";
import type { Seat } from "./seat.ts";

const WAKE_LOG_KEEP_BYTES = 1_000_000;

export function appendRotated(file: string, line: string, keepBytes = WAKE_LOG_KEEP_BYTES): void {
  if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > keepBytes) renameSync(file, `${file}.1`);
  appendFileSync(file, line, { mode: 0o600 });
}

const WAKE_RUN_MS = 60_000;

function findExecutable(cmd: string): string | null {
  const user = process.env.HOME || homedir();
  const dirs = [process.env.PATH ?? "", join(user, ".local", "bin"), join(user, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":");
  return Bun.which(cmd, { PATH: dirs });
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}
const UNREAD_CHECK_MS = 30_000;

export const pathOf = async (cfg: Config, alias: string, agent: string): Promise<WakePath> => {
  return wakePath(seatRecordFor(cfg, alias, agent), listenHooksInstalled(), !!cfg.wakeHooks?.[wakeKey(alias, agent)], piInstalled());
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
  stopped: () => boolean;
  current: (seat: Seat) => boolean;
}

export function seatWakes({ dir, wakeDelayMs, wakeGapMs, stopped, current }: WakeContext): { scheduleWake: (seat: Seat, delay?: number) => void } {
  const unreadFor = async (seat: Seat): Promise<number> => {
    const c = loadConfig().channels[seat.alias];
    if (!c) return 0;
    const { AgentSession, runAgent } = await import("../agent.ts");
    const s = await AgentSession.open(seat.alias, c, seat.agent);
    const { messages, state } = await runAgent(s.state());
    return runAgent(s.unreadCount(state, messages));
  };

  const runWake = async (seat: Seat, [cmd, ...rest]: string[]): Promise<string | null> => {
    const exe = cmd ? findExecutable(cmd) : null;
    if (!exe) return `${cmd ?? "command"} not found on PATH`;
    try {
      const child = Bun.spawn([exe, ...rest], { env: { ...process.env }, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
      seat.wakeChild = child;
      const timer = setTimeout(() => child.kill(), WAKE_RUN_MS);
      const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      clearTimeout(timer);
      if (seat.wakeChild === child) seat.wakeChild = null;
      return code === 0 ? null : `exit ${code}${oneLine(err) ? `: ${oneLine(err)}` : ""}`;
    } catch (err) {
      return `could not start: ${oneLine(err instanceof Error ? err.message : String(err))}`;
    }
  };

  const logWake = (seat: Seat, w: DaemonWake, why: string | null): void => {
    try {
      appendRotated(join(dir, "wake.log"), `${new Date(w.at).toISOString()}\t${seat.alias}\t${seat.agent}\t${w.via}\t${w.unread}\t${w.ok ? "ok" : "failed"}${why ? `\t${why}` : ""}\n`);
    } catch {
      return;
    }
  };

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
    seat.waking = true;
    try {
      const unread = await withDeadline(unreadFor(seat), UNREAD_CHECK_MS).catch(() => null);
      if (unread === null) {
        seat.wakeAgain = false;
        return scheduleWake(seat, wakeGapMs);
      }
      if (!unread || !current(seat)) return;
      const path = await commandPath(seat);
      if (!path || !current(seat)) return;
      const prompt = wakePrompt(seat.alias, seat.agent);
      const hook = loadConfig().wakeHooks?.[wakeKey(seat.alias, seat.agent)];
      const why =
        path.via === "webhook"
          ? hook
            ? await postWake(hook, { channel: seat.alias, agent: seat.agent, unread, prompt })
            : "no webhook set"
          : await runWake(seat, wakeArgv(path.via, path.session, prompt));
      if (!current(seat)) return;
      seat.lastWake = { at: Date.now(), via: path.via, unread, ok: why === null };
      logWake(seat, seat.lastWake, why);
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
