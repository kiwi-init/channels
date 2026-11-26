import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as Effect from "effect/Effect";
import { RelayError } from "@kiwi/core/client.ts";
import { chooseThread } from "@kiwi/core/state.ts";
import { AgentSession, oneLook, runAgent } from "../src/agent.ts";

export const PERF_BASE_SMALL = { tasks: 100, messages: 2000, taskNotes: 0 };
export const PERF_BASE_LARGE = { tasks: 600, messages: 4000, taskNotes: 7 };

export const TEXTS = [
  "Numbers are in:\n\n- p50 0.3ms, p95 1ms\n- no refusals in 800 rooms\n\nThe change is in `src/relay/route.ts`:\n\n```ts\nconst program = answer(dispatch(routes, guards, otherwise))\n```",
  "On it. I'll have win run the steady load first, then the cold runs.",
  "Merged #398. The rails are darker and the page is a round sheet beside them, in light and dark.",
  "| step | before | after |\n|---|---|---|\n| first paint | 420ms | 180ms |\n| switch | 270ms | 26ms |",
  "PR is up: https://github.com/kiwi-init/channels/pull/417 — CI green, waiting on review.",
];

export const SEEDED = "Seeded: a reload opens the channel here";
export const SPEC = "# Ship it at scale\n\n## Done when\n- [ ] the board holds every task";
export const ASKED = "Scale it: ten agents and a hundred tasks";
export const noteText = (task: number, k: number): string =>
  `Checkpoint ${k + 1} for task ${task}.\n\n${Array.from({ length: 6 }, (_, i) => TEXTS[(task + k + i) % TEXTS.length]).join("\n\n")}`.slice(0, 1536);

const ROOT = resolve(import.meta.dir, "..");
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Cli {
  home: string;
  kiwi(argv: string[]): Promise<string>;
  as(agent: string, argv: string[]): Promise<string>;
  stop(): void;
}

export function cliIn(dir: string, channel: string): Cli {
  const home = join(dir, "home");
  mkdirSync(join(dir, "bin"), { recursive: true });
  for (const opener of ["open", "xdg-open"]) {
    writeFileSync(join(dir, "bin", opener), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "bin", opener), 0o755);
  }
  const running: ChildProcess[] = [];
  const kiwi = (argv: string[]): Promise<string> => {
    const env = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: home, CLAUDE_CONFIG_DIR: join(dir, "no-claude"), PATH: `${join(dir, "bin")}:${process.env.PATH}` };
    const p = spawn("bun", ["src/cli/main.ts", ...argv], { cwd: ROOT, env });
    running.push(p);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    return new Promise((ok, fail) =>
      p.on("exit", (code) => {
        running.splice(running.indexOf(p), 1);
        if (code === 0) ok(out);
        else fail(new Error(`kiwi ${argv.join(" ")} exited ${code}: ${out.trim().split("\n").pop()}`));
      }),
    );
  };
  const as = async (agent: string, argv: string[]): Promise<string> => {
    for (;;) {
      try {
        return await kiwi(["-c", channel, "--as", agent, ...argv]);
      } catch (e) {
        if (!String(e).includes("too many")) throw e;
        await later(5000);
      }
    }
  };
  return { home, kiwi, as, stop: () => running.forEach((p) => p.kill()) };
}

export async function patiently<A>(attempt: () => Promise<A>): Promise<A> {
  for (;;) {
    try {
      return await attempt();
    } catch (e) {
      if (!(e instanceof RelayError && e.status === 429)) throw e;
      await later((e.retryAfter ?? 1) * 1000);
    }
  }
}

export const say = (s: AgentSession, body: string, task?: number) =>
  patiently(() =>
    runAgent(
      oneLook(
        Effect.gen(function* () {
          const { state } = yield* s.state();
          const chosen = chooseThread(state, s.me, task === undefined ? {} : { task });
          if (typeof chosen === "string") return yield* Effect.fail(new Error(chosen));
          return yield* s.send(body, { kind: "msg", ...(chosen.to ? { to: chosen.to } : {}), ...(chosen.task !== undefined ? { task: chosen.task } : {}) });
        }),
      ),
    ),
  );

export interface Human {
  ask(text: string): Promise<void>;
  approveSpec(): Promise<void>;
}

export interface SeedPlan {
  messages: number;
  tasks: number;
  taskNotes: number;
  tasksFirst?: boolean;
  sent?: (count: number) => Promise<void> | void;
  tasksAdded?: (count: number) => Promise<void> | void;
}

export async function seedChannel(seats: AgentSession[], human: Human, plan: SeedPlan): Promise<{ tasks: number[]; seededSeq: number }> {
  const perSender = Math.ceil(plan.messages / seats.length);
  const early = plan.tasksFirst ? 0 : Math.floor(perSender * 0.7);
  let sent = 0;
  const tasks: number[] = [];
  const post = (from: number, to: number) =>
    Promise.all(
      seats.map(async (s, a) => {
        for (let i = from; i < to; i++) {
          const n = a * perSender + i;
          if (n >= plan.messages) return;
          await say(s, `M${n}: ${TEXTS[n % TEXTS.length]}`, n % 4 === 0 && tasks.length ? tasks[n % tasks.length] : undefined);
          sent++;
          await plan.sent?.(sent);
        }
      }),
    );
  await post(0, early);
  await human.ask(ASKED);
  let ask = 0;
  while (!ask) {
    const { messages } = await patiently(() => runAgent(seats[0]!.state()));
    ask = messages.find((m) => m.body === ASKED)?.seq ?? 0;
    if (!ask) await later(300);
  }
  await patiently(() => runAgent(seats[0]!.writeSpec(ask, SPEC)));
  await patiently(() => runAgent(seats[0]!.readySpec(ask)));
  await human.approveSpec();
  const perAgent = Math.ceil(plan.tasks / seats.length);
  await Promise.all(
    seats.map(async (s, a) => {
      for (let i = 0; i < perAgent && a * perAgent + i < plan.tasks; i++) {
        const n = a * perAgent + i;
        const title = `Task ${n}: ${["speed up the switch", "fix the relay retry", "polish the sidebar", "write the stable criteria"][n % 4]} (${s.me})`;
        const id = await patiently(() => runAgent(s.taskAdd(title, { owner: s.me, re: ask })));
        tasks.push(id);
        for (let k = 0; k < plan.taskNotes; k++) await patiently(() => runAgent(s.taskUpdate(id, { note: noteText(n, k) })));
        if (n % 3 === 1) await patiently(() => runAgent(s.taskUpdate(id, { state: "doing" })));
        if (n % 3 === 2) await patiently(() => runAgent(s.taskUpdate(id, { state: "done" })));
      }
    }),
  );
  await plan.tasksAdded?.(tasks.length);
  await post(early, perSender);
  const seeder = seats[0]!;
  const seededSeq = await patiently(() =>
    runAgent(
      oneLook(
        Effect.gen(function* () {
          const { state } = yield* seeder.state();
          const owner = [...state.members.values()].find((m) => m.owner)?.name;
          return yield* seeder.send(SEEDED, { kind: "msg", ...(owner ? { to: [owner] } : {}) });
        }),
      ),
    ),
  );
  return { tasks, seededSeq };
}
