import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@kiwi/core/protocol.ts";
import { attachToBlock, blocksOf, markPosted, newBlock } from "@kiwi/core/doc/blocks.ts";
import type { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import { fileDocStore } from "@kiwi/core/node/doc-store.ts";
import * as Y from "yjs";
import { docsDir, saveIdentity, updateConfig } from "../src/config.ts";
import { startRelay } from "../src/relay/bun.ts";
import { addressed } from "../src/agent/docs.ts";
import { joinAgent, kiwiCmd, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-doc-send-relay-"));
const agent = mkdtempSync(join(tmpdir(), "kiwi-doc-send-agent-"));
const was = process.env.KIWI_HOME;
process.env.KIWI_HOME = agent;
const stop = new AbortController();
let server: ReturnType<typeof startRelay>;
let owner: OwnerSetup;
let general: ThreadDoc;
let devId: Identity;
const procs: { kill: () => void }[] = [];

const env = () => ({ ...process.env, KIWI_HOME: agent, KIWI_RELAY: server.url.origin, KIWI_NO_HOOKS: "1", KIWI_CHANNEL: "docsend", KIWI_AS: "dev" });

async function cli(...args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(kiwiCmd(args), { cwd: agent, env: env(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  procs.push(p);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}

const message = async (pred: (m: Message) => boolean): Promise<Message> => {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const m = (await owner.ownerCh.history(0)).messages.find(pred);
    if (m) return m;
    await Bun.sleep(100);
  }
  throw new Error("no such message");
};

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  owner = await setupChannel(server.url.origin, { ownerName: "jon" });
  await new Promise<void>((done) => void owner.ownerCh.stream(0, () => {}, { signal: stop.signal, onReady: () => done() }));
  general = await owner.ownerCh.threadDoc("main");
  await general.whenSynced();
  const computer = await pairComputer(owner.person);
  const dev = await joinAgent(owner, "dev", computer);
  await joinAgent(owner, "rev", computer);
  devId = dev.id;
  saveIdentity(dev.id, owner.roomId);
  updateConfig((c) => {
    c.channels.docsend = { ...dev.ch.access, relay: server.url.origin, code: owner.code, as: "dev" };
  });
});

afterAll(() => {
  for (const p of procs) p.kill();
  stop.abort();
  server.stop(true);
  if (was === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = was;
  for (const d of [dataDir, agent]) rmSync(d, { recursive: true, force: true });
});

describe("kiwi send and reply write their line into the shared doc (T1353)", () => {
  test("send into #general and a reply to a #general message both carry a block in #general's doc", async () => {
    const sending = await cli("send", "--to", "#general", "CLI-SEND hello");
    expect(sending).toMatchObject({ code: 0 });
    expect(sending.out).toContain("into its shared doc");
    const sent = await message((m) => m.body.includes("CLI-SEND"));
    const replying = await cli("reply", String(sent.seq), "CLI-REPLY ok");
    expect(replying).toMatchObject({ code: 0 });
    expect(replying.out).toMatch(/^sent #\d+/);
    const replied = await message((m) => m.body.includes("CLI-REPLY"));
    expect({ send: sent.block?.th, reply: replied.block?.th }).toEqual({ send: general.th, reply: general.th });
    const deadline = Date.now() + 5_000;
    const inDoc = () =>
      blocksOf(general.doc)
        .filter((b) => b.posted && /CLI-(SEND|REPLY)/.test(b.text))
        .map((b) => b.id);
    while (inDoc().length < 2 && Date.now() < deadline) await Bun.sleep(50);
    expect(inDoc().sort()).toEqual([sent.block!.id, replied.block!.id].sort());
  });
});

describe("kiwi send into a doc: what lands in the line and what it's told (T1353)", () => {
  test("who it's for leads the line as @handles; everyone, a role and a name already in it don't", () => {
    expect(addressed("hi", ["all"])).toBe("hi");
    expect(addressed("hi", ["Everyone", "*"])).toBe("hi");
    expect(addressed("hi", ["role:reviewer", "rev"])).toBe("@rev hi");
    expect(addressed("hi @rev", ["rev", "dev"])).toBe("@dev hi @rev");
    expect(addressed("hi", undefined)).toBe("hi");
  });

  test("--to all over the CLI writes no @all into the line; a member's name still leads it", async () => {
    for (const [to, said] of [
      ["all", "TO-ALL hello"],
      ["rev", "TO-NAME hello"],
    ] as const)
      expect(await cli("send", "--to", to, said)).toMatchObject({ code: 0 });
    const bodies = await Promise.all(["TO-ALL", "TO-NAME"].map(async (t) => (await message((m) => m.body.includes(t))).body));
    expect(bodies).toEqual(["TO-ALL hello", "@rev TO-NAME hello"]);
  });

  test("a long send into #general's doc gets the same 'ran long' note as one that isn't", async () => {
    const long = Array.from({ length: 12 }, (_, i) => `LONG line ${i}`).join("\n");
    const viaDoc = await cli("send", "--to", "#general", long);
    expect(viaDoc.out).toContain("into its shared doc");
    expect(viaDoc.out).toContain("ran long for #general");
  });
});

describe("an image pasted in the doc reaches agents through show and save (T2037)", () => {
  test("a line the app posted with only a block ref: kiwi show and save fetch its image and file", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const img = await owner.ownerCh.putImage({ name: "image.webp", mime: "image/png", data: png });
    const file = await owner.ownerCh.putFileData("trace.log", "text/plain", Buffer.from("line one\n").toString("base64"));
    const line = newBlock(general.doc, "text", "jon", "@dev PASTED look at this");
    attachToBlock(general.doc, line.id, [{ image: { name: img.name, mime: img.mime, ref: img.ref! } }, { file }]);
    markPosted(general.doc, line.id);
    await general.flush();
    const seq = await owner.ownerCh.send("@dev PASTED look at this\n[image: image.webp]\n[file: trace.log]", { to: ["dev"], block: { th: general.th, id: line.id } });
    const posted = await message((m) => m.seq === seq);
    expect(posted.imgs).toBeUndefined();

    const dir = mkdtempSync(join(tmpdir(), "kiwi-doc-media-"));
    try {
      const shown = await cli("show", String(seq), join(dir, "shown"));
      expect(shown.code).toBe(0);
      expect(existsSync(join(dir, "shown", `#${seq}-image.webp`))).toBe(true);
      expect(shown.out.match(/\[image: image\.webp/g)).toHaveLength(1);
      expect(shown.out.match(/\[file: trace\.log/g)).toHaveLength(1);
      expect(shown.out).toContain(`images saved: ${join(dir, "shown", `#${seq}-image.webp`)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("kiwi send keeps a sealed copy of the thread's doc, so the next send fetches only what's new (#3909)", () => {
  const kept = async (): Promise<string[]> => {
    const saved = await fileDocStore(docsDir(owner.roomId, "dev"), { roomId: owner.roomId, sk: devId.sk }).load(general.th);
    if (!saved) return [];
    expect(saved.unsent).toBeNull();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, saved.state);
    return blocksOf(doc).flatMap((b) => (/KEPT/.test(b.text) ? [b.text] : []));
  };

  test("after a send the seat's copy holds the line, and a torn copy is fetched again", async () => {
    expect(await cli("send", "--to", "#general", "KEPT one")).toMatchObject({ code: 0 });
    expect(await kept()).toEqual(["KEPT one"]);
    writeFileSync(join(docsDir(owner.roomId, "dev"), `${general.th}.doc`), "torn");
    expect(await cli("send", "--to", "#general", "KEPT two")).toMatchObject({ code: 0 });
    await message((m) => m.body.includes("KEPT two"));
    expect(await kept()).toEqual(["KEPT one", "KEPT two"]);
  });
});
