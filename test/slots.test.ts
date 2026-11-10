import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { signRequest } from "@kiwi/core/auth.ts";
import { mentionsOf } from "@kiwi/core/changes.ts";
import { seal, slotId } from "@kiwi/core/crypto.ts";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-slots-relay-"));
const home = mkdtempSync(join(tmpdir(), "kiwi-slots-home-"));
const was = process.env.KIWI_HOME;
let server: ReturnType<typeof startRelay>;
let owner: OwnerSetup;
let ann: AgentSession;
let bob: AgentSession;
let carl: AgentSession;
let lea: AgentSession;
let annId: Awaited<ReturnType<typeof joinAgent>>["id"];

const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
const settled = <A>(p: Promise<A>) =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => ({ ok: false as const, why: err instanceof Error ? err.message : String(err) }),
  );

beforeAll(async () => {
  process.env.KIWI_HOME = home;
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  owner = await setupChannel(server.url.origin, { ownerName: "jon" });
  const computer = await pairComputer(owner.person);
  const session = async (name: string) => {
    const joined = await joinAgent(owner, name, computer);
    if (name === "ann") annId = joined.id;
    return new AgentSession("slots", { ...joined.ch.access, relay: owner.relay, code: owner.code }, joined.id, () => {});
  };
  ann = await session("ann");
  bob = await session("bob");
  carl = await session("carl");
  lea = await session("lea");
  await owner.ownerCh.send("lea leads", { kind: "event", ev: { op: "role.set", member: "lea", role: "lead" } });
});

