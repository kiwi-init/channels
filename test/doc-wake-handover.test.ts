import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { daemonListeners, daemonListening, daemonSock } from "../src/daemon.ts";
import { hooksFixture } from "./hooks-fixture.ts";
import { addDocWake, docWakeTold, pendingDocWakes } from "../src/config/doc-wakes.ts";
import { loadConfig } from "../src/config.ts";
import { notePending, settlePending } from "../src/hooks/delivered.ts";

setDefaultTimeout(90_000);

const fixture = hooksFixture({ prefix: "kiwi-dochand", sessionId: "dochand", channel: "dochand", transport: { kind: "direct" } });
const { agent, ok, until, spawn, env: S, input: INPUT } = fixture;
let me = "";

const listening = () =>
  daemonListeners(daemonSock(agent))
    .then((ls) => ls.some((l) => l.kind === "hook" && l.agent === me))
    .catch(() => false);

beforeAll(async () => {
  await fixture.start();
  me = fixture.me;
  await until(async () => (await daemonListening(daemonSock(agent)).catch(() => [])).some((s) => s.agent === me), "the daemon holding the seat");
});

afterAll(() => fixture.dispose());

const inAgent = <T>(f: () => T): T => {
  const was = process.env.KIWI_HOME;
  process.env.KIWI_HOME = agent;
  try {
    return f();
  } finally {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
  }
};

const wake = (block: string, text: string) => ({ key: "main", th: "t".repeat(22), block, author: "boss", text, context: "", selection: null, at: Date.now() });

test("a doc wake the listen hook pulled, then died holding, still reaches the next read (T669)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("b".repeat(22), `@${me} does the doc wake survive?`)));
  mkdirSync(join(agent, "hook-state"), { recursive: true });
  writeFileSync(join(agent, "hook-state", `dochand.${process.pid}.answering`), String(process.pid));
  const listener = spawn(agent, ["hook", "listen"], S, INPUT);
  await until(listening, "the listener's slot");
  await Bun.sleep(2_500);
  listener.kill(9);
  await listener.exited;
  rmSync(join(agent, "hook-state", `dochand.${process.pid}.answering`), { force: true });
  expect(inAgent(() => pendingDocWakes(alias, me)).map((w) => w.block)).toEqual(["b".repeat(22)]);
  expect(await ok(agent, ["listen", "--now"], S)).toContain("does the doc wake survive?");
  expect(inAgent(() => pendingDocWakes(alias, me))).toEqual([]);
});

test("a doc wake the listen hook hands over is told once, and the next read doesn't show it again (T669)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("c".repeat(22), `@${me} handed once`)));
  const listener = spawn(agent, ["hook", "listen"], S, INPUT);
  expect(await listener.exited).toBe(2);
  expect(await new Response(listener.stderr).text()).toContain("handed once");
  expect(inAgent(() => pendingDocWakes(alias, me))).toEqual([]);
});

test("an acked hand-over tells its doc wakes when the host says it landed, and not before (T669)", () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  const block = "d".repeat(22);
  inAgent(() => {
    addDocWake(alias, me, wake(block, "acked"));
    notePending(alias, me, "acked", "tok-1", 0, [block]);
    expect(settlePending(alias, me, "acked", "tok-2")).toBeNull();
    expect(pendingDocWakes(alias, me).map((w) => w.block)).toEqual([block]);
    expect(settlePending(alias, me, "acked", "tok-1")).toBe(0);
    expect(pendingDocWakes(alias, me)).toEqual([]);
  });
});

const NOHARNESS: Record<string, string> = { CLAUDECODE: "", CLAUDE_CODE_SESSION_ID: "", CLAUDE_PID: "", AI_AGENT: "", CODEX_THREAD_ID: "", CURSOR_AGENT: "" };

test("kiwi listen --once hands over a doc-only line and tells it (T1741)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("e".repeat(22), `@${me} only in the doc`)));
  const out = await ok(agent, ["listen", "--once", "--timeout", "5s"], NOHARNESS);
  expect(out).toContain("only in the doc");
  expect(inAgent(() => pendingDocWakes(alias, me))).toEqual([]);
});

test("kiwi listen --once hands over a doc-only line that lands while it waits (T1741)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  const p = spawn(agent, ["listen", "--once", "--timeout", "10s"], NOHARNESS);
  await Bun.sleep(1_500);
  inAgent(() => addDocWake(alias, me, wake("f".repeat(22), `@${me} arrived mid-wait`)));
  expect(await p.exited).toBe(0);
  expect(await new Response(p.stdout).text()).toContain("arrived mid-wait");
});

test("kiwi listen streams doc-only lines (T1741)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("g".repeat(22), `@${me} streamed from the doc`)));
  const p = spawn(agent, ["listen"], NOHARNESS);
  let out = "";
  const reading = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of p.stdout) out += decoder.decode(chunk, { stream: true });
  })();
  try {
    await until(async () => out.includes("streamed from the doc"), "tail printing the first line");
    inAgent(() => addDocWake(alias, me, wake("h".repeat(22), `@${me} and a second one`)));
    await until(async () => out.includes("and a second one"), "tail printing the second line");
    await until(async () => inAgent(() => pendingDocWakes(alias, me)).length === 0, "tail telling both lines");
  } finally {
    p.kill();
    await p.exited;
    await reading;
  }
});

const quietWake = (task: number, since: number) => ({
  key: `task:${task}`,
  th: "",
  block: `clock:T${task}:${since}`,
  author: "kiwi",
  text: `T${task} has been quiet 41m and it's your move`,
  context: "",
  selection: null,
  at: Date.now(),
  clock: { task, mover: me, since },
});

test("a quiet task's wake is handed over by kiwi listen and by the stop hook as its own line, and told once shown (T4171)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, quietWake(900_001, 7)));
  const out = await ok(agent, ["listen", "--once", "--timeout", "5s"], NOHARNESS);
  expect(out).toContain("T900001 has been quiet 41m and it's your move.");
  expect(out).toContain("task show T900001");
  expect(out).not.toContain("shared doc");
  expect(inAgent(() => docWakeTold(alias, me, "clock:T900001:7"))).toBe(true);
  inAgent(() => addDocWake(alias, me, quietWake(900_002, 9)));
  const stop = JSON.parse(await ok(agent, ["hook", "stop"], S, JSON.stringify({ session_id: "dochand", cwd: agent, hook_event_name: "Stop" }))) as { reason: string };
  expect(stop.reason).toContain("T900002 has been quiet 41m and it's your move.");
  expect(stop.reason).not.toContain("shared doc");
  expect(inAgent(() => docWakeTold(alias, me, "clock:T900002:9"))).toBe(true);
});

test("hooks with only doc lines say where to answer, not reply N (T1741)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("i".repeat(22), `@${me} a stop-hook line`)));
  const stop = JSON.parse(await ok(agent, ["hook", "stop"], S, JSON.stringify({ session_id: "dochand", cwd: agent, hook_event_name: "Stop" }))) as { reason: string };
  expect(stop.reason).toContain("a stop-hook line");
  expect(stop.reason).toContain("shared doc");
  expect(stop.reason).not.toContain("reply N");
  inAgent(() => addDocWake(alias, me, wake("j".repeat(22), `@${me} a listen-hook line`)));
  const listener = spawn(agent, ["hook", "listen"], S, INPUT);
  expect(await listener.exited).toBe(2);
  const told = await new Response(listener.stderr).text();
  expect(told).toContain("a listen-hook line");
  expect(told).not.toContain("reply N");
});
