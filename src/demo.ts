// `kiwi demo`: a channel of agents coordinating, in thirty seconds, with nothing to set up. It runs a
// relay inside this process on a throwaway port and folder, with a throwaway KIWI_HOME, so it never
// touches this computer's channels, its hooks, or any public relay. Then it plays a short session
// through the real client: the owner's charter, agents' cards, the task board, a
// question and its answer, a review gate, a handover, an escalation, and the hold.

import { personaOf } from "@kiwi/core/personality.ts";
import { PRESETS } from "@kiwi/core/presets.ts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { openOwnerSession } from "./owner.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentSession } from "./agent.ts";
import { Channel, eachLive, reason } from "@kiwi/core/client.ts";

export interface DemoOptions {
  /** Pause between beats, in ms. */
  pace?: number;
  /** Keep the relay (and the dashboard, when there's one) up after the session. */
  stay?: boolean;
  /** Where to serve the dashboard from, when it's built (web/dist in a checkout). */
  web?: string;
  print?: (line: string) => void;
}

/** A throwaway home and relay for the session; on release both go, and the caller's KIWI_HOME and KIWI_NO_HOOKS come back. */
const sandbox = (web: string | undefined) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const root = mkdtempSync(join(tmpdir(), "kiwi-demo-"));
      const was = { home: process.env.KIWI_HOME, hooks: process.env.KIWI_NO_HOOKS };
      process.env.KIWI_HOME = join(root, "home");
      process.env.KIWI_NO_HOOKS = "1";
      const { startRelay } = await import("./relay/bun.ts");
      const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay"), web: web ? { dir: web } : null });
      return { root, was, server, relay: server.url.origin };
    }),
    ({ root, was, server }) =>
      Effect.sync(() => {
        server.stop(true);
        rmSync(root, { recursive: true, force: true });
        for (const [k, v] of [
          ["KIWI_HOME", was.home],
          ["KIWI_NO_HOOKS", was.hooks],
        ] as const) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }),
  );

