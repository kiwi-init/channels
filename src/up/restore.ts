import { loadConfig, type SeatRecord } from "../config.ts";
import { abandonReserved, bindReserved, newSeatToken, reserveSeat, SEAT_TOKEN, unbindReserved, UP_LAUNCH, type Liveness, type PlacedSeat } from "../hold.ts";
import { claudeArgv } from "../loop/claude.ts";
import { loginArgv } from "../loop/login-argv.ts";
import { seatsFor } from "../seats.ts";
import { planUp } from "./plan.ts";

interface Child {
  pid: number;
  exited: Promise<number>;
}

export interface RestoreDeps {
  shell: string;
  bin: string;
  spawn: (argv: string[], cwd: string, env: Record<string, string>) => Child;
  started: (pid: number) => string | null;
  transcript: (session: string) => boolean;
  stop: (pid: number) => Promise<void>;
  wake: (alias: string, as: string) => Promise<string | null>;
  live: (b: SeatRecord) => Liveness;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  aborted: () => boolean;
}

export type Restored = { kind: "restored"; session: string; resumed: boolean; dir: string; exited: Promise<number> } | { kind: "running"; why: string } | { kind: "failed"; why: string };

const POLL_MS = 100;

export const RESUMED_PROMPT = "kiwi up restarted this session after the computer restarted. Check `kiwi status` and the repository before you carry on: things may have moved since.";
export const FRESH_PROMPT = "kiwi up started this fresh session for your seat after the computer restarted. Carry on from the checkpoints above; check the repository before you act on them.";

function childEnv(env: Record<string, string | undefined>, token: string): Record<string, string> {
  const kept = Object.entries(env).flatMap(([k, v]): [string, string][] => (v === undefined || k === SEAT_TOKEN || k === "KIWI_CHANNEL" || k === UP_LAUNCH ? [] : [[k, v]]));
  return { ...Object.fromEntries(kept), [SEAT_TOKEN]: token, [UP_LAUNCH]: "1" };
}

function priorOf(prior: readonly PlacedSeat[]): PlacedSeat | null {
  return prior.reduce<PlacedSeat | null>((best, p) => (!best || (p.record.at ?? 0) > (best.record.at ?? 0) ? p : best), null);
}

function refusal(alias: string, as: string, deps: RestoreDeps): Restored | null {
  const plan = planUp(loadConfig(), deps.live).find((p) => p.alias === alias && p.as === as);
  if (!plan) return { kind: "failed", why: `${as} has no seat in ${alias} on this computer` };
  switch (plan.kind) {
    case "restore":
    case "idle":
      return null;
    case "running":
      return { kind: "running", why: plan.why };
    case "loop":
      return { kind: "failed", why: `${as} in ${alias} runs under kiwi loop: run kiwi up without --seat, and it starts the loop again` };
    case "unsupported":
    case "unknown":
    case "skipped":
      return { kind: "failed", why: plan.why };
  }
}

export async function restoreSeat(alias: string, as: string, bindMs: number, deps: RestoreDeps, env: Record<string, string | undefined> = process.env): Promise<Restored> {
  const refused = refusal(alias, as, deps);
  if (refused) return refused;
  const token = newSeatToken();
  const reserved = reserveSeat(alias, as, token, deps.live);
  switch (reserved.kind) {
    case "no-seat":
      return { kind: "failed", why: `${as} has no seat in ${alias} on this computer` };
    case "running":
      return { kind: "running", why: "its session is still running" };
    case "starting":
      return { kind: "running", why: reserved.up ? "another kiwi up is starting it" : "its kiwi loop holds it" };
    case "unknown":
      return { kind: "failed", why: reserved.why };
    case "held":
      break;
  }
  const { prior } = reserved;
  const last = priorOf(prior);
  if (!last) {
    abandonReserved(alias, as, token);
    return { kind: "failed", why: `${as} has no seat in ${alias} on this computer` };
  }
  const resume = last.record.session && deps.transcript(last.record.session) ? last.record.session : undefined;
  const argv = loginArgv(
    deps.shell,
    claudeArgv({ bin: deps.bin, ...(resume ? { resume } : {}), ...(last.record.model ? { model: last.record.model } : {}), prompt: resume ? RESUMED_PROMPT : FRESH_PROMPT }),
    { KIWI_CHANNEL: alias, KIWI_AS: as },
  );
  const childEnvOf = childEnv(env, token);
  const child = deps.spawn(argv, last.dir, childEnvOf);
  let exited = false;
  void child.exited.then(() => void (exited = true));
  const deadline = deps.now() + bindMs;
  let session: string | null = null;
  while (!session && !exited && !deps.aborted() && deps.now() < deadline) {
    session = deps.started(child.pid);
    if (!session) await deps.sleep(POLL_MS);
  }
  const giveUp = async (why: string): Promise<Restored> => {
    await deps.stop(child.pid);
    abandonReserved(alias, as, token);
    return { kind: "failed", why };
  };
  if (!session)
    return giveUp(
      exited
        ? "Claude Code exited before it started a session"
        : deps.aborted()
          ? "stopped before the session took the seat"
          : `Claude Code didn't start a session within ${Math.round(bindMs / 1000)}s`,
    );
  const bound = bindReserved(alias, as, token, { harness: "claude", session, pid: child.pid });
  if (bound.kind !== "changed") return giveUp("its reservation was gone before the session could take the seat");
  const undo = async (why: string): Promise<Restored> => {
    await deps.stop(child.pid);
    unbindReserved(alias, as, token, prior);
    return { kind: "failed", why };
  };
  const who = { harness: "claude" as const, session, pid: child.pid };
  if (!seatsFor(last.dir, { who, env: childEnvOf, claim: false }).some((b) => b.alias === alias && b.as === as)) return undo("the new session doesn't find its seat from its folder");
  const noWake = await deps.wake(alias, as);
  if (noWake) return undo(`the new session can't be woken: ${noWake}`);
  return { kind: "restored", session, resumed: !!resume, dir: last.dir, exited: child.exited };
}
