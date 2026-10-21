import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { eachLive } from "@kiwi/core/client.ts";
import { PERMISSION_CHOICES, permissionAnswer, permissionShown, type PermissionSettled } from "@kiwi/core/permission.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { humanOf, type ChannelState } from "@kiwi/core/state.ts";
import { openSession, type AgentSession } from "../agent.ts";
import { home, Keystore } from "../config.ts";
import { sameSeat, seatsHeldAnywhere, type Binding } from "../seats.ts";
import { PERMISSION_SECONDS } from "./install/claude.ts";
import { pendingCall, watchCall, type PendingCall, type Settled } from "./permission-call.ts";

const POLL_MS = 500;
const WAIT_MS = (PERMISSION_SECONDS - 60) * 1000;
const CLOSE_MS = 3_000;
const FOLD_TRIES = 10;
const FOLD_WAIT_MS = 500;
const WRITING_MS = 5_000;
const SIGNALS = ["SIGTERM", "SIGHUP", "SIGINT"] as const;

export interface PermissionInput {
  session_id?: unknown;
  transcript_path?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
  mcp_server?: unknown;
  agent_id?: unknown;
}

export type Decided = { decision: "allow" | "deny"; by: string };
type Outcome = Decided | { settled: PermissionSettled };

const CLOSING: Record<PermissionSettled, string> = {
  terminal: "Answered in the terminal.",
  timeout: "No answer from the app in time: answer it in the terminal.",
  ended: "The session ended before an answer.",
};

export function decisionJson(d: Decided): string {
  const decision = d.decision === "allow" ? { behavior: "allow" } : { behavior: "deny", message: `Denied from the Kiwi app by ${d.by}` };
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });
}

export function judged(messages: readonly Message[], state: ChannelState, ask: { id: string; from: string }, seq: number): Decided | null {
  const bySeq = new Map(messages.map((x) => [x.seq, x]));
  const asked = messages.find((x) => x.id === ask.id && x.from === ask.from);
  const reply = bySeq.get(seq);
  const said = asked && reply ? permissionAnswer(asked, reply, { ...state, bySeq }) : null;
  return said && reply ? { decision: said, by: reply.from } : null;
}

export function whenFolded<E, R>(
  read: Effect.Effect<{ messages: readonly Message[]; state: ChannelState }, E, R>,
  ask: { id: string; from: string },
  seq: number,
  tries = FOLD_TRIES,
  waitMs = FOLD_WAIT_MS,
): Effect.Effect<Decided | null, E, R> {
  return Effect.gen(function* () {
    for (let n = 0; n < tries; n++) {
      const { messages, state } = yield* read;
      if (messages.some((x) => x.seq === seq)) return judged(messages, state, ask, seq);
      yield* Effect.sleep(waitMs);
    }
    return null;
  });
}

function permissionSeat(session: string): Binding | null {
  const seats = seatsHeldAnywhere({ harness: "claude", session }, { claim: false }).filter((b, i, all) => all.findIndex((o) => sameSeat(o, b)) === i);
  return seats.length === 1 ? seats[0]! : null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it runs, as someone else. Anything else: it's gone.
    return (err as { code?: unknown }).code === "EPERM";
  }
}

export function shownCwd(cwd: unknown, mine: string = homedir()): unknown {
  if (typeof cwd !== "string" || !mine) return cwd;
  return cwd === mine ? "~" : cwd.startsWith(`${mine}/`) ? `~${cwd.slice(mine.length)}` : cwd;
}

export interface Held {
  release: () => void;
  newer: () => boolean;
}

export type Asking = Pick<AgentSession, "me" | "state" | "escalate" | "owe" | "reply"> & { readonly ch: { readonly fx: Pick<AgentSession["ch"]["fx"], "head" | "live"> } };

