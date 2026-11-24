import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { parseDuration } from "@kiwi/core/format.ts";
import { openSession } from "../../agent.ts";
import { loadConfig, type SeatRecord } from "../../config.ts";
import { pathOf } from "../../daemon/wake.ts";
import { selfArgv } from "../../hooks/self.ts";
import { claudeSession, claudeTranscript, claudeTranscriptAt } from "../../loop/claude.ts";
import { descendantsOf } from "../../loop/kimi.ts";
import { recipeFor } from "../../loop/recipes.ts";
import { processes } from "../../loop/tmux.ts";
import { loginPath, loginShell } from "../../login-shell.ts";
import { bootId, pidAlive } from "../../pid.ts";
import { outcomeJson, outcomeLine, upAll } from "../../up/all.ts";
import { printedLine, tmuxLauncher } from "../../up/launch.ts";
import { sessionLiveness } from "../../up/liveness.ts";
import { planJson, planUp, runningAtShutdown, usedSince, withMembers, type Chooser, type Membership, type SeatPlan } from "../../up/plan.ts";
import { beforeThisBoot, readRunning } from "../../up/running.ts";
import { forgetLaunch, forgetReport, isReportId, launchSeen, readReport, writeReport } from "../../up/ready.ts";
import { restoreSeat, type RestoreDeps } from "../../up/restore.ts";
import { abandonReserved, keyOf, newSeatToken, reserveSeat } from "../../hold.ts";
import { randomBytes } from "node:crypto";
import { args, opt } from "../args.ts";
import { type Command, die, keepDaemon, out } from "../context.ts";

const USAGE = "usage: kiwi up [--dry-run] [--json] [--since 7d] [--bind-timeout SECONDS] · kiwi up --seat HANDLE [-c CHANNEL] [--bind-timeout SECONDS]";
const BIND_MS = 60_000;
const SETTLE_MS = 15_000;
const READY_MS = 15_000;
const STOP_GRACE_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function stopTree(pid: number): Promise<void> {
  const tree = [pid, ...descendantsOf(pid, processes()).map((p) => p.pid)];
  const signal = (sig: NodeJS.Signals) => {
    for (const p of tree) {
      try {
        process.kill(p, sig);
      } catch {
        // Gone already (ESRCH), or not ours to signal: nothing left to stop there.
      }
    }
  };
  signal("SIGTERM");
  const late = Date.now() + STOP_GRACE_MS;
  while (tree.some(pidAlive) && Date.now() < late) await sleep(100);
  signal("SIGKILL");
}

function seatChannel(handle: string): string | null {
  const given = opt.channel ?? process.env.KIWI_CHANNEL;
  if (given) return given;
  const cfg = loadConfig();
  const aliases = new Set(
    Object.values(cfg.bindings ?? {})
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .filter((b) => b.as === handle && cfg.channels[b.alias])
      .map((b) => b.alias),
  );
  const [only, ...more] = aliases;
  return only && !more.length ? only : null;
}

const bindTimeout = Effect.suspend(() => {
  const raw = opt["bind-timeout"];
  if (raw === undefined) return Effect.succeed(BIND_MS);
  const seconds = Number(raw);
  return Number.isInteger(seconds) && seconds > 0 && seconds <= 3600 ? Effect.succeed(seconds * 1000) : die(`--bind-timeout takes whole seconds, 1 to 3600; ${USAGE}`);
});

type Members = Map<string, boolean> | string;

const readMembers = (alias: string, handles: readonly string[]) =>
  Effect.gen(function* () {
    const ch = loadConfig().channels[alias];
    if (!ch) return `${alias} isn't a channel on this computer`;
    let why = "no agent here could read it";
    for (const as of handles) {
      const read = yield* openSession(alias, ch, as).pipe(
        Effect.flatMap((s) => s.state()),
        Effect.map(({ state }): Members => new Map([...state.members.values()].map((m) => [m.name, m.active]))),
        Effect.catchCause((cause) => Effect.succeed((Cause.pretty(cause).split("\n")[0] ?? "the channel couldn't be read").replace(/^Error: /, ""))),
      );
      if (typeof read !== "string") return read;
      why = read;
    }
    return why;
  });