afterAll(() => {
  server.stop(true);
  if (was === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = was;
  for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
});

const claimsOf = async (s: AgentSession, task: number) => {
  const { messages } = await run(s.state());
  return messages.filter((m) => m.ev?.op === "task.claim" && m.ev.task === task).map((m) => m.from);
};

describe("task claims are compare-and-set on the relay", () => {
  test("two agents claim at once: one gets it, the other hears who has it and leaves nothing in the log", async () => {
    const id = await run(ann.taskAdd("race me"));
    const [a, b] = await Promise.all([settled(run(ann.taskClaim(id))), settled(run(bob.taskClaim(id)))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const winner = a.ok ? "ann" : "bob";
    const loser = a.ok ? b : a;
    expect([`T${id} is taken by ${winner}`, `T${id} is owned by ${winner}`]).toContain(loser.ok ? "" : loser.why);
    expect(await claimsOf(ann, id)).toEqual([winner]);
  });

  test("dropping a task frees it at once for the next claim", async () => {
    const id = await run(ann.taskAdd("hand me on"));
    await run(ann.taskClaim(id));
    await run(ann.taskUpdate(id, { owner: null }));
    const after = await run(bob.taskClaim(id));
    expect(after.tasks.get(id)?.owner).toBe("bob");
  });

  test("the holder may take its own slot again", async () => {
    const id = await run(ann.taskAdd("mine twice"));
    await run(ann.taskClaim(id));
    expect((await run(ann.taskClaim(id))).tasks.get(id)?.owner).toBe("ann");
  });
});

describe("answering #N", () => {
  test("the first to say it's answering is noted; the other is told, and its reply still goes out: under the answer once there is one", async () => {
    const q = await owner.ownerCh.send("who can look at the flaky test?");
    const [a, b] = await Promise.all([settled(run(ann.answering(q))), settled(run(bob.answering(q)))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const [winner, other] = a.ok ? [ann, bob] : [bob, ann];
    const name = a.ok ? "ann" : "bob";
    const lost = a.ok ? b : a;
    expect(lost.ok ? "" : lost.why).toStartWith(`${name} is already answering #${q}; a reply of yours still goes out, under theirs`);
    const early = await run(other.replyPlaced(q, "me too"));
    expect(early.seq).toBeGreaterThan(q);
    expect(early.under).toBeUndefined();
    expect(await run(other.send("and one more thing", { re: [q] }))).toBeGreaterThan(early.seq);
    const answer = await run(winner.reply(q, "on it"));
    expect(answer).toBeGreaterThan(q);
    const late = await run(carl.replyPlaced(q, "I'll pair, it's the 'cold' run"));
    expect(late.under).toEqual({ answer, by: name });
    const { messages } = await run(carl.state());
    expect(messages.find((m) => m.seq === late.seq)).toMatchObject({ re: [answer], to: ["jon"], body: "I'll pair, it's the 'cold' run" });
  });

  test("the marker doesn't count as an answer to an ask", async () => {
    const q = await owner.ownerCh.send("pick one", { kind: "ask", to: ["ann"] });
    await run(ann.answering(q));
    const { state } = await run(ann.state());
    expect(state.openAsks.map((m) => m.seq)).toContain(q);
  });

  test("the first reply to a message sent to everyone is its answer; the next agent's reply is sent under it, once, and never dropped (T5088)", async () => {
    const q = await owner.ownerCh.send("who can review PR 12?");
    const answer = await run(ann.reply(q, "I'll take it"));
    expect(answer).toBeGreaterThan(q);
    const second = await run(bob.replyPlaced(q, "me too"));
    expect(second.under).toEqual({ answer, by: "ann" });
    const { messages } = await run(bob.state());
    expect(messages.find((m) => m.seq === second.seq)).toMatchObject({ from: "bob", re: [answer], to: ["jon"], body: "me too" });
    await expect(run(bob.reply(q, "and another"))).rejects.toThrow(`you already added #${second.seq} under ann's answer to #${q}: carry on there with kiwi reply ${second.seq} "…"`);
    expect(await run(bob.reply(second.seq, "and another"))).toBeGreaterThan(second.seq);
    await expect(run(bob.answering(q))).rejects.toThrow(`ann is already answering #${q}; a reply of yours still goes out, under theirs`);
    expect(await run(ann.reply(q, "PR 12 is approved"))).toBeGreaterThan(answer);
    const third = await run(carl.replyPlaced(q, "I can take the next one"));
    expect(third.under).toEqual({ answer, by: "ann" });
  });

  test("an agent the message names answers it directly, claim or not", async () => {
    const q = await owner.ownerCh.send("who can cut the release? @bob knows the script");
    const answer = await run(ann.reply(q, "I can"));
    const named = await run(bob.replyPlaced(q, "I'll do it, I wrote the script"));
    expect(named.under).toBeUndefined();
    const both = await owner.ownerCh.send("ann and bob, which of you has the staging key?", { to: ["ann", "bob"] });
    const first = await run(ann.replyPlaced(both, "I do"));
    const other = await run(bob.replyPlaced(both, "I have the old one"));
    expect([first.under, other.under]).toEqual([undefined, undefined]);
    const { messages } = await run(bob.state());
    expect(messages.find((m) => m.seq === named.seq)?.re).toEqual([q]);
    expect(messages.find((m) => m.seq === other.seq)?.re).toEqual([both]);
    expect(answer).toBeLessThan(named.seq);
  });

  test("the channel's Lead answers directly, after someone else's answer and after someone's answering note", async () => {
    const q = await owner.ownerCh.send("is the release still on for today?");
    const answer = await run(ann.reply(q, "I think so"));
    const said = await run(lea.replyPlaced(q, "Yes: the tag goes out at five"));
    expect(said.under).toBeUndefined();
    const noted = await owner.ownerCh.send("who owns the changelog?");
    await run(bob.answering(noted));
    expect((await run(lea.replyPlaced(noted, "bob does"))).under).toBeUndefined();
    const { messages, state } = await run(lea.state());
    expect(state.lead).toBe("lea");
    expect(messages.find((m) => m.seq === said.seq)?.re).toEqual([q]);
    expect(answer).toBeLessThan(said.seq);
  });

  test("a reply sent under an answer is addressed to the asker alone and wakes no agent", async () => {
    const q = await owner.ownerCh.send("anyone seen the 502s?");
    const answer = await run(ann.reply(q, "yes, since noon"));
    const under = await run(bob.replyPlaced(q, "same on staging"));
    const { messages, state } = await run(ann.state());
    const sent = messages.find((m) => m.seq === under.seq);
    expect(sent).toMatchObject({ re: [answer], to: ["jon"] });
    expect(state.threadOf.get(under.seq)).toBe(state.threadOf.get(answer) ?? q);
    expect([...mentionsOf(sent?.body ?? "")]).toEqual([]);
  });

  test("a reply to a message sent only to you claims nothing", async () => {
    const q = await owner.ownerCh.send("ann, are you free?", { to: ["ann"] });
    expect(await run(ann.reply(q, "yes"))).toBeGreaterThan(q);
    expect(await run(bob.answering(q))).toBeDefined();
  });
});

describe("the relay's side", () => {
  const post = async (body: object) => {
    const text = JSON.stringify(body);
    return fetch(`${owner.relay}/v1/rooms/${owner.roomId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${await signRequest(annId, owner.roomId, "POST", "/messages", text)}`, "content-type": "application/json" },
      body: text,
    });
  };
  const sealed = () => {
    const e = owner.access.epoch;
    return seal(owner.access.keys[String(e)]!, owner.roomId, { hello: "slot" }).then((s) => ({ ...s, e }));
  };

  test("a malformed slot or free list is refused", async () => {
    const res = await post({ ...(await sealed()), slot: { id: "short", ttl: 5_000 } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad slot", tag: "BadRequest" });
    const many = await post({ ...(await sealed()), free: Array.from({ length: 9 }, () => "a".repeat(43)) });
    expect(await many.json()).toEqual({ error: "bad slots to free", tag: "BadRequest" });
  });

  test("a slot someone else holds is refused with 423 and the seq that holds it", async () => {
    const id = await slotId(owner.access.keys[String(owner.access.epoch)]!, owner.roomId, "relay-test");
    const first = await post({ ...(await sealed()), slot: { id, ttl: 60_000 } });
    expect(first.status).toBe(200);
    const { seq } = (await first.json()) as { seq: number };
    const text = JSON.stringify({ ...(await sealed()), slot: { id, ttl: 60_000 } });
    const res = await fetch(`${owner.relay}/v1/rooms/${owner.roomId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${await signRequest(owner.owner, owner.roomId, "POST", "/messages", text)}`, "content-type": "application/json" },
      body: text,
    });
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ error: `taken at #${seq}`, tag: "Taken" });
  });
});
