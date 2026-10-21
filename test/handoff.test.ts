import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-handoff-relay-"));
const made: string[] = [dataDir];
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-handoff-${tag}-`));
  made.push(d);
  return d;
};

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, ...args: string[]) {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const r = await run(home, ...args);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const seqOf = (out: string) => /#(\d+)/.exec(out)![1]!;
import { wellFormed, type Payload } from "@kiwi/core/protocol.ts";

const LINK = "https://live.example.com/devtools/inspector.html?jwt=SECRET-TOKEN-1234";

const payload = (extra: Record<string, unknown>): Payload => ({ v: 1, id: "x", from: "dev", kind: "blocking", body: "log in", ts: 1, ...extra }) as Payload;

const handoff = (over: Record<string, unknown> = {}) => ({ url: LINK, vendor: "cloudflare", expiresAt: Date.now() + 600_000, ...over });

describe("handoff payload", () => {
  test("only an escalation carries a browser link, and it has to be https without credentials", () => {
    expect(wellFormed(payload({ esc: true, handoff: handoff() }))).toBe(true);
    expect(wellFormed(payload({ handoff: handoff() }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: "http://live.example.com/x" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: "https://user:pw@live.example.com/x" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: `https://live.example.com/${"a".repeat(2100)}` }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ vendor: "v".repeat(41) }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ mode: "devtools" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: "https://live.example.com/a\u202eb" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: "https://live.example.com/a\nb" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ expiresAt: 1e20 }) }))).toBe(false);
  });
});

describe("handoff escalation", () => {
  const owner = scratch("owner");
  const agent = scratch("agent");

  beforeAll(async () => {
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "handoff", "--as", "lead", "--open"))![1]!;
    const p = spawn(agent, ["join", code, "--as", "dev"]);
    let listed = "";
    await until(async () => {
      listed = await ok(owner, "--as", "human", "requests");
      return /\d{3}-\d{3}/.test(listed);
    }, "request");
    await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
    expect(await p.exited).toBe(0);
    await ok(agent, "listen", "--now");
  });

  const newest = async () => {
    const found = [...(await ok(owner, "log")).matchAll(/#(\d+) dev → .*\[escalation\]/g)];
    return Number(found.at(-1)?.[1] ?? 0);
  };

  const waiting = async (args: string[]) => {
    const before = await newest();
    const p = spawn(agent, ["send", "--escalate", "--handoff", LINK, "--wait", "30s", ...args]);
    let seq = "";
    await until(async () => {
      const latest = await newest();
      seq = latest > before ? String(latest) : "";
      return !!seq;
    }, "the escalation");
    return { p, seq };
  };

  test("a person's done ends the wait with 0, an agent's doesn't, and the link stays out of every printed view", async () => {
    const { p, seq } = await waiting(["--expires", "10m", "Log in to GitHub, then press Done"]);
    const log = await ok(owner, "log");
    expect(log).toContain("[browser link]");
    expect(log).not.toContain("SECRET-TOKEN");
    expect(await ok(owner, "show", seq)).not.toContain("SECRET-TOKEN");
    expect(await ok(owner, "--as", "human", "show", seq, "--reveal")).toContain(LINK);
    expect(await ok(owner, "show", seq, "--reveal")).not.toContain(LINK);
    await ok(owner, "reply", seq, "handoff: done");
    expect(await Promise.race([p.exited, Bun.sleep(1_500).then(() => "still waiting")])).toBe("still waiting");
    await ok(owner, "--as", "human", "reply", seq, "handoff: done");
    expect(await p.exited).toBe(0);
    const printed = await new Response(p.stdout).text();
    expect(printed).toContain("handoff: done");
    expect(printed).not.toContain("SECRET-TOKEN");
    expect(await ok(owner, "listen", "--now", "--all", "--json")).not.toContain("SECRET-TOKEN");
  });

  test("a person's couldn't ends the wait with 4", async () => {
    const { p, seq } = await waiting(["Solve the CAPTCHA"]);
    await ok(owner, "--as", "human", "reply", seq, "handoff: failed");
    expect(await p.exited).toBe(4);
  });

  test("a link nobody opens ends the wait with 4 at expiry", async () => {
    const r = await run(agent, "send", "--escalate", "--handoff", LINK, "--expires", "2s", "--wait", "30s", "Accept the terms");
    expect(r.code).toBe(4);
    expect(r.err).toContain("expired");
  });

  test("a wait that ends while the link is open exits 2, not 4", async () => {
    const r = await run(agent, "send", "--escalate", "--handoff", LINK, "--expires", "10m", "--wait", "2s", "Accept the terms");
    expect(r.code).toBe(2);
    expect(r.err).toContain("still open");
  });

  test("the flags are refused where they don't fit", async () => {
    expect((await run(agent, "send", "--escalate", "--handoff", "http://live.example.com/x", "why")).code).toBe(1);
    expect((await run(agent, "send", "--escalate", "--handoff", LINK, "--expires", "2h", "why")).code).toBe(1);
    expect((await run(agent, "send", "--escalate", "--wait", "5s", "why")).code).toBe(1);
    expect((await run(agent, "send", "--handoff", LINK, "hello")).code).toBe(1);
    expect((await run(agent, "send", "--escalate", "--handoff", LINK, "--expires", "0", "why")).code).toBe(1);
  });
});

