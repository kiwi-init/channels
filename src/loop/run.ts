import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import { specPlanner, type ChannelState } from "@kiwi/core/state.ts";
import { openSession, type Agent } from "../agent.ts";
import type { AgentSession } from "../agent.ts";
import { randomBytes } from "node:crypto";
import type { ChannelConfig } from "../config.ts";
import { bindHeldSeat, holdSeat, releaseSeat, SEAT_TOKEN, type HoldChange } from "../hold.ts";
import { loginShell } from "../launch/shell.ts";
import { loginArgv } from "../terminals/shared/launch.ts";
import type { Recipe, Started } from "./recipes.ts";
import { clearPane, listenersUnder, paneText, pasteBracketed, stopStrays, strayKey, typeInto, type KimiScreen } from "./kimi.ts";
import { tmuxSocket } from "../terminals/shared/tmux.ts";
import { firstPrompt, nextWork, step, waitingBehind, waitingText, waitsDue, waitTellsTo, workName, type Wait, type Work } from "./work.ts";
import { clearFresh, freshAsked, LOOP_TASK_ENV } from "./fresh.ts";
import { LOOP_ENV } from "../hooks/loop-wait.ts";

const POLL_MS = 2_000;
const BIND_MS = 60_000;
const IDLE_SETTLED_MS = 10_000;
const ANSWER_MIN_MS = 20_000;
const IDLE_WAIT_MS = 15 * 60_000;
const TERM_GRACE_MS = 15_000;
const QUICK_END_MS = 30_000;
const PAUSE_MS = 5_000;
const STRAY_EVERY = 5;
const STARTING_MS = 2 * 60_000;
const WAIT_TELL_MS = 30 * 60_000;

export interface LoopSeat {
  alias: string;
  cfg: ChannelConfig;
  me: string;
  token: string;
  recipe: Recipe;
  model?: string;
  effort?: string;
}

type Ended = { kind: "done"; work: Work } | { kind: "fresh"; work: Work; why: "took" | "checkpoint" } | { kind: "own"; lived: number } | { kind: "unbound" } | { kind: "stopped" };

const say = (line: string) => Effect.sync(() => void process.stderr.write(`kiwi loop: ${line}\n`));

function heldOrDie(change: HoldChange, seat: LoopSeat): Effect.Effect<void, Error> {
  switch (change.kind) {
    case "changed":
      return Effect.void;
    case "no-seat":
      return Effect.fail(new Error(`${seat.me} has no seat in ${seat.alias} on this computer: kiwi join from this folder first`));
    case "not-held":
      return Effect.fail(new Error(`${seat.me} in ${seat.alias} lost its hold`));
    case "other-holder":
      return Effect.fail(new Error(`${seat.me} in ${seat.alias} is held by another loop`));
  }
}

const hold = (seat: LoopSeat) => Effect.suspend(() => heldOrDie(holdSeat(seat.alias, seat.me, seat.token, Date.now(), process.pid), seat));

const hooksFirst = (recipe: Recipe) =>
  Effect.suspend(() => {
    const wrote = recipe.hooks();
    return wrote ? say(`installed ${recipe.label}'s Kiwi hooks: ${wrote}`) : Effect.void;
  });

const pauseFor = (ms: number, stop: { asked: boolean }) =>
  Effect.gen(function* () {
    const until = Date.now() + ms;
    while (!stop.asked && Date.now() < until) yield* Effect.sleep(250);
  });

const look = (s: AgentSession) =>
  Effect.gen(function* () {
    const { messages, state } = yield* s.state();
    const forMe = (yield* s.unreadAt(state, messages, { forMe: true })).unread;
    return { state, forMe };
  });

function childEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).flatMap(([k, v]) => (v === undefined || k === SEAT_TOKEN || k === "KIWI_CHANNEL" ? [] : [[k, v]])));
}

export const runLoop = (seat: LoopSeat, stop: { asked: boolean; busy: boolean }): Effect.Effect<void, unknown, Agent> =>
  Effect.gen(function* () {
    process.env[SEAT_TOKEN] = seat.token;
    yield* hold(seat);
    yield* say(`holding ${seat.me} in ${seat.alias}; waiting for work (Ctrl-C stops the loop while no session runs)`);
    yield* Effect.ensuring(cycles(seat, stop), release(seat));
  });

const release = (seat: LoopSeat) =>
  Effect.suspend(() => {
    const change = releaseSeat(seat.alias, seat.me, seat.token);
    return say(change.kind === "changed" ? `released ${seat.me} in ${seat.alias}` : `${seat.me} in ${seat.alias} wasn't held by this loop`);
  });

const CLAIM_RETRY_MS = 10 * 60_000;
const PLAN_TTL_S = 30 * 60;

