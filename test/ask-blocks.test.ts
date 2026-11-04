import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Y from "yjs";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { readDoc } from "../src/agent/docs.ts";
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

  test("a plain send into #general's doc also posts its message, pointing at the block, so phones and pushes get it; kiwi log's doc part leaves it out (T1388)", async () => {
    const at = { key: "main", th: general.th };
    const seq = await run(dev.sendToDoc("@jon the relay is merged", at));
    const m = await message(seq);
    expect(m.kind).toBe("msg");
    expect(m.body).toBe("@jon the relay is merged");
    expect(m.block?.th).toBe(general.th);
    const deadline = Date.now() + 5_000;
    while (!blocksOf(general.doc).some((b) => b.id === m.block?.id) && Date.now() < deadline) await Bun.sleep(20);
    expect(blocksOf(general.doc).find((b) => b.id === m.block?.id)).toMatchObject({ kind: "agent", author: "dev", text: "@jon the relay is merged", sent: true, posted: true });
    const reader = dev.ch;
    expect(await readDoc(reader, 0, at)).toContain("the relay is merged");
    expect(await readDoc(reader, 0, at, undefined, true)).not.toContain("the relay is merged");
  });

  const blockOf = async (m: Message) => {
    const deadline = Date.now() + 5_000;
    while (!blocksOf(general.doc).some((b) => b.id === m.block?.id) && Date.now() < deadline) await Bun.sleep(20);
    return blocksOf(general.doc).find((b) => b.id === m.block?.id);
  };

  test("a reply with an image and a file writes its block into the doc of its message's thread, then posts its message pointing at it (T1256)", async () => {
    const asked = await run(dev.send("which trace?"));
    const at = { key: "main", th: general.th };
    const png = Buffer.from("a png's bytes, near enough").toString("base64");
    const file = await dev.ch.putFileData("trace.log", "text/plain", Buffer.from("line one\n").toString("base64"));
    const seq = await run(dev.reply(asked, "this one", "msg", [{ name: "shot.png", mime: "image/png", data: png }], { files: [file] }, at));
    const m = await message(seq);
    expect(m.re).toEqual([asked]);
    expect(m.side).toBe(true);
    expect(m.imgs?.map((i) => i.name)).toEqual(["shot.png"]);
    expect(m.files?.map((f) => f.name)).toEqual(["trace.log"]);
    expect(m.block?.th).toBe(general.th);
    expect(await blockOf(m)).toMatchObject({ author: "dev", text: "this one\n[image: shot.png]\n[file: trace.log]", sent: true, posted: true });
    const image = general.doc
      .getXmlFragment("thread")
      .toArray()
      .flatMap((el) => (el instanceof Y.XmlElement && el.getAttribute("id") === m.block?.id ? el.toArray() : []))[1];
    expect(
      image instanceof Y.XmlElement &&
        (await dev.ch.image({ name: "shot.png", mime: "image/png", ref: { id: String(image.getAttribute("id")), key: String(image.getAttribute("key")), size: Number(image.getAttribute("size")) } })),
    ).toBe(png);
  });

  test("send --re writes its block too, and its message stays a reply; a reply without a doc stays a plain message (T1256)", async () => {
    const asked = await run(dev.send("ready?"));
    const seq = await run(dev.sendToDoc("ready", { key: "main", th: general.th }, { re: [asked] }));
    const m = await message(seq);
    expect(m.re).toEqual([asked]);
    expect((await blockOf(m))?.text).toBe("ready");
    const plain = await message(await run(dev.reply(asked, "no doc here")));
    expect(plain.block).toBeUndefined();
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
