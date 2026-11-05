import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { Channel } from "@kiwi/core/client.ts";
import { agentBlock } from "@kiwi/core/doc/agent.ts";
import type { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { Place } from "@kiwi/core/state.ts";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { docPlaceOfMessage } from "../src/agent/docs.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(30_000);

describe("a doc line's place comes from its message, not only from the first doc listed (T3780)", () => {
  const listed = "L".repeat(22);
  const other = "O".repeat(22);
  const state: Parameters<typeof docPlaceOfMessage>[0] = {
    docs: new Map([
      ["main", listed],
      ["task:7", "T".repeat(22)],
    ]),
    placeOf: new Map<number, Place>([
      [20, { kind: "task", task: 7 }],
      [22, { kind: "dm", with: ["jow", "lead"] }],
    ]),
    roomOf: new Map([[13, "design"]]),
  };

  test("a listed doc keeps its key; a second #general doc, a room's or a task's gets the key of where its message is; a DM's gets none", () => {
    expect(docPlaceOfMessage(state, { seq: 12, block: { th: listed } })).toEqual({ key: "main", th: listed });
    expect(docPlaceOfMessage(state, { seq: 12, block: { th: other } })).toEqual({ key: "main", th: other });
    expect(docPlaceOfMessage(state, { seq: 13, block: { th: other } })).toEqual({ key: "room:design", th: other });
    expect(docPlaceOfMessage(state, { seq: 20, block: { th: other } })).toEqual({ key: "task:7", th: other });
    expect(docPlaceOfMessage(state, { seq: 22, block: { th: other } })).toBeNull();
    expect(docPlaceOfMessage(state, { seq: 12 })).toBeNull();
  });
});

describe("an agent gets the image of a #general line written in a doc the channel doesn't list first (T3780)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-doc-forked-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-doc-forked-home-"));
  const was = process.env.KIWI_HOME;
  const stop = new AbortController();
  let server: ReturnType<typeof startRelay>;
  let owner: OwnerSetup;
  let dev: AgentSession;
  let general: ThreadDoc;
  let app: Channel;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  const message = async (seq: number): Promise<Message> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const m = (await owner.ownerCh.history(0)).messages.find((x) => x.seq === seq);
      if (m) return m;
      await Bun.sleep(100);
    }
    throw new Error(`no message #${seq}`);
  };
  const lineWithImage = async (td: ThreadDoc, png: string): Promise<Message> => {
    const img = await app.putImage({ name: "shot.png", mime: "image/png", data: png });
    const block = agentBlock(td.doc, "jon", "text");
    block.write("off screen");
    block.attach([{ image: { ...img, ref: img.ref! } }]);
    block.post();
    await td.flush();
    return message(await owner.ownerCh.send("[image: shot.png]\noff screen", { kind: "msg", block: { th: td.th, id: block.id } }));
  };

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    await new Promise<void>((done) => void owner.ownerCh.stream(0, () => {}, { signal: stop.signal, onReady: () => done() }));
    general = await owner.ownerCh.threadDoc("main");
    await general.whenSynced();
    app = new Channel(owner.access, owner.relay, owner.owner);
    await new Promise<void>((done) => void app.stream(0, () => {}, { signal: stop.signal, onReady: () => done() }));
    const { id, ch } = await joinAgent(owner, "dev", await pairComputer(owner.person));
    dev = new AgentSession("doc-forked", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
  });
  afterAll(() => {
    stop.abort();
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("a line in the listed #general doc brings its image", async () => {
    const png = Buffer.from("listed doc bytes").toString("base64");
    const m = await run(dev.withBlockMedia(await lineWithImage(general, png)));
    expect(m.imgs?.map((i) => i.name)).toEqual(["shot.png"]);
    expect(await dev.ch.image(m.imgs![0]!)).toBe(png);
  });

  test("a line in a second #general doc, opened by an app that didn't know the first, brings its image too", async () => {
    const fork = await app.threadDoc("main");
    await fork.whenSynced();
    expect(fork.th).not.toBe(general.th);
    const png = Buffer.from("forked doc bytes").toString("base64");
    const m = await run(dev.withBlockMedia(await lineWithImage(fork, png)));
    expect(m.block?.th).toBe(fork.th);
    expect(m.imgs?.map((i) => i.name)).toEqual(["shot.png"]);
    expect(await dev.ch.image(m.imgs![0]!)).toBe(png);
  });
});