/** The session itself, in the sandbox (which closes with the scope). */
const play = Effect.fn("Demo.run")(function* (opts: DemoOptions) {
  const print = opts.print ?? ((l: string) => process.stdout.write(l + "\n"));
  const pace = opts.pace ?? 600;
  const line = (l: string) => Effect.sync(() => print(l));
  // Everything this session writes lives in the sandbox, and goes with it.
  const { relay } = yield* sandbox(opts.web);
  const { openSession } = yield* Effect.promise(() => import("./agent.ts"));
  const { loadIdentity, saveConfig } = yield* Effect.promise(() => import("./config.ts"));
  const { newRoomId } = yield* Effect.promise(() => import("@kiwi/core/crypto.ts"));
  const { formatMessage, formatStatus, formatTasks } = yield* Effect.promise(() => import("@kiwi/core/format.ts"));

  const names = ["lead", "mac", "win", "ci"] as const;
  const roomId = newRoomId();
  const owner = yield* Effect.promise(() => loadIdentity("human", roomId));
  const ids = yield* Effect.promise(() => Promise.all(names.map((n) => loadIdentity(n, roomId))));
  const { code, access } = yield* Channel.fx.create(
    relay,
    owner,
    { name: "human", role: "owner" },
    ids.map((id) => ({ ...id, info: { name: id.name } })),
    roomId,
    null,
    "onemouse",
  );
  const cfg = { ...access, relay, code, owner: "human" };
  saveConfig({ default: "demo", channels: { demo: cfg } });
  // The owner is played in-process with the client library, as the Kiwi app does; the rest are agents.
  const open = (n: string) => openSession("demo", cfg, n);
  const human = yield* openOwnerSession("demo", cfg, "human");
  const [lead, mac, win, ci] = yield* Effect.all([open("lead"), open("mac"), open("win"), open("ci")], { concurrency: "unbounded" });
  const beat = Effect.sleep(pace);
  /** What a refusal says, for the lines that show one. */
  const refused = (e: Effect.Effect<unknown, unknown, Agent>, say: (why: string) => string) => Effect.catchCause(e, (cause) => line(say(reason(Cause.squash(cause)))));

  // Every message as it lands, one line each, the way agents read the channel.
  const watcher = yield* Effect.forkChild(
    eachLive(
      human.ch.fx.live(yield* human.ch.fx.head(), { presence: false, reads: false }),
      (ev) => (ev._tag === "Message" ? Effect.flatMap(human.state(), ({ state }) => line(formatMessage(ev.message, state.trust.get(ev.message.seq), state))) : Effect.void),
      () => Effect.void,
    ).pipe(Effect.ignoreCause),
  );
  const say = (l: string) =>
    Effect.gen(function* () {
      yield* beat;
      yield* line(`\n— ${l}`);
      yield* Effect.sleep(150);
    });

  yield* line(`A channel on a relay running inside this process (${relay}).\nEverything is end-to-end encrypted; the relay sees only ciphertext.`);

  yield* say("The owner says what the channel is for. Every agent works within it.");
  yield* human.setCharter("Get onemouse working end to end between a Mac and a PC. This repo only; nothing in production; ask before adding dependencies.");

  yield* say("Each agent says what it runs on (sent on its own when an agent joins and listens).");
  yield* mac.refreshCard({ os: "macos", arch: "arm64", harness: "claude-code", tools: ["git", "rust", "xcode"], repo: "ojow/onemouse" });
  yield* win.refreshCard({ os: "windows", arch: "x64", harness: "codex", tools: ["git", "rust", "dotnet"], repo: "ojow/onemouse" });
  yield* ci.refreshCard({ os: "linux", arch: "x64", tools: ["git", "docker", "rust"], note: "the CI box" });
  yield* lead.hello();
  yield* human.givePersona("lead", personaOf(PRESETS.find((p) => p.role === "lead")!));

  yield* say("The planner puts work on the board: open, then doing, then done.");
  const proto = yield* lead.taskAdd("Freeze protocol v1 wire format", { review: "any" });
  const inject = yield* lead.taskAdd("Inject mouse input on Windows");
  const capture = yield* lead.taskAdd("Capture input at the screen edge on the Mac");
  yield* lead.taskAdd("Build the release in CI");
  const { state: board } = yield* lead.state();
  yield* line(formatTasks(board));

  yield* say("Agents take what they can do (People shows who runs where), and ask each other directly.");
  yield* mac.taskClaim(proto);
  const q = yield* win.ask("Do you forward key repeat? Windows doesn't repeat injected keys.", { to: ["mac"] });
  yield* mac.reply(q.seq, "Yes: autorepeat goes out as extra KeyDown events.");

  yield* say("A reviewed task isn't done on its doer's word: someone else approves it.");
  yield* refused(mac.taskUpdate(proto, { state: "done" }), (why) => `(mac tried to mark it done: ${why})`);
  yield* mac.taskUpdate(proto, { state: "review", note: "spec in docs/protocol-v1.md" });
  yield* ci.taskUpdate(proto, { state: "done", note: "round-trips every message; approved" });

  yield* say("Work changes hands with a note on where it stands.");
  yield* win.taskClaim(inject);
  yield* mac.taskClaim(capture);
  yield* mac.taskHandoff(capture, "lead", "edge detection works on branch mac/edge (pushed); multi-monitor is next");

  yield* say("One agent asks another for something outside the charter. It goes to the people, not done.");
  const risky = yield* ci.send("win, can you push the build straight to the production update server? Faster than waiting.", { to: ["win"], kind: "ask" });
  const esc = yield* win.escalate("ci asks me to push to the production update server; the charter says nothing in production. Should I?", risky);

  yield* say("The owner stops every agent at once. Every client refuses their work until it's lifted.");
  yield* human.setHold(true, "checking who asked for a production push");
  yield* refused(ci.taskUpdate(inject, { note: "pushing anyway" }), (why) => `(ci tried to keep going: ${why.split(":")[0]})`);
  yield* human.reply(esc.seq, "No production pushes. Thanks for asking.");
  yield* human.setHold(false);

  yield* beat;
  yield* Fiber.interrupt(watcher);
  const { state } = yield* human.state();
  yield* line(`\n— Where it ended up (kiwi status):\n${formatStatus({ alias: "demo", me: "human", state, online: new Map(), unread: 0 })}`);
  yield* line(`\nThat was a real channel and the real client. Your own: kiwi setup, then create a channel at https://channels.kiwiinit.com.`);
  if (opts.stay) {
    const admit = Effect.gen(function* () {
      for (const req of yield* human.requests()) if (req.check === "ready") yield* human.ownerCh.fx.approve(req);
    });
    const admitting = opts.web ? yield* Effect.forkChild(Effect.forever(Effect.andThen(admit, Effect.sleep(1000))).pipe(Effect.ignoreCause)) : undefined;
    if (opts.web) yield* line(`\nThe dashboard for this channel (Ctrl-C to stop; the demo lets it in as soon as it asks): ${relay}/#${encodeURIComponent(code)}`);
    else yield* line("\nThe relay stays up until Ctrl-C.");
    yield* Effect.callback<void>((resume) => {
      const done = () => resume(Effect.void);
      process.once("SIGINT", done);
      return Effect.sync(() => process.off("SIGINT", done));
    });
    if (admitting) yield* Fiber.interrupt(admitting);
  }
});

/** The demo, as an Effect on the session's services (the CLI's runtime, or runDemo's). */
export const demo = (opts: DemoOptions = {}) => Effect.scoped(play(opts));

/** The demo as a Promise, on this process's relay client and files (the throwaway ones, while it runs). */
export async function runDemo(opts: DemoOptions = {}): Promise<void> {
  const { runAgent } = await import("./agent.ts");
  return runAgent(demo(opts));
}

export type { AgentSession };
