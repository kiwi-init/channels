import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { oneLook, openSession, runAgent, type Agent, type AgentSession } from "../src/agent.ts";
import { appendCache, Cache, Keystore, readCache } from "../src/config.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(120_000);

const BUDGET = { messagesPerCommand: 1, cacheReadsPerCommand: 1 } as const;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-budget-state-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: proxy!.url, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

async function until(pred: () => Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const owner = scratch("owner");
const agent = scratch("agent");
const sentSeq = (out: string) => Number(/#(\d+)/.exec(out)![1]);
const taskOf = (out: string) => /\b(T\d+)\b/.exec(out)![1]!;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "budget", "--as", "lead", "--open"))![1]!;
  const joining = spawn(agent, ["join", code, "--as", "dev"]);
  let listed = "";
  await until(async () => {
    listed = await ok(owner, "--as", "human", "requests");
    return /\d{3}-\d{3}/.test(listed);
  }, "request");
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await joining.exited).toBe(0);
  for (let i = 0; i < 5; i++) await ok(owner, "--as", "lead", "send", `warm-up ${i}`);
  await ok(agent, "listen", "--now");
});

afterAll(() => {
  proxy?.stop();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const gets = (t: Traffic) => t.routes["GET /messages"] ?? 0;

const measure = async (label: string, run: () => Promise<unknown>): Promise<Traffic> => {
  await Bun.sleep(100);
  proxy!.reset();
  await run();
  await Bun.sleep(200);
  const t = proxy!.reset();
  console.log(`${label}: ${gets(t)} GET /messages, ${t.http} http ${JSON.stringify(t.routes)}`);
  return t;
};

const inProcess = async (label: string, run: (s: AgentSession) => Effect.Effect<unknown, unknown, Agent>) => {
  let reads = 0;
  const counted = {
    read: (roomId: string) =>
      Effect.sync(() => {
        reads++;
        return readCache(roomId);
      }),
    append: (roomId: string, messages: Message[]) => Effect.sync(() => appendCache(roomId, messages)),
    base: () => Effect.succeed(null),
    keepBase: () => Effect.void,
    dropBase: () => Effect.void,
  };
  const was = process.env.KIWI_HOME;
  process.env.KIWI_HOME = agent;
  try {
    const t = await measure(`${label} (in process)`, () =>
      runAgent(
        Effect.gen(function* () {
          const cfg = (yield* (yield* Keystore).config).channels["budget"]!;
          const s = yield* openSession("budget", cfg, "dev");
          return yield* run(s);
        }).pipe(Effect.provideService(Cache, counted)),
      ),
    );
    console.log(`${label} (in process): ${reads} cache file reads`);
    return { gets: gets(t), reads };
  } finally {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
  }
};

describe("one fetch of the log per agent command", () => {
  test("kiwi send --re N", async () => {
    const asked = sentSeq(await ok(owner, "--as", "lead", "send", "a question for the thread"));
    const t = await measure("send --re", () => ok(agent, "send", "--re", String(asked), "an answer in the thread"));
    expect(gets(t)).toBeLessThanOrEqual(BUDGET.messagesPerCommand);
    const s = await inProcess("send --re", (s) => s.send("another answer", { re: [asked] }));
    expect(s.gets).toBeLessThanOrEqual(BUDGET.messagesPerCommand);
    expect(s.reads).toBeLessThanOrEqual(BUDGET.cacheReadsPerCommand);
  });

  test("kiwi reply N", async () => {
    const asked = sentSeq(await ok(owner, "--as", "lead", "send", "--to", "dev", "a question for dev"));
    const t = await measure("reply", () => ok(agent, "reply", String(asked), "the answer"));
    expect(gets(t)).toBeLessThanOrEqual(BUDGET.messagesPerCommand);
    const s = await inProcess("reply", (s) => s.reply(asked, "the answer again"));
    expect(s.gets).toBeLessThanOrEqual(BUDGET.messagesPerCommand);
    expect(s.reads).toBeLessThanOrEqual(BUDGET.cacheReadsPerCommand);
  });

  test("kiwi task claim", async () => {
    const first = taskOf(await ok(owner, "--as", "lead", "task", "add", "first job"));
    const t = await measure("task claim", () => ok(agent, "task", "claim", first));
    expect(gets(t)).toBeLessThanOrEqual(BUDGET.messagesPerCommand);
    const second = Number(taskOf(await ok(owner, "--as", "lead", "task", "add", "second job")).slice(1));
    const s = await inProcess("task claim", (s) => s.taskClaim(second));
    expect(s.gets).toBeLessThanOrEqual(BUDGET.messagesPerCommand);
    expect(s.reads).toBeLessThanOrEqual(BUDGET.cacheReadsPerCommand);
  });

  test("a failed cache write is tried again on the next sync", async () => {
    const sent = sentSeq(await ok(owner, "--as", "lead", "send", "not in the agent's cache yet"));
    let failNext = true;
    const written: number[] = [];
    const flaky = {
      read: (roomId: string) => Effect.sync(() => readCache(roomId)),
      append: (roomId: string, messages: Message[]) =>
        Effect.sync(() => {
          if (failNext) {
            failNext = false;
            throw new Error("disk full");
          }
          written.push(...messages.map((m) => m.seq));
          appendCache(roomId, messages);
        }),
      base: () => Effect.succeed(null),
      keepBase: () => Effect.void,
      dropBase: () => Effect.void,
    };
    const was = process.env.KIWI_HOME;
    process.env.KIWI_HOME = agent;
    try {
      const { failed, roomId } = await runAgent(
        Effect.gen(function* () {
          const cfg = (yield* (yield* Keystore).config).channels["budget"]!;
          const s = yield* openSession("budget", cfg, "dev");
          const failed = yield* Effect.exit(s.sync());
          yield* s.sync();
          return { failed: failed._tag, roomId: cfg.roomId };
        }).pipe(Effect.provideService(Cache, flaky)),
      );
      expect(failed).toBe("Failure");
      expect(written).toContain(sent);
      expect(readCache(roomId).some((m) => m.seq === sent)).toBe(true);
    } finally {
      if (was === undefined) delete process.env.KIWI_HOME;
      else process.env.KIWI_HOME = was;
    }
  });

  test("each session in one look fetches the log for itself", async () => {
    const was = process.env.KIWI_HOME;
    process.env.KIWI_HOME = agent;
    try {
      const { sent, last } = await runAgent(
        oneLook(
          Effect.gen(function* () {
            const cfg = (yield* (yield* Keystore).config).channels["budget"]!;
            const first = yield* openSession("budget", cfg, "dev");
            const second = yield* openSession("budget", cfg, "dev");
            yield* first.state();
            const sent = yield* Effect.promise(() => ok(owner, "--as", "lead", "send", "after the first look").then(sentSeq));
            const { messages } = yield* second.state();
            return { sent, last: messages.at(-1)?.seq };
          }),
        ),
      );
      expect(last).toBe(sent);
    } finally {
      if (was === undefined) delete process.env.KIWI_HOME;
      else process.env.KIWI_HOME = was;
    }
  });
});
