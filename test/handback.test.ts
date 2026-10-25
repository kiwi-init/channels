import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { startRelay } from "../src/relay/bun.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { formatTask, formatTasks } from "@kiwi/core/format.ts";
import { handBackText, heldBy } from "@kiwi/core/handback.ts";
import { joinAgent, pairComputer, setupChannel } from "./owner.ts";

setDefaultTimeout(60_000);

const T0 = 1_700_000_000_000;
const ids: Record<string, Identity> = {};
const roster = (gone: string[] = []): Roster =>
  ["jow", "lead", "hedgehog", "wren"].map((name) => ({
    name,
    pk: ids[name]!.pk,
    owner: name === "jow",
    at: 0,
    active: !gone.includes(name),
    kind: name === "jow" ? ("human" as const) : ("agent" as const),
    ...(name === "lead" ? { role: "lead" } : {}),
  }));

type Draft = { from: string; kind: Message["kind"]; body: string; ev?: Event; re?: number[] };

async function signedLog(drafts: Draft[]): Promise<Message[]> {
  const out: Message[] = [];
  for (const [i, d] of drafts.entries()) {
    const p = await sign(ids[d.from]!, { v: 1 as const, id: crypto.randomUUID(), ts: T0 + i * 1_000, ...d });
    out.push({ ...p, seq: i + 1, rts: T0 + i * 1_000, sigOk: await verify(p) } as Message);
  }
  return out;
}

const ev = (from: string, e: Event, re?: number): Draft => ({ from, kind: "event", body: "", ev: e, ...(re !== undefined ? { re: [re] } : {}) });

let log: Message[];

beforeAll(async () => {
  for (const n of ["jow", "lead", "hedgehog", "wren"]) ids[n] = await generateIdentity(n);
  log = await signedLog([
    { from: "jow", kind: "msg", body: "make the AppImage start on Fedora" },
    ev("lead", { op: "task.add", title: "Start without the tray library", owner: "hedgehog" }, 1),
    ev("hedgehog", { op: "task.update", task: 2, state: "doing" }),
    ev("hedgehog", { op: "task.update", task: 2, note: "branch T2-ayatana, commit 92838aa4, next: open the PR", checkpoint: true }),
    ev("lead", { op: "task.add", title: "Name the right package", owner: "hedgehog" }, 1),
    ev("lead", { op: "task.add", title: "Already shipped", owner: "hedgehog" }, 1),
    ev("hedgehog", { op: "task.update", task: 6, state: "done" }),
    ev("lead", { op: "task.add", title: "Wren's own", owner: "wren" }, 1),
  ]);
});

describe("a task outlives the agent who leaves", () => {
  test("once its owner is gone, its open tasks are back on the board, named as left by them, and done ones keep their owner", () => {
    const s = fold(log, roster(["hedgehog"]), T0);
    expect([2, 5, 6, 8].map((id) => [id, s.tasks.get(id)?.owner ?? null, s.tasks.get(id)?.leftBy ?? null, s.tasks.get(id)?.state])).toEqual([
      [2, null, "hedgehog", "todo"],
      [5, null, "hedgehog", "todo"],
      [6, "hedgehog", null, "done"],
      [8, "wren", null, "todo"],
    ]);
    expect(formatTasks(s, {})).toContain("T2    planned   (hedgehog left) Start without the tray library");
    expect(formatTask(s, s.tasks.get(2)!)).toContain("unassigned: hedgehog left the channel");
    expect(s.tasks.get(2)?.notes.at(-1)?.text).toBe("branch T2-ayatana, commit 92838aa4, next: open the PR");
  });

  test("while they're still in the channel, the tasks stay theirs", () => {
    const here = fold(log, roster(), T0);
    expect([here.tasks.get(2)?.owner, here.tasks.get(2)?.leftBy, here.tasks.get(2)?.state]).toEqual(["hedgehog", undefined, "doing"]);
  });

  test("the message handing them back names each task, where its work is and whether it has a checkpoint", () => {
    const s = fold(log, roster(), T0);
    expect(heldBy(s, "hedgehog").map((t) => t.id)).toEqual([2, 5]);
    expect(handBackText(s, "hedgehog", "removed", heldBy(s, "hedgehog"))).toBe(
      [
        "hedgehog was removed from the channel. Back on the board, open for someone to take:",
        "- T2 Start without the tray library: no PR yet; its checkpoint (#4) says where it stands",
        "- T5 Name the right package: no PR yet; no checkpoint written",
      ].join("\n"),
    );
  });
});

describe("leaving hands the tasks back", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-handback-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-handback-home-"));
  const was = process.env.KIWI_HOME;
  let server: ReturnType<typeof startRelay>;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  let lead: AgentSession;
  let dev: AgentSession;
  let ask: number;

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    const owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    const computer = await pairComputer(owner.person);
    const seat = async (name: string) => {
      const { id, ch } = await joinAgent(owner, name, computer);
      return new AgentSession("handback", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
    };
    lead = await seat("lead");
    dev = await seat("dev");
    await owner.ownerCh.send("lead is the lead", { kind: "event", ev: { op: "role.set", member: "lead", role: "lead" } });
    ask = await owner.ownerCh.send("make it start on Fedora");
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("its open tasks are named to the lead before it goes, and once it's gone the board has them open, left by it", async () => {
    const a = await run(dev.taskAdd("Start without the tray library", { re: ask, owner: "dev" }));
    await run(dev.taskUpdate(a, { state: "doing" }));
    const b = await run(dev.taskAdd("Name the right package", { re: ask, owner: "dev" }));
    const c = await run(dev.taskAdd("Small fix", { re: ask, owner: "dev" }));
    await run(dev.taskUpdate(c, { state: "done" }));
    expect((await run(dev.handBack())).sort()).toEqual([a, b].sort());
    const told = (await run(lead.state())).messages.at(-1)!;
    expect([told.from, told.to, told.body.split("\n")[0]]).toEqual(["dev", ["lead"], "dev is leaving the channel. Back on the board, open for someone to take:"]);
    expect(told.body).toContain(`- T${a} Start without the tray library: no PR yet; no checkpoint written`);
    await run(dev.ch.fx.leave());
    await run(lead.members(true));
    const after = (await run(lead.state())).state;
    expect(after.members.get("dev")?.active).toBe(false);
    expect([a, b, c].map((id) => [after.tasks.get(id)?.owner ?? null, after.tasks.get(id)?.leftBy ?? null, after.tasks.get(id)?.state])).toEqual([
      [null, "dev", "todo"],
      [null, "dev", "todo"],
      ["dev", null, "done"],
    ]);
  });
});