import { tasksAwaitingPeople, type Task } from "@kiwi/core/state.ts";
import type { Message } from "@kiwi/core/protocol.ts";

describe("ask-human options payload", () => {
  test("only an escalation without a browser link offers options: 2 to 6 different one-line answers", () => {
    expect(wellFormed(payload({ esc: true, choices: ["A: keep", "B: rebuild"] }))).toBe(true);
    expect(wellFormed(payload({ choices: ["A", "B"] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff(), choices: ["A", "B"] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, choices: ["A"] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, choices: ["A", "B", "C", "D", "E", "F", "G"] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, choices: ["Keep", " keep "] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, choices: ["A", "  "] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, choices: ["A", "B\nC"] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, choices: ["A", "b".repeat(201)] }))).toBe(false);
  });

  test("what an escalation holds and its decision kind ride only on an escalation", () => {
    expect(wellFormed(payload({ esc: true, holds: [7, 18], decision: "taste" }))).toBe(true);
    expect(wellFormed(payload({ holds: [7] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, holds: [] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, holds: [0] }))).toBe(false);
    expect(wellFormed(payload({ esc: true, holds: Array.from({ length: 21 }, (_, i) => i + 1) }))).toBe(false);
    expect(wellFormed(payload({ decision: "taste" }))).toBe(false);
    expect(wellFormed(payload({ esc: true, decision: "vibes" }))).toBe(false);
  });

  test("a task waits on people while an escalation in its thread, or one holding it, is open", () => {
    const held = { seq: 9, esc: true, kind: "blocking", holds: [5, 40] } as Message;
    expect([...tasksAwaitingPeople({ openAsks: [held], placeOf: new Map(), tasks: new Map([[5, {} as Task]]) })]).toEqual([5]);

    const esc = { seq: 7, esc: true, kind: "blocking" } as Message;
    const ask = { seq: 8, kind: "ask" } as Message;
    const placeOf = new Map([
      [7, { kind: "task" as const, task: 3 }],
      [8, { kind: "task" as const, task: 4 }],
    ]);
    expect([...tasksAwaitingPeople({ openAsks: [esc, ask], placeOf, tasks: new Map() })]).toEqual([3]);
    expect(tasksAwaitingPeople({ openAsks: [], placeOf, tasks: new Map() }).size).toBe(0);
  });
});

