import * as Effect from "effect/Effect";
import { openSession, type Agent } from "../agent.ts";
import type { AgentSession } from "../agent.ts";
import { randomBytes } from "node:crypto";
import type { ChannelConfig } from "../config.ts";
import { bindHeldSeat, holdSeat, releaseSeat, SEAT_TOKEN, type HoldChange } from "../hold.ts";
import { loginShell } from "../launch/shell.ts";
import { loginArgv } from "../terminals/shared/launch.ts";
import type { Recipe, Started } from "./recipes.ts";
import { firstPrompt, nextWork, workName, workOver, type Work } from "./work.ts";

const POLL_MS = 2_000;
const BIND_MS = 60_000;
const IDLE_SETTLED_MS = 10_000;
const ANSWER_MIN_MS = 20_000;
const IDLE_WAIT_MS = 15 * 60_000;
const TERM_GRACE_MS = 15_000;
const QUICK_END_MS = 30_000;
const PAUSE_MS = 5_000;

export interface LoopSeat {
  alias: string;
  cfg: ChannelConfig;
  me: string;
  token: string;
  recipe: Recipe;
  model?: string;
  effort?: string;
}

type Ended = { kind: "done"; work: Work } | { kind: "own"; lived: number } | { kind: "unbound" } | { kind: "stopped" };

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

const hold = (seat: LoopSeat) => Effect.suspend(() => heldOrDie(holdSeat(seat.alias, seat.me, seat.token), seat));

const hooksFirst = (recipe: Recipe) =>
  Effect.suspend(() => {
    const wrote = recipe.hooks();
    return wrote ? say(`installed ${recipe.label}'s Kiwi hooks: ${wrote}`) : Effect.void;
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

const cycles = (seat: LoopSeat, stop: { asked: boolean; busy: boolean }): Effect.Effect<void, unknown, Agent> =>
  Effect.gen(function* () {
    while (!stop.asked) {
      const s = yield* openSession(seat.alias, seat.cfg, seat.me);
      let seen = yield* look(s);
      let work = nextWork(seen.state, seat.me, seen.forMe);
      while (!stop.asked && !work) {
        yield* Effect.sleep(POLL_MS);
        seen = yield* look(s);
        work = nextWork(seen.state, seat.me, seen.forMe);
      }
      if (!work || stop.asked) break;
      const ended = yield* runSession(seat, s, work, firstPrompt(work, seen.state, seat.me, seat.alias), stop);
      yield* hold(seat);
      if (ended.kind === "done") yield* say(`${workName(ended.work)} is over; its session ended`);
      if (ended.kind === "unbound") yield* say("the session never reported its id; ended it");
      if (ended.kind === "own") {
        const pause = ended.lived < QUICK_END_MS ? QUICK_END_MS : PAUSE_MS;
        yield* say(`the session ended by itself; the next one starts in ${Math.round(pause / 1000)}s (Ctrl-C stops the loop)`);
        yield* Effect.sleep(pause);
      }
    }
  });

function runSession(seat: LoopSeat, s: AgentSession, first: Work, prompt: string, stop: { asked: boolean; busy: boolean }): Effect.Effect<Ended, unknown, Agent> {
  return Effect.gen(function* () {
    const { recipe } = seat;
    const nonce = randomBytes(9).toString("hex");
    const launched = `${prompt}\n\n(Kiwi loop launch ${nonce})`;
    const argv = loginArgv(loginShell(), recipe.argv({ bin: recipe.bin, prompt: launched, ...(seat.model ? { model: seat.model } : {}), ...(seat.effort ? { effort: seat.effort } : {}) }), {
      KIWI_CHANNEL: seat.alias,
      KIWI_AS: seat.me,
    });
    yield* hooksFirst(recipe);
    const started = Date.now();
    const child = Bun.spawn(argv, { cwd: process.cwd(), env: childEnv(), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    stop.busy = true;
    let exited = false;
    void child.exited.then(() => void (exited = true));
    yield* say(`${workName(first)}: started ${recipe.label} (pid ${child.pid})`);

    let found: Started | null = null;
    const end = (why: Ended) =>
      Effect.gen(function* () {
        if (!exited) {
          yield* hold(seat);
          const until = Date.now() + IDLE_WAIT_MS;
          while (!exited && !stop.asked && Date.now() < until && !found?.idle().idle) yield* Effect.sleep(POLL_MS);
          child.kill("SIGTERM");
          const late = Date.now() + TERM_GRACE_MS;
          while (!exited && Date.now() < late) yield* Effect.sleep(250);
          if (!exited) child.kill("SIGKILL");
          yield* Effect.promise(() => child.exited);
        }
        stop.busy = false;
        return why;
      });

    while (!found && !exited && Date.now() - started < BIND_MS) {
      found = recipe.started(child.pid, started, nonce);
      if (!found) yield* Effect.sleep(100);
    }
    if (!found) return yield* end(exited ? { kind: "own", lived: Date.now() - started } : { kind: "unbound" });
    const live = found;
    yield* heldOrDie(bindHeldSeat(seat.alias, seat.me, seat.token, live.bound), seat);
    yield* say(`${seat.me} is bound to ${recipe.label} session ${live.id}`);

    let work = first;
    while (true) {
      if (exited) return yield* end({ kind: "own", lived: Date.now() - started });
      if (stop.asked) return yield* end({ kind: "stopped" });
      const seen = yield* look(s);
      if (work.kind === "answering") {
        const taken = nextWork(seen.state, seat.me, 0);
        if (taken?.kind === "coding") {
          work = taken;
          yield* say(`the session took on ${workName(work)}; it lasts until that's done`);
        }
      }
      const over = work.kind === "answering" ? answered(live, started, seen.forMe) : workOver(work, seen.state, seat.me);
      if (over) return yield* end({ kind: "done", work });
      yield* Effect.sleep(POLL_MS);
    }
  });
}

function answered(session: Started, started: number, forMe: number): boolean {
  const now = Date.now();
  const c = session.idle();
  return forMe === 0 && now - started >= ANSWER_MIN_MS && c.idle && c.since !== null && now - c.since >= IDLE_SETTLED_MS;
}
