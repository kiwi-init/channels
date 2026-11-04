import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import * as Y from "yjs";
import { blocksOf, markBack, markPosted, markSent, newBlock, newDocId } from "@kiwi/core/doc/blocks.ts";
import { startRelay } from "../src/relay/bun.ts";
import { docOnlyText, docPlaceOf, readDoc, writeBlock } from "../src/agent/docs.ts";
import type { Place } from "@kiwi/core/state.ts";
import { setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(30_000);

describe("where a send goes: the doc of its place, when one is open (T570)", () => {
  const th = newDocId();
  const state: Parameters<typeof docPlaceOf>[0] = {
    docs: new Map([
      ["task:7", th],
      ["main", "m".repeat(22)],
    ]),
    placeOf: new Map<number, Place>([
      [20, { kind: "task", task: 7 }],
      [21, { kind: "task", task: 8 }],
      [22, { kind: "dm", with: ["jow", "lead"] }],
    ]),
    roomOf: new Map([[13, "design"]]),
  };
  test("a task thread and #general with a doc open take the block; a DM, another room or a thread without one don't", () => {
    expect(docPlaceOf(state, { task: 7 })).toEqual({ key: "task:7", th });
    expect(docPlaceOf(state, {})).toEqual({ key: "main", th: "m".repeat(22) });
    expect(docPlaceOf(state, { room: "General" })).toEqual({ key: "main", th: "m".repeat(22) });
    expect(docPlaceOf(state, { task: 8 })).toBeNull();
    expect(docPlaceOf(state, { dm: true })).toBeNull();
    expect(docPlaceOf(state, { room: "design" })).toBeNull();
    expect(docPlaceOf({ docs: new Map(), placeOf: new Map(), roomOf: new Map() }, {})).toBeNull();
  });

  test("a reply goes into the doc of the thread its message is in, wherever the sender stands (T1256)", () => {
    expect(docPlaceOf(state, { re: [12] })).toEqual({ key: "main", th: "m".repeat(22) });
    expect(docPlaceOf(state, { re: [20] })).toEqual({ key: "task:7", th });
    expect(docPlaceOf(state, { task: 7, re: [12] })).toEqual({ key: "main", th: "m".repeat(22) });
    expect(docPlaceOf(state, { re: [21] })).toBeNull();
    expect(docPlaceOf(state, { re: [22] })).toBeNull();
    expect(docPlaceOf(state, { re: [13] })).toBeNull();
    expect(docPlaceOf(state, { re: [12], room: "design" })).toBeNull();
    expect(docPlaceOf(state, { re: [20], room: "design" })).toEqual({ key: "task:7", th });
  });
});

describe("kiwi log's doc part: lines written only in the doc (T1353)", () => {
  test("a finished line shows; a half-typed draft, a line given back and an empty block don't", () => {
    const doc = new Y.Doc();
    markPosted(doc, newBlock(doc, "text", "jow", "ship it").id);
    markSent(doc, newBlock(doc, "text", "rodrigo", "@olivia sent with Enter").id);
    newBlock(doc, "text", "olivia", "from an older app");
    newBlock(doc, "text", "olivia", "and a second line");
    const back = newBlock(doc, "text", "lead", "given back").id;
    markBack(doc, back);
    newBlock(doc, "text", "lead", "after it");
    markSent(doc, newBlock(doc, "text", "rodrigo", "   ").id);
    newBlock(doc, "text", "jow", "actually don't ship, the rel");
    expect(docOnlyText(doc)).toBe("rodrigo: @olivia sent with Enter\n\nolivia: from an older app");
  });
});

describe("the CLI writes and reads a thread's doc over the live socket (T570)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-doc-cli-"));
  let server: ReturnType<typeof startRelay>;
  let s: OwnerSetup;
  const stop = new AbortController();

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    s = await setupChannel(server.url.origin, { ownerName: "lead" });
    await new Promise<void>((done) => void s.ownerCh.stream(0, () => {}, { signal: stop.signal, onReady: () => done() }));
  });
  afterAll(() => {
    stop.abort();
    server.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a one-shot client writes its answer as its own agent block, and reads the thread as text", async () => {
    const open = await s.ownerCh.threadDoc("task:7");
    await open.whenSynced();
    newBlock(open.doc, "text", "jow", "@lead how far is the relay?");
    await open.flush();

    const cli = new Channel(s.access, s.relay, s.owner);
    const at = { key: "task:7", th: open.th };
    const id = await writeBlock(cli, 0, at, "lead", "Merged.\nNext: the CLI.", true);
    const deadline = Date.now() + 5_000;
    while (!blocksOf(open.doc).some((b) => b.id === id) && Date.now() < deadline) await Bun.sleep(20);
    expect(blocksOf(open.doc).find((b) => b.id === id)).toMatchObject({ kind: "agent", author: "lead", text: "Merged.\nNext: the CLI." });

    const text = await readDoc(new Channel(s.access, s.relay, s.owner), 0, at);
    expect(text).toBe("jow: @lead how far is the relay?\n\nlead (agent): Merged.\nNext: the CLI.");
    expect(await writeBlock(new Channel(s.access, s.relay, s.owner), 0, at, "jow", "thanks", false)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await Bun.sleep(100);
    expect(blocksOf(open.doc).at(-1)).toMatchObject({ kind: "text", author: "jow", text: "thanks" });
  });

  test("an image and a file for a doc are stored sealed, and come back by their reference alone (T580)", async () => {
    const cli = new Channel(s.access, s.relay, s.owner);
    const png = Buffer.from("not really a png but bytes all the same").toString("base64");
    const img = await cli.putImage({ name: "shot.png", mime: "image/png", data: png });
    expect(img.data).toBeUndefined();
    expect(img.ref?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(await new Channel(s.access, s.relay, s.owner).image({ name: img.name, mime: img.mime, ref: img.ref! })).toBe(png);
    const log = Buffer.from("line one\nline two\n").toString("base64");
    const file = await cli.putFileData("trace.log", "text/plain", log);
    expect(file.pieces).toHaveLength(1);
    expect(await new Channel(s.access, s.relay, s.owner).fileData(file)).toBe(log);
    await expect(cli.putImage({ name: "big.png", mime: "image/png", data: Buffer.alloc(300 * 1024).toString("base64") })).rejects.toThrow(/at most 256 KB/);
  });

  test("a relay that never answers fails within the wait instead of hanging", async () => {
    const quiet = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 503 }) });
    try {
      const cli = new Channel(s.access, quiet.url.origin, s.owner);
      const started = Date.now();
      await expect(readDoc(cli, 0, { key: "task:7", th: newDocId() }, 500)).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      quiet.stop(true);
    }
  });
});