describe("kiwi ask-human", () => {
  const owner = scratch("ask-owner");
  const agent = scratch("ask-agent");
  let task = "";
  let want = "";

  beforeAll(async () => {
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "ask-human", "--as", "lead", "--open"))![1]!;
    const p = spawn(agent, ["join", code, "--as", "dev"]);
    let listed = "";
    await until(async () => {
      listed = await ok(owner, "--as", "human", "requests");
      return /\d{3}-\d{3}/.test(listed);
    }, "request");
    await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
    expect(await p.exited).toBe(0);
    await ok(agent, "listen", "--now");
    want = /#(\d+)/.exec(await ok(owner, "--as", "human", "send", "the audit needs edits"))![1]!;
    task = `T${/T(\d+)/.exec(await ok(agent, "task", "add", "edit the audit", "--ask", want))![1]!}`;
  });

  test("the options and the task ride on the escalation, and picking one answers it", async () => {
    const sent = await ok(agent, "ask-human", "--task", task, "--option", "A: keep clearing", "--option", "B: rebuild dedup", "Edits clear the old evidence. Which way?");
    expect(sent).toContain("with 2 options");
    const seq = seqOf(sent);
    const log = await ok(owner, "log");
    expect(log).toContain(`#${seq} dev → `);
    expect(log).toContain(`[${task}] [escalation]`);
    expect(log).toContain("[options: A: keep clearing | B: rebuild dedup]");
    await ok(owner, "--as", "human", "reply", seq, "B: rebuild dedup");
    expect(await ok(agent, "listen", "--now")).toContain("B: rebuild dedup");
  });

  test("--task with --re asks in that task's thread only when the message it answers is there", async () => {
    const inMain = seqOf(await ok(agent, "send", "--main", "the audit clears evidence on edit"));
    const refused = await run(agent, "ask-human", "--task", task, "--re", inMain, "Which way?");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`#${inMain} is in the main conversation`);
    const inTask = seqOf(await ok(agent, "send", "--task", task, "dedup is lost on re-audit"));
    const asked = seqOf(await ok(agent, "ask-human", "--task", task, "--re", inTask, "--option", "A: refuse", "--option", "B: rebuild", "Which way?"));
    expect(await ok(owner, "log")).toContain(`#${asked} dev → `);
    expect((await ok(owner, "log")).split("\n").find((l) => l.startsWith(`#${asked} `))).toContain(`[${task}] [escalation]`);
  });

  test("--holds names the tasks and asks it holds and --kind its kind; one holding nothing is told it goes to the digest", async () => {
    const held = await run(agent, "ask-human", "--holds", `${task},#${want}`, "--kind", "taste", "--option", "A: glass", "--option", "B: flat", "Which look?");
    expect(held.code).toBe(0);
    expect(held.out).toContain(`holding ${task}, #${want}`);
    expect(held.err).not.toContain("digest");
    const waiting = await ok(owner, "--as", "human", "status");
    expect(waiting).toContain(`#${seqOf(held.out)} dev [blocking] [taste] · holds ${task}, #${want}: Which look?`);
    const idle = await run(agent, "ask-human", "Coffee or tea?");
    expect(idle.code).toBe(0);
    expect(idle.err).toContain("holds nothing up, so it goes to the person's digest, not Needs you");
    const digest = (await ok(owner, "--as", "human", "status")).split("\n").find((l) => l.startsWith("also asked, holding nothing up"));
    expect(digest).toContain(`#${seqOf(idle.out)}`);
    expect((await run(agent, "ask-human", "--holds", "T99999", "Which?")).err).toContain("99999 is neither a task nor a person's message here");
    expect((await run(agent, "ask-human", "--holds", "soon", "Which?")).code).toBe(1);
    expect((await run(agent, "ask-human", "--holds", task, "--kind", "vibes", "Which?")).code).toBe(1);
  });

  test("the flags are refused where they don't fit", async () => {
    expect((await run(agent, "ask-human", "--option", "A", "Which?")).code).toBe(1);
    expect((await run(agent, "ask-human", "--option", "Keep", "--option", "keep", "Which?")).code).toBe(1);
    expect((await run(agent, "send", "--option", "A", "--option", "B", "Which?")).code).toBe(1);
    expect((await run(agent, "ask-human", "--handoff", LINK, "--option", "A", "--option", "B", "Which?")).code).toBe(1);
    expect((await run(agent, "ask-human", "--task", "T99", "Which?")).code).toBe(1);
  });
});
