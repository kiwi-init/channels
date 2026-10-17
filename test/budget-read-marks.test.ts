import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { AgentLive } from "../src/agent.ts";
import { Channel } from "@kiwi/core/client.ts";
import { loadConfig, loadIdentity } from "../src/config.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { sum, trafficProxy } from "./traffic.ts";

setDefaultTimeout(180_000);

const AGENTS = 4;
const MESSAGES = 3;
const BUDGET = { readFramesPerMessage: AGENTS * 2 } as const;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-budget-reads-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const owner = scratch("owner");
const agents = Array.from({ length: AGENTS }, (_, i) => ({ name: `dev${i + 1}`, home: scratch(`agent${i + 1}`) }));
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;
let roomId = "";
const listeners: ReturnType<typeof Bun.spawn>[] = [];
let stopViewer: () => void = () => {};
let viewerMarks = 0;

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: proxy!.url, KIWI_NO_HOOKS: "1", KIWI_MODEL: "test-model" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
  return out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

function marks(): Map<string, number> {
  const db = new Database(join(dataDir, `${roomId}.sqlite`), { readonly: true });
  try {
    return new Map((db.query("SELECT pk, seq FROM reads").all() as { pk: string; seq: number }[]).map((r) => [r.pk, r.seq]));
  } finally {
    db.close();
  }
}

function withHome<T>(home: string, f: () => T): T {
  const was = process.env.KIWI_HOME;
  process.env.KIWI_HOME = home;
  try {
    return f();
  } finally {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
  }
}

function ownerChannel(): Promise<Channel> {
  return withHome(owner, () => {
    const cfg = loadConfig();
    const access = Object.values(cfg.channels).find((c) => c.roomId === roomId)!;
    return loadIdentity("human", roomId).then((id) => new Channel(access, proxy!.url, id));
  });
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  const before = new Set(readdirSync(dataDir));
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "reads", "--as", "lead", "--open"))![1]!;
  roomId = readdirSync(dataDir).find((f) => !before.has(f) && /^[0-9a-f]{32}\.sqlite$/.test(f))!.slice(0, 32);
  for (const a of agents) {
    const joining = spawn(a.home, ["join", code, "--as", a.name]);
    let listed = "";
    await until(async () => /\d{3}-\d{3}/.test((listed = await ok(owner, "--as", "human", "requests"))), `${a.name}'s request`);
    await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
    expect(await joining.exited).toBe(0);
    await ok(a.home, "listen", "--now");
  }
  const viewer = await ownerChannel();
  const head = await viewer.head();
  const fiber = Effect.runFork(
    Stream.runForEach(viewer.fx.live(head, { presence: false }), (ev) => Effect.sync(() => void (ev._tag === "Read" && !ev.snapshot && (viewerMarks += ev.reads.length)))).pipe(
      Effect.provide(AgentLive),
    ) as Effect.Effect<void>,
  );
  stopViewer = () => void Effect.runFork(Fiber.interrupt(fiber));
  for (const a of agents) listeners.push(spawn(a.home, ["listen"]));
  await Bun.sleep(3_000);
});

afterAll(async () => {
  stopViewer();
  for (const l of listeners) l.kill();
  for (const home of [owner, ...agents.map((a) => a.home)]) await stopDaemon(daemonSock(home)).catch(() => {});
  proxy?.stop();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("read marks in a channel of agents listening live", () => {
  test("a read mark reaches the sockets that show reads, not every listener", async () => {
    proxy!.reset();
    viewerMarks = 0;
    let last = 0;
    for (let i = 0; i < MESSAGES; i++) {
      last = Number(/#(\d+)/.exec(await ok(owner, "--as", "lead", "send", "--to", "all", `round ${i}`))![1]);
      await Bun.sleep(1_300);
    }
    const ids = await Promise.all(agents.map((a) => withHome(a.home, () => loadIdentity(a.name, roomId))));
    await until(() => ids.every((id) => (marks().get(id.pk) ?? 0) >= last), "every agent's mark");
    await until(() => viewerMarks >= AGENTS, "the marks at the viewer");
    await Bun.sleep(1_500);
    const t = proxy!.reset();
    const down = t.framesDown.read ?? 0;
    const up = t.framesUp.read ?? 0;
    console.log(
      `read marks: ${AGENTS} agents + 1 viewer, ${MESSAGES} messages to all: ${up} marks up, ${down} read frames down (${(down / MESSAGES).toFixed(1)} per message), ${t.sockets} sockets, ${sum(t.framesDown)} frames down, ${t.bytesDown} B down`,
    );
    expect(viewerMarks).toBeGreaterThanOrEqual(AGENTS);
    expect(down / MESSAGES).toBeLessThanOrEqual(BUDGET.readFramesPerMessage);
  });
});
