import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { Channel } from "@kiwi/core/client.ts";
import { received } from "@kiwi/core/client/history.ts";
import { sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Event, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, rosterOf, type FoldBase } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup, type PairedComputer } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-departed-owner-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let computer: PairedComputer;
let bo: Awaited<ReturnType<typeof joinAgent>>;
let cy: Awaited<ReturnType<typeof joinAgent>>;
let lee: Awaited<ReturnType<typeof joinAgent>>;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  computer = await pairComputer(s.person);
  bo = await joinAgent(s, "bo", computer);
  cy = await joinAgent(s, "cy", computer);
  lee = await joinAgent(s, "lee", computer, { role: "lead" });
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function log(): Promise<Message[]> {
  return (await s.ownerCh.history(0)).messages;
}

async function judged(extra: Message[], base?: FoldBase | null) {
  const all = [...(await log()), ...extra];
  return fold(all, rosterOf(await s.ownerCh.members()), Date.now(), null, null, base ?? null);
}

async function injected(who: Identity, ev: Event, seq: number): Promise<Message> {
  const payload: Payload = { v: PROTOCOL_VERSION, id: crypto.randomUUID(), from: who.name, kind: "event", body: "", ts: Date.now(), ev };
  const signed = await sign(who, payload);
  return received(signed, seq, Date.now(), await verify(signed));
}

const claim = (task: number): Event => ({ op: "task.claim", task });

const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);

const session = (who: typeof bo) => new AgentSession("departed-owner", { ...who.ch.access, relay: s.relay, code: s.code }, who.id, () => {});

async function taskOwnedByBo(): Promise<number> {
  await s.ownerCh.send("a task for bo", { kind: "event", ev: { op: "task.add", title: "ship it", owner: "bo" } });
  return [...(await judged([])).tasks.keys()].at(-1)!;
}

async function boGone(): Promise<void> {
  await s.ownerCh.send("bo is out", { kind: "event", ev: { op: "member.gone", member: "bo", pk: bo.id.pk } });
}

async function claimBy(who: typeof bo, task: number): Promise<number> {
  await who.ch.send(`${who.id.name} takes it`, { kind: "event", ev: claim(task) });
  return (await log()).at(-1)!.seq;
}

describe("a task whose owner left (#2320)", () => {
  test("a member can't take an active owner's task", async () => {
    const id = await taskOwnedByBo();
    const seq = await claimBy(cy, id);
    const state = await judged([]);
    expect(state.rejected.get(seq)).toBe(`T${id} is owned by bo`);
  });

  test("the owner still starts its own task while active", async () => {
    const id = await taskOwnedByBo();
    const seq = await claimBy(bo, id);
    const state = await judged([]);
    expect(state.rejected.get(seq)).toBeUndefined();
    expect(state.tasks.get(id)).toMatchObject({ owner: "bo", state: "doing" });
  });

  test("a claim made before the departure stays refused in the full log and from a kept base", async () => {
    const id = await taskOwnedByBo();
    const head = (await log()).at(-1)!.seq;
    const early = await injected(cy.id, claim(id), head + 1);
    const gone = await injected(s.owner, { op: "member.gone", member: "bo", pk: bo.id.pk }, head + 2);
    const base = (await new Channel(cy.ch.access, s.relay, cy.id).snapshot())!;
    for (const state of [await judged([early, gone]), await judged([early, gone], base)]) {
      expect(state.rejected.get(early.seq)).toBe(`T${id} is owned by bo`);
      expect(state.gone.has(bo.id.pk)).toBe(true);
    }
  });

  test("another member starts it after the owner's key is gone", async () => {
    const id = await taskOwnedByBo();
    await boGone();
    const seq = await claimBy(cy, id);
    const state = await judged([]);
    expect(state.rejected.get(seq)).toBeUndefined();
    expect(state.tasks.get(id)).toMatchObject({ owner: "cy", state: "doing" });
  });

  test("the lead starts it after the owner's key is gone", async () => {
    const id = await taskOwnedByBo();
    await boGone();
    const seq = await claimBy(lee, id);
    const state = await judged([]);
    expect(state.rejected.get(seq)).toBeUndefined();
    expect(state.tasks.get(id)).toMatchObject({ owner: "lee", state: "doing" });
  });

  test("the person hands a departed owner's task to another member", async () => {
    const id = await taskOwnedByBo();
    await boGone();
    await s.ownerCh.send("cy gets it", { kind: "event", ev: { op: "task.update", task: id, owner: "cy" } });
    const seq = (await log()).at(-1)!.seq;
    const state = await judged([]);
    expect(state.rejected.get(seq)).toBeUndefined();
    expect(state.tasks.get(id)).toMatchObject({ owner: "cy" });
  });

  test("the lead assigns a departed owner's task to itself", async () => {
    const id = await taskOwnedByBo();
    await boGone();
    const state = await run(session(lee).taskHandoff(id, "lee", undefined));
    expect(state.tasks.get(id)).toMatchObject({ owner: "lee" });
  });

  test("the lead assigns a departed owner's task to another builder", async () => {
    const id = await taskOwnedByBo();
    await boGone();
    const state = await run(session(lee).taskHandoff(id, "cy", undefined));
    expect(state.tasks.get(id)).toMatchObject({ owner: "cy" });
  });

  test("the lead still can't hand its own task to itself", async () => {
    await s.ownerCh.send("a task for lee", { kind: "event", ev: { op: "task.add", title: "lee's own", owner: "lee" } });
    const id = [...(await judged([])).tasks.keys()].at(-1)!;
    const refused = await run(Effect.flip(session(lee).taskHandoff(id, "lee", undefined)));
    expect(String(refused)).toContain("hand it to someone else");
  });
});
