import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { Channel } from "@kiwi/core/client.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-unsynced-"));
const home = mkdtempSync(join(tmpdir(), "kiwi-unsynced-home-"));
const was = process.env.KIWI_HOME;
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let ana: { id: Identity; ch: Channel };
let bo: { id: Identity; ch: Channel };
let room: string;

const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => "sent",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
const plainly = async (text: string) => (await new Channel(bo.ch.access, s.relay, bo.id).history(0)).messages.some((m) => m.body.includes(text));
const head = async () => (await s.ownerCh.history(0)).messages.at(-1)?.seq ?? 0;

beforeAll(async () => {
  process.env.KIWI_HOME = home;
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  const computer = await pairComputer(s.person);
  ana = await joinAgent(s, "ana", computer);
  bo = await joinAgent(s, "bo", computer);
  room = await s.ownerCh.makeRoom("hiring", [{ name: "ana", pk: ana.id.pk, xpk: ana.id.xpk! }]);
  await s.ownerCh.send("made a room", { kind: "event", ev: { op: "room.create", id: "design", name: "design" } });
});

afterAll(() => {
  server.stop(true);
  if (was === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = was;
  for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
});

describe("a client that hasn't synced a private room never sends its text in the clear (T1234)", () => {
  test("a member's fresh client learns the key first and seals the message", async () => {
    const fresh = new Channel(ana.ch.access, s.relay, ana.id);
    const seq = await fresh.send("the offer is 120 from a fresh app", { room });
    expect(await plainly("the offer is 120")).toBe(false);
    expect((await s.ownerCh.history(0)).messages.find((m) => m.seq === seq)?.body).toBe("the offer is 120 from a fresh app");
  });

  test("an outsider's fresh client is refused, and nothing leaves", async () => {
    const before = await head();
    expect(await refusal(new Channel(bo.ch.access, s.relay, bo.id).send("bo was here", { room }))).toMatch(/^you're not in that private room/);
    expect(await head()).toBe(before);
  });

  test("a room no one has made is refused, and a public room still takes a plain message", async () => {
    const before = await head();
    expect(await refusal(new Channel(bo.ch.access, s.relay, bo.id).send("into the void", { room: "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5" }))).toContain(
      "doesn't know a room a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
    );
    expect(await head()).toBe(before);
    await new Channel(bo.ch.access, s.relay, bo.id).send("mockups are up", { room: "design" });
    expect(await plainly("mockups are up")).toBe(true);
  });

  test("through the CLI's session, a member's message to the room is sealed, and an outsider's is refused", async () => {
    const anaCli = new AgentSession("unsynced", { ...ana.ch.access, relay: s.relay, code: s.code }, ana.id, () => {});
    await run(anaCli.send("the start date from the cli", { room: "hiring" }));
    expect(await plainly("the start date")).toBe(false);
    const before = await head();
    const boCli = new AgentSession("unsynced", { ...bo.ch.access, relay: s.relay, code: s.code }, bo.id, () => {});
    expect(await refusal(run(boCli.send("bo from the cli", { room: "hiring" })))).toMatch(/^(no room hiring|you're not in that private room)/);
    expect(await head()).toBe(before);
  });
});