const setAside = (claims: Map<string, number>): Set<string> => {
  const now = Date.now();
  for (const [name, until] of claims) if (until <= now) claims.delete(name);
  return new Set(claims.keys());
};

const cycles = (seat: LoopSeat, stop: { asked: boolean; busy: boolean }): Effect.Effect<void, unknown, Agent> =>
  Effect.gen(function* () {
    const claims = new Map<string, number>();
    while (!stop.asked) {
      const s = yield* openSession(seat.alias, seat.cfg, seat.me);
      let seen = yield* look(s);
      let work = nextWork(seen.state, seat.me, seen.forMe, setAside(claims));
      while (!stop.asked && !work) {
        yield* Effect.sleep(POLL_MS);
        seen = yield* look(s);
        work = nextWork(seen.state, seat.me, seen.forMe, setAside(claims));
      }
      if (!work || stop.asked) break;
      if (work.kind === "reviewing" && seen.state.tasks.get(work.task)?.review === "*") {
        const taken = yield* claimReview(s, seat.me, work);
        if (!taken) claims.set(workName(work), Date.now() + CLAIM_RETRY_MS);
        continue;
      }
      if (work.kind === "coding" && !seen.state.tasks.get(work.task)?.owner) {
        const taken = yield* claimSpecTask(s, work);
        if (!taken) claims.set(workName(work), Date.now() + CLAIM_RETRY_MS);
        continue;
      }
      if (work.kind === "planning" && specPlanner(seen.state, work.ask) !== seat.me) {
        const taken = yield* takePlanning(s, seat.me, work);
        if (!taken) claims.set(workName(work), Date.now() + CLAIM_RETRY_MS);
        continue;
      }
      const ended = yield* runSession(seat, s, work, firstPrompt(work, seen.state, seat.me, seat.alias), stop, claims);
      yield* hold(seat);
      if (ended.kind === "done") yield* say(`${workName(ended.work)} is over; its session ended`);
      if (ended.kind === "fresh")
        yield* say(
          ended.why === "took"
            ? `the session took on ${workName(ended.work)}; a fresh session starts for it`
            : `${workName(ended.work)} asked for a fresh session; the next one starts from its checkpoint`,
        );
      if (ended.kind === "unbound") {
        yield* say(`the session never reported its id; ended it, and the next one starts in ${Math.round(QUICK_END_MS / 1000)}s`);
        yield* pauseFor(QUICK_END_MS, stop);
      }
      if (ended.kind === "own") {
        const pause = ended.lived < QUICK_END_MS ? QUICK_END_MS : PAUSE_MS;
        yield* say(`the session ended by itself; the next one starts in ${Math.round(pause / 1000)}s (Ctrl-C stops the loop)`);
        yield* pauseFor(pause, stop);
      }
    }
  });

function claimReview(s: AgentSession, me: string, work: Extract<Work, { kind: "reviewing" }>): Effect.Effect<boolean, never, Agent> {
  return s.taskUpdate(work.task, { review: me, claim: true, note: `taking round ${work.round}'s review` }).pipe(
    Effect.flatMap(() => say(`took ${workName(work)}'s review, open to anyone who hasn't worked on it`)),
    Effect.as(true),
    Effect.catchCause((cause) =>
      say(`couldn't take ${workName(work)}'s review (${Cause.pretty(cause).split("\n")[0]}); other work goes first, and the loop tries again in ${CLAIM_RETRY_MS / 60_000} minutes`).pipe(
        Effect.as(false),
      ),
    ),
  );
}

function claimSpecTask(s: AgentSession, work: Extract<Work, { kind: "coding" }>): Effect.Effect<boolean, never, Agent> {
  return s.taskClaim(work.task).pipe(
    Effect.flatMap(() => say(`took ${workName(work)}, open under an approved spec`)),
    Effect.as(true),
    Effect.catchCause((cause) => say(`couldn't take ${workName(work)} (${Cause.pretty(cause).split("\n")[0]}); the loop tries again in ${CLAIM_RETRY_MS / 60_000} minutes`).pipe(Effect.as(false))),
  );
}

function takePlanning(s: AgentSession, me: string, work: Extract<Work, { kind: "planning" }>): Effect.Effect<boolean, never, Agent> {
  return s.startSpec(work.ask, PLAN_TTL_S).pipe(
    Effect.flatMap(({ lease }) =>
      lease.holder === me ? say(`took ${workName(work)}: approved, and this seat is free`).pipe(Effect.as(true)) : say(`${lease.holder} is planning ${workName(work)}`).pipe(Effect.as(false)),
    ),
    Effect.catchCause((cause) => say(`couldn't take ${workName(work)} (${Cause.pretty(cause).split("\n")[0]}); the loop tries again in ${CLAIM_RETRY_MS / 60_000} minutes`).pipe(Effect.as(false))),
  );
}

