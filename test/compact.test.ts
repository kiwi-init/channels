import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { formatStatus, formatTasks } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormedEvent, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, unnamedAsks, unnamedTasks, type FoldBase, type Roster, type Task } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: seq });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ann"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 1, active: true, kind: "agent" },
  ];
});

async function board() {
  const open = await ev("jon", { op: "task.add", title: "ship 0.18" });
  const done = await ev("jon", { op: "task.add", title: "fix the build" });
  const finish = await ev("jon", { op: "task.update", task: done.seq, state: "done" });
  return { open, done, ms: [open, done, finish] };
}

describe("compacting in fold", () => {
  test("the owner compacts behind a summary that names every open task; done tasks archive", async () => {
    const { open, done, ms } = await board();
    const proposal = await ev("ann", { op: "compact.propose", summary: `Build fixed. Open: T${open.seq}.`, through: ms.at(-1)!.seq });
    const approve = await ev("jon", { op: "compact", summary: `Build fixed. Open: T${open.seq}.`, through: ms.at(-1)!.seq, proposal: proposal.seq });
    const pending = fold([...ms, proposal], roster);
    expect(pending.compactProposal).toMatchObject({ by: "ann", through: ms.at(-1)!.seq });
    expect(pending.compact).toBeNull();
    const s = fold([...ms, proposal, approve], roster);
    expect(s.compact).toMatchObject({ by: "jon", through: ms.at(-1)!.seq, summary: `Build fixed. Open: T${open.seq}.` });
    expect(s.compactProposal).toBeNull();
    expect(s.tasks.get(done.seq)!.archived).toBe(true);
    expect(s.tasks.get(open.seq)!.archived).toBeUndefined();
    expect(s.tasks.size).toBe(2);
  });

  test("refused: a summary that leaves out an open task, an agent compacting, folding forward or backward", async () => {
    const { open, ms } = await board();
    const through = ms.at(-1)!.seq;
    const vague = await ev("ann", { op: "compact.propose", summary: "All good.", through });
    const byAgent = await ev("ann", { op: "compact", summary: `T${open.seq}`, through });
    const ahead = await ev("jon", { op: "compact", summary: `T${open.seq}`, through: seq + 5 });
    const s = fold([...ms, vague, byAgent, ahead], roster);
    expect(s.rejected.get(vague.seq)).toBe(`the summary leaves out open T${open.seq}`);
    expect(s.rejected.get(byAgent.seq)).toBe("only the owner compacts the history");
    expect(s.rejected.get(ahead.seq)).toContain("before itself");
    const first = await ev("jon", { op: "compact", summary: `T${open.seq}`, through });
    const back = await ev("jon", { op: "compact", summary: `T${open.seq}`, through: through - 1 });
    expect(fold([...ms, first, back], roster).rejected.get(back.seq)).toContain(`after #${through}`);
  });

  test("the board and status leave archived tasks out, and status says the history was compacted", async () => {
    const { open, ms } = await board();
    const s = fold([...ms, await ev("jon", { op: "compact", summary: `Open: T${open.seq}`, through: ms.at(-1)!.seq })], roster);
    expect(formatTasks(s, { all: false })).not.toContain("fix the build");
    expect(formatTasks(s, { all: true })).toContain("fix the build");
    const status = formatStatus({ alias: "c", me: "ann", state: s, online: new Map(), unread: 0 });
    expect(status).toContain(`history compacted through #${ms.at(-1)!.seq} by jon: Open: T${open.seq}`);
    expect(status).toContain("1 archived");
  });

  test("a fold resumed from a snapshot base keeps the compact and the archive", async () => {
    const { open, ms } = await board();
    const all = [...ms, await ev("jon", { op: "compact", summary: `T${open.seq}`, through: ms.at(-1)!.seq }), await ev("ann", { op: "hello" })];
    let base: FoldBase | null = null;
    fold(all.slice(0, 4), roster, Date.now(), null, null, null, (b) => {
      base = b;
    });
    const resumed = fold(all, roster, Date.now(), null, null, base);
    const whole = fold(all, roster);
    expect(resumed.compact).toEqual(whole.compact);
    expect([...resumed.tasks.values()].map((t) => t.archived)).toEqual([...whole.tasks.values()].map((t) => t.archived));
  });

  test("which open items a summary leaves out, and the wire shape", () => {
    const task = (id: number, state: Task["state"], archived?: true): Task => ({
      id,
      state,
      title: "",
      createdBy: "jon",
      createdAt: 0,
      updatedAt: 0,
      notes: [],
      workedBy: [],
      rounds: [],
      ...(archived ? { archived } : {}),
    });
    const tasks = [task(7, "doing"), task(8, "done"), task(12, "todo", true), task(70, "review")];
    expect(unnamedTasks("T7 is half done", tasks)).toEqual([70]);
    expect(unnamedTasks("T70 and T7", tasks)).toEqual([]);
    expect(unnamedAsks("see #123", [{ seq: 123 }, { seq: 12 }])).toEqual([12]);
    expect(wellFormedEvent({ op: "compact", summary: "x", through: 3, proposal: 4 })).toBe(true);
    expect(wellFormedEvent({ op: "compact.propose", summary: "", through: 3 })).toBe(false);
    expect(wellFormedEvent({ op: "compact", summary: "x".repeat(9000), through: 3 })).toBe(false);
  });
});

describe("over a relay", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-compact-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-compact-home-"));
  const was = process.env.KIWI_HOME;
  let server: ReturnType<typeof startRelay>;
  let owner: OwnerSetup;
  let ann: AgentSession;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    const computer = await pairComputer(owner.person);
    const { id, ch } = await joinAgent(owner, "ann", computer);
    ann = new AgentSession("compact", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("an agent proposes, naming open tasks and questions; the owner's approval folds the history", async () => {
    const task = await run(ann.taskAdd("write the release notes"));
    const ask = await owner.ownerCh.send("which date for the release?", { kind: "ask", to: ["ann"] });
    await expect(run(ann.proposeCompact("Nothing open."))).rejects.toThrow(`it leaves out T${task}, #${ask}`);
    const { seq, through, state } = await run(ann.proposeCompact(`Release work: T${task} open, date asked in #${ask}.`));
    expect(state.compactProposal).toMatchObject({ seq, through, by: "ann" });
    await owner.ownerCh.send(`compacted the history through #${through}`, { kind: "event", ev: { op: "compact", summary: state.compactProposal!.summary, through, proposal: seq } });
    const after = (await run(ann.state())).state;
    expect(after.compact).toMatchObject({ through, by: "jon" });
    expect(after.compactProposal).toBeNull();
  });
});
