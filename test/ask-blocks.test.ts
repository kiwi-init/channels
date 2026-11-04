import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { blocksOf } from "@kiwi/core/doc/blocks.ts";
import type { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(30_000);

describe("an agent's ask stays a plain message that 2026.11.7 desktops and phones read (T1354)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-ask-blocks-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-ask-blocks-home-"));
  const was = process.env.KIWI_HOME;
  const stop = new AbortController();
  let server: ReturnType<typeof startRelay>;
  let owner: OwnerSetup;
  let dev: AgentSession;
  let general: ThreadDoc;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  const message = async (seq: number): Promise<Message> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const m = (await owner.ownerCh.history(0)).messages.find((x) => x.seq === seq);
      if (m) return m;
      await Bun.sleep(200);
    }
    throw new Error(`no message #${seq}`);
  };

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    await new Promise<void>((done) => void owner.ownerCh.stream(0, () => {}, { signal: stop.signal, onReady: () => done() }));
    general = await owner.ownerCh.threadDoc("main");
    await general.whenSynced();
    const { id, ch } = await joinAgent(owner, "dev", await pairComputer(owner.person));
    dev = new AgentSession("ask-blocks", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
  });
  afterAll(() => {
    stop.abort();
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("an ask in #general carries no block, so 2026.11.7 clients don't drop it, and the doc gets no copy", async () => {
    const { seq } = await run(dev.escalate("Which look?", undefined, undefined, { choices: ["A: glass", "B: flat"] }));
    const m = await message(seq);
    expect(m.esc).toBe(true);
    expect(m.choices).toEqual(["A: glass", "B: flat"]);
    expect(m.block).toBeUndefined();
    await Bun.sleep(500);
    expect(blocksOf(general.doc).some((b) => b.text === "Which look?")).toBe(false);
  });

  test("an ask that answers a message stays a plain message in that message's thread", async () => {
    const said = await run(dev.send("the audit clears evidence on edit"));
    const reply = await run(dev.escalate("Which way?", said, undefined, { choices: ["A: refuse", "B: rebuild"] }));
    const m = await message(reply.seq);
    expect(m.esc).toBe(true);
    expect(m.re).toEqual([said]);
    expect(m.block).toBeUndefined();
  });
});