function runSession(seat: LoopSeat, s: AgentSession, first: Work, prompt: string, stop: { asked: boolean; busy: boolean }, claims: Map<string, number>): Effect.Effect<Ended, unknown, Agent> {
  return Effect.suspend(() => {
    let spawned: { left: Effect.Effect<void>; mode: string | null } | null = null;
    const leave = Effect.gen(function* () {
      if (!spawned) return;
      yield* spawned.left;
      restoreTerminal(spawned.mode);
      stop.busy = false;
    });
    return session(seat, s, first, prompt, stop, claims, (left, mode) => void (spawned = { left, mode })).pipe(Effect.ensuring(leave));
  });
}

function session(
  seat: LoopSeat,
  s: AgentSession,
  first: Work,
  prompt: string,
  stop: { asked: boolean; busy: boolean },
  claims: Map<string, number>,
  spawned: (left: Effect.Effect<void>, mode: string | null) => void,
): Effect.Effect<Ended, unknown, Agent> {
  return Effect.gen(function* () {
    const { recipe } = seat;
    const nonce = randomBytes(9).toString("hex");
    const launched = [prompt, ...(recipe.firstLine ? [recipe.firstLine] : []), `(Kiwi loop launch ${nonce})`].join("\n\n");
    const argv = loginArgv(loginShell(), recipe.argv({ bin: recipe.bin, prompt: launched, ...(seat.model ? { model: seat.model } : {}), ...(seat.effort ? { effort: seat.effort } : {}) }), {
      KIWI_CHANNEL: seat.alias,
      KIWI_AS: seat.me,
      [LOOP_ENV]: "1",
      ...(first.kind === "coding" ? { [LOOP_TASK_ENV]: String(first.task) } : {}),
    });
    yield* hooksFirst(recipe);
    if (recipe.screen) clearTypedPane();
    const mode = terminalMode();
    const started = Date.now();
    const child = Bun.spawn(argv, { cwd: process.cwd(), env: childEnv(), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    stop.busy = true;
    let exited = false;
    void child.exited.then(() => void (exited = true));
    const finish = Effect.gen(function* () {
      if (exited) return;
      child.kill(recipe.stopSignal);
      const late = Date.now() + TERM_GRACE_MS;
      while (!exited && Date.now() < late) yield* Effect.sleep(250);
      if (!exited) child.kill("SIGKILL");
      yield* Effect.promise(() => child.exited);
    });
    spawned(finish, mode);
    yield* say(`${workName(first)}: started ${recipe.label} (pid ${child.pid})`);

    let found: Started | null = null;
    const strays = new Set<string>();
    const noteStrays = () => {
      for (const stray of listenersUnder(child.pid)) strays.add(strayKey(stray));
    };
    let polls = 0;
    const waits = new Map<string, Wait>();
    const end = (why: Ended) =>
      Effect.gen(function* () {
        if (!exited) noteStrays();
        if (!exited) {
          yield* hold(seat);
          const until = why.kind === "done" || why.kind === "fresh" ? Date.now() + IDLE_WAIT_MS : 0;
          while (!exited && !stop.asked && Date.now() < until && !found?.idle().idle) yield* Effect.sleep(POLL_MS);
          yield* finish;
        }
        const stopped = strays.size ? stopStrays(strays) : 0;
        if (stopped) yield* say(`stopped ${stopped} kiwi listener${stopped > 1 ? "s" : ""} the session left running`);
        stop.busy = false;
        return why;
      });

    if (recipe.screen) {
      const typed = yield* typeFirst(recipe.screen, child.pid, launched, () => exited, stop);
      if (!typed) return yield* end(exited ? { kind: "own", lived: Date.now() - started } : stop.asked ? { kind: "stopped" } : { kind: "unbound" });
    }
    const binding = Date.now();
    while (!found && !exited && !stop.asked && Date.now() - binding < BIND_MS) {
      found = recipe.started(child.pid, started, nonce);
      if (!found) yield* Effect.sleep(100);
    }
    if (!found) return yield* end(exited ? { kind: "own", lived: Date.now() - started } : stop.asked ? { kind: "stopped" } : { kind: "unbound" });
    const live = found;
    yield* heldOrDie(bindHeldSeat(seat.alias, seat.me, seat.token, live.bound, "loop"), seat);
    yield* say(`${seat.me} is bound to ${recipe.label} session ${live.id}`);

    while (true) {
      if (exited) return yield* end({ kind: "own", lived: Date.now() - started });
      if (stop.asked) return yield* end({ kind: "stopped" });
      if (polls++ % STRAY_EVERY === 0) noteStrays();
      const seen = yield* look(s);
      const next = step(first, seen.state, seat.me, freshAsked(seat.alias, seat.me, started), setAside(claims));
      if (next.kind === "fresh") {
        clearFresh(seat.alias, seat.me);
        return yield* end(next);
      }
      if (next.kind === "over" || (first.kind === "answering" && answered(live, started, seen.forMe))) return yield* end({ kind: "done", work: first });
      const now = Date.now();
      const { fresh, due } = waitsDue(waits, waitingBehind(first, seen.state, seat.me, setAside(claims)), now, WAIT_TELL_MS);
      for (const w of fresh) yield* say(`${workName(w)} is waiting; the ${workName(first)} session is still running`);
      for (const w of due) yield* tellWait(s, seen.state, seat.me, w, first, waits, now);
      yield* Effect.sleep(POLL_MS);
    }
  });
}

function tellWait(s: AgentSession, state: ChannelState, me: string, w: Work, session: Work, waits: Map<string, Wait>, now: number): Effect.Effect<void, never, Agent> {
  return Effect.gen(function* () {
    const wait = waits.get(workName(w));
    if (!wait) return;
    const minutes = Math.round((now - wait.since) / 60_000);
    const to = waitTellsTo(state, me);
    const head = `${workName(w)} has waited ${minutes} minutes behind the ${workName(session)} session`;
    if (!to.length) {
      wait.tellAt = null;
      return yield* say(`${head}, and there's nobody to tell`);
    }
    const sent = yield* s.send(waitingText(w, session, minutes), { to }).pipe(
      Effect.as(true),
      Effect.catchCause(() => Effect.succeed(false)),
    );
    wait.tellAt = sent ? null : now + WAIT_TELL_MS;
    yield* say(sent ? `${head}; told ${to.join(", ")}` : `${head}; couldn't tell ${to.join(", ")}, trying again in ${Math.round(WAIT_TELL_MS / 60_000)} minutes`);
  });
}

function ownsTerminal(): boolean {
  if (!process.stdin.isTTY) return false;
  const ps = Bun.spawnSync(["ps", "-o", "pgid=,tpgid=", "-p", String(process.pid)], { stdout: "pipe", stderr: "ignore" });
  const [group, foreground] = ps.stdout.toString().trim().split(/\s+/).map(Number);
  return ps.exitCode === 0 && group !== undefined && group > 0 && group === foreground;
}

function terminalMode(): string | null {
  if (!ownsTerminal()) return null;
  const saved = Bun.spawnSync(["stty", "-g"], { stdin: "inherit", stdout: "pipe", stderr: "ignore" });
  const mode = saved.stdout.toString().trim();
  return saved.exitCode === 0 && mode ? mode : null;
}

function restoreTerminal(mode: string | null): void {
  if (mode && ownsTerminal()) Bun.spawnSync(["stty", mode], { stdin: "inherit", stdout: "ignore", stderr: "ignore" });
}

function clearTypedPane(): void {
  const socket = tmuxSocket(process.env);
  const pane = process.env.TMUX_PANE;
  if (socket && pane) clearPane(socket, pane);
}

function typeFirst(readScreen: (text: string) => KimiScreen, pid: number, text: string, exited: () => boolean, stop: { asked: boolean }): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const socket = tmuxSocket(process.env);
    const pane = process.env.TMUX_PANE;
    if (!socket || !pane) return false;
    let told = false;
    let sawReady = false;
    let deadline = Date.now() + STARTING_MS;
    while (!exited() && !stop.asked) {
      const screen = readScreen(paneText(socket, pane));
      if (screen === "ready") {
        if (pasteBracketed(socket, pane)) return typeInto(socket, pane, text);
        sawReady = true;
      }
      if (screen === "trust") {
        deadline = Date.now() + STARTING_MS;
        if (!told) {
          told = true;
          yield* say(`waiting for you to answer the trust prompt in this window (pid ${pid})`);
        }
      } else if (Date.now() > deadline) {
        const minutes = Math.round(STARTING_MS / 60_000);
        yield* say(
          sawReady
            ? `the session showed its ready screen, but tmux never reported bracketed paste on within ${minutes} minutes`
            : `the session never showed its ready screen within ${minutes} minutes`,
        );
        return false;
      }
      yield* Effect.sleep(500);
    }
    return false;
  });
}

function answered(session: Started, started: number, forMe: number): boolean {
  const now = Date.now();
  const c = session.idle();
  return forMe === 0 && now - started >= ANSWER_MIN_MS && c.idle && c.since !== null && now - c.since >= IDLE_SETTLED_MS;
}
