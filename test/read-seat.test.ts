import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { daemonListeners, daemonSock } from "../src/daemon.ts";
import { created, DEAD, joinSeats } from "./join-seats-setup.ts";

setDefaultTimeout(90_000);

const { scratch, run, ok, join_ } = joinSeats();

const WORKER = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "W", CLAUDE_PID: String(process.pid) };
const RESTARTED = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "R", CLAUDE_PID: String(process.pid) };

async function seated() {
  const ownerA = scratch("own-a");
  const ownerB = scratch("own-b");
  const codeA = created(await ok(ownerA, ["create", "alpha", "--as", "boss"]));
  const codeB = created(await ok(ownerB, ["create", "beta", "--as", "boss"]));
  const h = scratch("agent");
  const projects = join(h, "projects");
  const repo = join(projects, "repo");
  mkdirSync(repo, { recursive: true });
  await join_(ownerB, h, codeB, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "Z", CLAUDE_PID: DEAD }, projects, ["--as", "sleeper"]);
  await join_(ownerA, h, codeA, WORKER, repo, ["--as", "worker"]);
  return { h, projects, repo, ownerB };
}

function ownership(h: string): unknown {
  const cfg = JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { bindings?: unknown; taken?: unknown; took?: unknown };
  return { bindings: cfg.bindings, taken: cfg.taken ?? null, took: cfg.took ?? null };
}

async function slots(h: string): Promise<string[]> {
  return (await daemonListeners(daemonSock(h)).catch(() => [])).map((l) => `${l.kind}:${l.agent}:${l.session ?? ""}`).sort();
}

const READS: string[][] = [
  ["status"],
  ["status", "--json"],
  ["log"],
  ["show", "1"],
  ["show", "general"],
  ["task"],
  ["task", "list"],
  ["task", "show", "T1"],
  ["task", "who", "T1"],
  ["spec", "show", "1"],
  ["specs"],
  ["rooms"],
  ["query", "select 1"],
  ["note"],
  ["note", "somekey"],
  ["lock"],
  ["lock", "list"],
  ["lock", "status"],
  ["wake"],
  ["color"],
  ["hold"],
  ["icon"],
  ["prompt"],
];

async function readsTakeNothing(h: string, who: Record<string, string>, cwd: string, channel: string[]) {
  const before = ownership(h);
  for (const read of READS) {
    const r = await run(h, [...channel, ...read], who, cwd);
    expect({ read, code: r.code, asked: r.err.includes("pass --as NAME"), now: ownership(h) }).toEqual({ read, code: 1, asked: true, now: before });
  }
}