const membership = (plans: readonly SeatPlan[]) =>
  Effect.gen(function* () {
    const asked = new Map<string, string[]>();
    const order = [...plans.filter((p) => p.kind === "running"), ...plans.filter((p) => p.kind !== "running")];
    for (const p of order) asked.set(p.alias, [...(asked.get(p.alias) ?? []), p.as]);
    const wanted = new Set(plans.filter((p) => p.kind === "restore" || p.kind === "loop" || p.kind === "idle" || p.kind === "unsupported").map((p) => p.alias));
    const found = new Map<string, Members>();
    for (const [alias, handles] of asked) if (wanted.has(alias)) found.set(alias, yield* readMembers(alias, handles));
    return (alias: string, as: string): Membership => {
      const m = found.get(alias);
      if (m === undefined) return { kind: "unverified", why: `${alias}'s members weren't read` };
      if (typeof m === "string") return { kind: "unverified", why: m };
      return m.get(as) ? { kind: "member" } : { kind: "left" };
    };
  });

const lastUsed = (b: SeatRecord): number => Math.max(b.at ?? 0, b.seen ?? 0, (b.harness === "claude" && b.session ? claudeTranscriptAt(b.session) : null) ?? 0);

function chooser(since: string | undefined): Chooser | string {
  if (since !== undefined) {
    try {
      return usedSince(Date.now() - parseDuration(since) * 1000, lastUsed);
    } catch (err) {
      return `${err instanceof Error ? err.message : String(err)}; ${USAGE}`;
    }
  }
  return runningAtShutdown(ranBefore());
}

function ranBefore(): readonly { alias: string; as: string }[] | null {
  const boot = bootId();
  return boot === null ? null : (beforeThisBoot(readRunning(), boot)?.seats ?? null);
}

const failed = (report: string | null, why: string) =>
  Effect.suspend(() => {
    if (report) writeReport(report, { result: "failed", why });
    return die(why);
  });