export function holdSession(session: string): Held | null {
  const dir = join(home(), "permission");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${session.replace(/[^A-Za-z0-9_-]/g, "_")}.pid`);
  const marker = `${file}.newer`;
  const since = Date.now();
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(file, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return {
        release: () => {
          try {
            if (readFileSync(file, "utf8") !== String(process.pid)) return;
            rmSync(marker, { force: true });
            rmSync(file);
          } catch {
            // Already gone: nothing to release.
          }
        },
        newer: () => {
          try {
            return statSync(marker).mtimeMs >= since;
          } catch {
            // No later prompt in this session has started.
            return false;
          }
        },
      };
    } catch {
      // Another hook holds this session, or held it and died: a live one keeps it, and learns a newer prompt started.
      let held: number | null = null;
      let fresh = false;
      try {
        const pid = Number(readFileSync(file, "utf8"));
        fresh = Date.now() - statSync(file).mtimeMs < WRITING_MS;
        held = pid;
      } catch {
        // Gone between the two reads: try again.
      }
      if (held === null) continue;
      if ((held === 0 && fresh) || (Number.isInteger(held) && held > 0 && alive(held))) {
        writeFileSync(marker, String(Date.now()), { mode: 0o600 });
        return null;
      }
      rmSync(file, { force: true });
    }
  }
  return null;
}

const whenSignalled = Effect.callback<void>((resume) => {
  const done = () => resume(Effect.void);
  for (const s of SIGNALS) process.once(s, done);
  return Effect.sync(() => {
    for (const s of SIGNALS) process.off(s, done);
  });
});

const quit = () => process.exit(0);

const waitForAnswer = Effect.fn("Hooks.permission.wait")(function* (s: Asking, input: PermissionInput, call: PendingCall, transcript: string, claudePid: number | null, held: Held) {
  const id = randomUUID();
  const expiresAt = Date.now() + WAIT_MS;
  const shown = permissionShown({ tool_name: input.tool_name, tool_input: input.tool_input, cwd: shownCwd(input.cwd), mcp_server: input.mcp_server }, randomBytes(18).toString("base64url"), expiresAt);
  if (!shown) return null;
  const { state } = yield* s.state();
  if (state.hold || !humanOf(state, s.me)) return null;
  const settledNow = watchCall(transcript, call);
  const head = yield* s.ch.fx.head();
  const body = `Claude Code asks to use ${shown.tool}${shown.command ? `: ${shown.command}` : ""}`;
  const { seq } = yield* s.escalate(body, undefined, undefined, { choices: [...PERMISSION_CHOICES], id, permission: { ...shown, call: call.id } });
  const outcome = yield* Deferred.make<Outcome>();
  const decide = (m: Message) =>
    Effect.gen(function* () {
      if (!m.re?.includes(seq)) return;
      s.owe(m.seq);
      const said = yield* whenFolded(s.state(), { id, from: s.me }, m.seq);
      if (said) yield* Deferred.succeed(outcome, said);
    });
  const watching = Effect.gen(function* () {
    for (;;) {
      const done: Settled | null = settledNow();
      if (done) return yield* Deferred.succeed(outcome, { settled: "terminal" });
      if (claudePid !== null && !alive(claudePid)) return yield* Deferred.succeed(outcome, { settled: "ended" });
      if (held.newer()) return yield* Deferred.succeed(outcome, { settled: "terminal" });
      if (Date.now() >= expiresAt) return yield* Deferred.succeed(outcome, { settled: "timeout" });
      yield* Effect.sleep(POLL_MS);
    }
  });
  const listening = eachLive(
    s.ch.fx.live(head, { presence: false, reads: false }),
    (ev) => (ev._tag === "Message" ? decide(ev.message) : Effect.void),
    () => Effect.void,
  );
  yield* Effect.forkScoped(watching);
  yield* Effect.forkScoped(listening.pipe(Effect.catchCause(() => Effect.void)));
  for (const sig of SIGNALS) process.off(sig, quit);
  yield* Effect.forkScoped(
    Effect.andThen(
      whenSignalled,
      Effect.suspend(() => Deferred.succeed(outcome, { settled: claudePid !== null && alive(claudePid) ? "terminal" : "ended" })),
    ),
  );
  return { got: yield* Deferred.await(outcome), seq, settledNow };
}, Effect.scoped);

export const askPermission = Effect.fn("Hooks.permission.ask")(function* (s: Asking, input: PermissionInput, call: PendingCall, transcript: string, claudePid: number | null, held: Held) {
  const asked = yield* waitForAnswer(s, input, call, transcript, claudePid, held);
  if (!asked) return null;
  const { got, seq, settledNow } = asked;
  const close = (settled: PermissionSettled) => s.reply(seq, CLOSING[settled], "msg", undefined, { settled }).pipe(Effect.timeoutOption(CLOSE_MS), Effect.ignore);
  if ("settled" in got) {
    yield* close(got.settled);
    return null;
  }
  if (got.decision === "allow" && (yield* s.state()).state.hold) return null;
  if (settledNow() || held.newer()) {
    yield* close("terminal");
    return null;
  }
  return got;
});

export const runPermission = Effect.fn("Hooks.permission")(function* (input: PermissionInput, claudePid: number | null) {
  if (input.agent_id !== undefined) return null;
  const { session_id: session, transcript_path: transcript, tool_name: tool } = input;
  if (typeof session !== "string" || typeof transcript !== "string" || typeof tool !== "string") return null;
  const seat = permissionSeat(session);
  if (!seat) return null;
  const cfg = (yield* (yield* Keystore).config).channels[seat.alias];
  if (!cfg) return null;
  const call = pendingCall(transcript, tool, input.tool_input);
  if (!call) return null;
  const held = holdSession(session);
  if (!held) return null;
  for (const sig of SIGNALS) process.once(sig, quit);
  const s = yield* openSession(seat.alias, cfg, seat.as);
  return yield* askPermission(s, input, call, transcript, claudePid, held).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        for (const sig of SIGNALS) process.off(sig, quit);
        held.release();
      }),
    ),
  );
});