describe("a read-only command never takes over a seat (#2688)", () => {
  test("a seated session reading another channel takes nothing, whatever it reads, and is asked for --as", async () => {
    const { h, repo } = await seated();
    const listening = await slots(h);
    await readsTakeNothing(h, WORKER, repo, ["-c", "beta"]);
    const status = await run(h, ["-c", "beta", "status"], WORKER, repo);
    expect(status.code).toBe(1);
    expect(status.err).toContain("sleeper in beta works from this folder, and this session is none of them: pass --as NAME to act as one");
    expect(await slots(h)).toEqual(listening);
  });

  test("with the channel implied by the folder, a read asks for --as too", async () => {
    const { h, projects, repo } = await seated();
    const before = ownership(h);
    const status = await run(h, ["status"], WORKER, projects);
    expect(status.code).toBe(1);
    expect(status.err).toContain("sleeper in beta works from this folder, and this session is none of them: pass --as NAME to act as one");
    expect(ownership(h)).toEqual(before);
    expect((await run(h, ["status"], WORKER, repo)).code).toBe(0);
    expect(ownership(h)).toEqual(before);
  });

  test("a read that names the seat with --as works and changes no binding or wake", async () => {
    const { h, projects, repo } = await seated();
    const before = ownership(h);
    const listening = await slots(h);
    expect((await run(h, ["-c", "beta", "--as", "sleeper", "status"], WORKER, repo)).code).toBe(0);
    expect((await run(h, ["--as", "sleeper", "status"], WORKER, projects)).code).toBe(0);
    expect(ownership(h)).toEqual(before);
    expect(await slots(h)).toEqual(listening);
  });

  test("a seated session that writes to another channel neither takes its dead seat nor posts as it, and is asked for --as", async () => {
    const { h, repo, ownerB } = await seated();
    const before = ownership(h);
    const sent = await run(h, ["-c", "beta", "send", "posted as sleeper"], WORKER, repo);
    expect(sent.code).toBe(1);
    expect(sent.err).toContain("this session is none of the agents on this machine in this channel (sleeper): pass --as NAME to act as one");
    expect(ownership(h)).toEqual(before);
    expect(await ok(ownerB, ["log"])).not.toContain("posted as sleeper");
    expect((await run(h, ["-c", "beta", "--as", "sleeper", "send", "named on purpose"], WORKER, repo)).code).toBe(0);
    expect(ownership(h)).toEqual(before);
    expect(await ok(ownerB, ["log"])).toContain("named on purpose");
  });

  test("a seated session in a folder with no seat of that channel doesn't post through the machine's only agent key there", async () => {
    const { h, repo } = await seated();
    const elsewhere = scratch("elsewhere");
    const before = ownership(h);
    const sent = await run(h, ["-c", "beta", "send", "through the key"], WORKER, elsewhere);
    expect(sent.code).toBe(1);
    expect(sent.err).toContain("this session is none of the agents on this machine in this channel (sleeper): pass --as NAME to act as one");
    expect(ownership(h)).toEqual(before);
    expect((await run(h, ["send", "as itself"], WORKER, repo)).code).toBe(0);
  });

  test("a restarted agent with no seat takes nothing by reading, takes its old seat back from its hook, and its next command says so once", async () => {
    const { h, projects } = await seated();
    await readsTakeNothing(h, RESTARTED, projects, []);
    await readsTakeNothing(h, RESTARTED, projects, ["-c", "beta"]);
    const prompt = await run(h, ["hook", "prompt"], RESTARTED, projects, JSON.stringify({ session_id: "R", cwd: projects, hook_event_name: "UserPromptSubmit", prompt: "hi" }));
    expect(prompt.code).toBe(0);
    const first = await run(h, ["status", "--json"], RESTARTED, projects);
    expect(first.code).toBe(0);
    expect(() => JSON.parse(first.out)).not.toThrow();
    expect(first.err.split("\n").filter((l) => l.includes("took the seat"))).toEqual([
      expect.stringMatching(/^Kiwi Channels: this session took the seat as sleeper in beta from session Z, quiet for \d+m; that channel's wakes come to you now\.$/),
    ]);
    const second = await run(h, ["status", "--json"], RESTARTED, projects);
    expect(second.code).toBe(0);
    expect(() => JSON.parse(second.out)).not.toThrow();
    expect(second.err).not.toContain("took the seat");
  });

  test("a message shown to the session as a seat it no longer holds doesn't pick that seat for a reply", async () => {
    const { h, projects, ownerB } = await seated();
    const gone = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "G", CLAUDE_PID: String(2 ** 22 + 777) };
    const hook = (env: Record<string, string>, session: string, prompt: string) =>
      run(h, ["hook", "prompt"], env, projects, JSON.stringify({ session_id: session, cwd: projects, hook_event_name: "UserPromptSubmit", prompt }));
    expect((await hook(gone, "G", "hi")).code).toBe(0);
    const seq = /#(\d+)/.exec(await ok(ownerB, ["send", "--to", "sleeper", "shown to G"]))![1]!;
    expect((await hook(gone, "G", "anything new")).out).toContain("shown to G");
    expect((await hook(RESTARTED, "R", "hi")).code).toBe(0);
    const seats = () => {
      const { bindings, taken } = ownership(h) as { bindings: unknown; taken: unknown };
      return { bindings, taken };
    };
    const before = seats();
    const stale = await run(h, ["reply", seq, "from a seat G lost"], gone, projects);
    expect(stale.code).toBe(1);
    expect(stale.err).toContain("this session was shown that message as sleeper, and it isn't sleeper now: pass --as NAME to act as one");
    expect(seats()).toEqual(before);
    expect(await ok(ownerB, ["log"])).not.toContain("from a seat G lost");
    expect((await run(h, ["reply", seq, "from the seat that holds it"], RESTARTED, projects)).code).toBe(0);
    expect(await ok(ownerB, ["log"])).toContain("from the seat that holds it");
  });
});