const oneSeat = (handle: string, bindMs: number, report: string | null) =>
  Effect.gen(function* () {
    const alias = seatChannel(handle);
    if (!alias) return yield* failed(report, `${handle} has a seat in several channels, or none, on this computer: pass -c CHANNEL`);
    const member = (yield* membership(planUp(loadConfig(), (b) => sessionLiveness(b)).filter((p) => p.alias === alias)))(alias, handle);
    if (member.kind === "left") return yield* failed(report, `${handle} left ${alias} or was removed: kiwi up starts only current members`);
    if (member.kind === "unverified") return yield* failed(report, `${handle}'s membership in ${alias} couldn't be checked, so nothing started: ${member.why}`);
    const recipe = recipeFor("claude");
    const bin = Bun.which(recipe.program, { PATH: process.env.PATH ?? "" }) ?? Bun.which(recipe.program, { PATH: yield* Effect.promise(() => loginPath()) });
    if (!bin) return yield* failed(report, `${recipe.program} isn't on your login shell's PATH`);
    const wrote = recipe.hooks();
    if (wrote) process.stderr.write(`kiwi up: installed ${recipe.label}'s Kiwi hooks: ${wrote}\n`);
    yield* keepDaemon;
    const stop = { asked: false };
    const asked = () => void (stop.asked = true);
    process.on("SIGTERM", asked);
    process.on("SIGHUP", asked);
    process.on("SIGINT", asked);
    const deps: RestoreDeps = {
      shell: loginShell(),
      bin,
      spawn: (argv, cwd, env) => {
        const child = Bun.spawn(argv, { cwd, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
        return { pid: child.pid, exited: child.exited };
      },
      started: (pid) => claudeSession(pid)?.sessionId ?? null,
      seen: (token, a, as) => launchSeen(keyOf(token), a, as),
      forget: (token) => forgetLaunch(keyOf(token)),
      transcript: (session) => claudeTranscript(session),
      stop: stopTree,
      wake: async (a, as) => {
        const path = await pathOf(loadConfig(), a, as);
        return path.kind === "none" ? path.why : null;
      },
      live: (b) => sessionLiveness(b),
      sleep,
      now: () => Date.now(),
      aborted: () => stop.asked,
    };
    const restored = yield* Effect.promise(() => restoreSeat(alias, handle, bindMs, deps));
    if (report)
      writeReport(
        report,
        restored.kind === "restored" ? { result: "restored", why: restored.resumed ? "it resumed its session" : "a fresh session took the seat" } : { result: restored.kind, why: restored.why },
      );
    switch (restored.kind) {
      case "running":
        out(`${handle} in ${alias}: ${restored.why}; nothing started`);
        return 0;
      case "failed":
        return yield* die(`${handle} in ${alias} didn't come back: ${restored.why}`);
      case "restored": {
        process.stderr.write(`kiwi up: ${handle} in ${alias} is back in ${restored.dir}, ${restored.resumed ? "resuming" : "in a fresh"} session ${restored.session}\n`);
        process.removeListener("SIGINT", asked);
        process.on("SIGINT", () => {});
        return yield* Effect.promise(() => restored.exited);
      }
    }
  });

const everySeat = (bindMs: number) =>
  Effect.gen(function* () {
    const choose = chooser(opt.since);
    if (typeof choose === "string") return yield* die(choose);
    const planned = planUp(loadConfig(), (b) => sessionLiveness(b), choose);
    if (!planned.length) return out(opt.json ? JSON.stringify({ seats: [] }) : "no seats on this computer");
    const plans = withMembers(planned, yield* membership(planned));
    if (opt["dry-run"] && opt.json) {
      const ran = new Set((ranBefore() ?? []).map((s) => `${s.alias}\u0000${s.as}`));
      return out(JSON.stringify({ seats: plans.map((p) => planJson(p, ran.has(`${p.alias}\u0000${p.as}`))) }));
    }
    if (opt["dry-run"]) {
      for (const p of plans)
        out(
          p.kind === "restore" || p.kind === "loop"
            ? `start    ${p.as} in ${p.alias} (${p.dir}): ${printedLine(p)}`
            : `${p.kind === "running" ? "running " : "skip    "} ${p.as} in ${p.alias} (${p.dir}): ${p.kind === "idle" ? `${p.why}; to bring it back: ${printedLine(p.start)}` : p.why}`,
        );
      return;
    }
    const tmux = Bun.which(process.env.KIWI_TMUX || "tmux");
    const launcher = tmux ? tmuxLauncher(tmux) : null;
    if (!launcher && !opt.json && plans.some((p) => p.kind === "restore" || p.kind === "loop")) out("tmux isn't installed: run each line below in its own terminal");
    const outcomes = yield* Effect.promise(() =>
      upAll(plans, launcher, selfArgv(), bindMs / 1000, bindMs + READY_MS + SETTLE_MS, {
        load: loadConfig,
        sleep,
        now: () => Date.now(),
        newId: () => randomBytes(12).toString("hex"),
        report: readReport,
        forget: forgetReport,
        token: newSeatToken,
        keyOf,
        reserve: (p, token) => reserveSeat(p.alias, p.as, token, (b) => sessionLiveness(b)),
        abandon: (p, token) => void abandonReserved(p.alias, p.as, token),
      }),
    );
    if (opt.json) out(JSON.stringify({ seats: outcomes.map(outcomeJson) }));
    else for (const o of outcomes) out(outcomeLine(o));
    return outcomes.some((o) => o.result === "failed") ? 1 : 0;
  });

export const upCommands: Record<string, Command> = {
  up: () =>
    Effect.gen(function* () {
      if (args[1] !== undefined) return yield* die(USAGE);
      const bindMs = yield* bindTimeout;
      if (opt.seat !== undefined) {
        if (opt["dry-run"]) return yield* die(`--dry-run plans every seat; drop --seat. ${USAGE}`);
        const report = opt.report ?? null;
        if (report !== null && !isReportId(report)) return yield* die(USAGE);
        return yield* oneSeat(opt.seat, bindMs, report);
      }
      return yield* everySeat(bindMs);
    }),
};
