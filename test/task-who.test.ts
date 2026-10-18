import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { describeEvent, formatCandidates, formatTask } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormedEvent, type Event, type Message } from "@kiwi/core/protocol.ts";
import { pickFor, taskCandidates } from "@kiwi/core/routing.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel } from "./owner.ts";

setDefaultTimeout(60_000);

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "bo", "cy"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "bo", pk: ids.bo!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "cy", pk: ids.cy!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

describe("where a task comes from", () => {
  test("from is a task number; one that names no task folds to nothing", async () => {
    expect(wellFormedEvent({ op: "task.add", title: "x", from: 3 })).toBe(true);
    expect(wellFormedEvent({ op: "task.add", title: "x", from: 0 })).toBe(false);
    expect(wellFormedEvent({ op: "task.add", title: "x", from: "T3" })).toBe(false);
    const parent = await ev("jon", { op: "task.add", title: "GitHub: branch PRs" });
    const child = await ev("jon", { op: "task.add", title: "GitHub: issues", from: parent.seq });
    const orphan = await ev("jon", { op: "task.add", title: "Nothing above", from: 9999 });
    const s = fold([parent, child, orphan], roster);
    expect(s.tasks.get(child.seq)?.from).toBe(parent.seq);
    expect(s.tasks.get(orphan.seq)?.from).toBeUndefined();
    expect(describeEvent(child, s)).toBe(`added task T${child.seq} “GitHub: issues” (from T${parent.seq})`);
    expect(formatTask(s, s.tasks.get(child.seq)!)).toContain(`  from T${parent.seq}: GitHub: branch PRs`);
    expect(formatTask(s, s.tasks.get(parent.seq)!)).toContain(`  follow-ups: T${child.seq}`);
  });
});

describe("who has a task's context", () => {
  test("whoever worked it, its parent, its follow-ups and its siblings rank first, with the reasons; then the shorter queue", async () => {
    const parent = await ev("jon", { op: "task.add", title: "Part 1", owner: "ana" });
    const sibling = await ev("jon", { op: "task.add", title: "Part 2", owner: "bo", from: parent.seq });
    const next = await ev("jon", { op: "task.add", title: "Part 3", from: parent.seq });
    const busy = await ev("jon", { op: "task.add", title: "Unrelated", owner: "cy" });
    const s = fold([parent, sibling, next, busy], roster);
    const ranked = taskCandidates(s, next.seq);
    expect(ranked).toEqual([
      { name: "ana", score: 3, queue: 1, reasons: [`worked T${parent.seq}, where it came from`] },
      { name: "bo", score: 2, queue: 1, reasons: [`worked T${sibling.seq}, also from T${parent.seq}`] },
      { name: "cy", score: 0, queue: 1, reasons: [] },
    ]);
    expect(pickFor(ranked)?.name).toBe("ana");
    expect(taskCandidates(s, parent.seq)[0]).toMatchObject({ name: "ana", reasons: [`worked T${parent.seq} before`] });
    expect(taskCandidates(s, parent.seq)[1]).toMatchObject({ name: "bo", reasons: [`worked T${sibling.seq}, a follow-up of it`] });
    expect(taskCandidates(s, 424242)).toEqual([]);
  });

  test("a busy candidate (3 tasks ahead) is passed over; with nobody free who has the context, nobody is picked", async () => {
    const parent = await ev("jon", { op: "task.add", title: "Root", owner: "ana" });
    const log = [parent];
    for (let i = 0; i < 3; i++) log.push(await ev("jon", { op: "task.add", title: `Ana's ${i}`, owner: "ana" }));
    const next = await ev("jon", { op: "task.add", title: "Follow-up", from: parent.seq });
    log.push(next);
    const s = fold(log, roster);
    const ranked = taskCandidates(s, next.seq);
    expect(ranked[0]).toMatchObject({ name: "ana", queue: 4 });
    expect(pickFor(ranked)).toBeNull();
    const shown = formatCandidates(s.tasks.get(next.seq)!, ranked);
    expect(shown).toContain(`ana · worked T${parent.seq}, where it came from · 4 tasks ahead (busy: the lead decides)`);
    expect(shown).toContain("bo · no context · 0 tasks ahead");
    expect(shown).toContain(`nobody free has its context: name someone, kiwi task assign T${next.seq} NAME`);
  });
});

describe("--from on a live channel", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-who-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-who-home-"));
  const was = process.env.KIWI_HOME;
  let server: ReturnType<typeof startRelay>;
  let dev: AgentSession;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    const owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    const { id, ch } = await joinAgent(owner, "dev", await pairComputer(owner.person));
    dev = new AgentSession("who", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("a task names the one it came from, and a task that isn't there is refused", async () => {
    const parent = await run(dev.taskAdd("first part"));
    const child = await run(dev.taskAdd("second part", { from: parent }));
    const { state } = await run(dev.state());
    expect(state.tasks.get(child)?.from).toBe(parent);
    expect(await run(dev.taskAdd("nowhere", { from: 9999 })).then(String, (e: unknown) => (e instanceof Error ? e.message : String(e)))).toBe("no task T9999 to come from");
  });
});
