import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@kiwi/core/protocol.ts";
import { blocksOf } from "@kiwi/core/doc/blocks.ts";
import type { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import { saveIdentity, updateConfig } from "../src/config.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, kiwiCmd, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-mcp-doc-relay-"));
const agent = mkdtempSync(join(tmpdir(), "kiwi-mcp-doc-agent-"));
const was = process.env.KIWI_HOME;
process.env.KIWI_HOME = agent;
const stop = new AbortController();
let server: ReturnType<typeof startRelay>;
let owner: OwnerSetup;
let general: ThreadDoc;
const procs: { kill: () => void }[] = [];

const env = () => ({ ...process.env, KIWI_HOME: agent, KIWI_RELAY: server.url.origin, KIWI_NO_HOOKS: "1", KIWI_CHANNEL: "mcpdoc", KIWI_AS: "dev" });

async function cli(...args: string[]): Promise<number> {
  const p = Bun.spawn(kiwiCmd(args), { cwd: agent, env: env(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  procs.push(p);
  return await p.exited;
}

function mcp() {
  const p = Bun.spawn(kiwiCmd(["mcp"]), { cwd: agent, env: env(), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  procs.push(p);
  const reader = p.stdout.getReader();
  let buf = "";
  let id = 0;
  const rpc = async (method: string, params: object = {}): Promise<unknown> => {
    const mine = ++id;
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mine, method, params }) + "\n");
    p.stdin.flush();
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const msg = JSON.parse(buf.slice(0, nl)) as { id?: number; result?: unknown; error?: unknown };
        buf = buf.slice(nl + 1);
        if (msg.id === mine) return msg.result ?? msg.error;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("mcp exited");
      buf += new TextDecoder().decode(value);
    }
  };
  const call = async (name: string, args: object = {}): Promise<string> => ((await rpc("tools/call", { name, arguments: args })) as { content: { text: string }[] }).content[0]!.text;
  const start = async () => {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    p.stdin.flush();
  };
  return { call, start, stop: () => p.kill() };
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
  const dev = await joinAgent(owner, "dev", await pairComputer(owner.person));
  saveIdentity(dev.id, owner.roomId);
  updateConfig((c) => {
    c.channels.mcpdoc = { ...dev.ch.access, relay: server.url.origin, code: owner.code, as: "dev" };
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

describe("MCP send and reply write their line into the shared doc, like the CLI (T1353)", () => {
  test("send into #general and a reply to a #general message both carry a block in #general's doc", async () => {
    expect(await cli("send", "--to", "#general", "CLI-SEND hello")).toBe(0);
    const asked = await message((m) => m.body.includes("CLI-SEND"));
    expect(asked.block?.th).toBe(general.th);

    const agentMcp = mcp();
    try {
      await agentMcp.start();
      expect(await agentMcp.call("send", { text: "MCP-SEND hello", main: true })).toContain("into its shared doc");
      expect(await agentMcp.call("reply", { seq: asked.seq, text: "MCP-REPLY ok" })).toMatch(/^sent #\d+/);
    } finally {
      agentMcp.stop();
    }
    const sent = await message((m) => m.body.includes("MCP-SEND"));
    const replied = await message((m) => m.body.includes("MCP-REPLY"));
    expect({ send: sent.block?.th, reply: replied.block?.th }).toEqual({ send: general.th, reply: general.th });
    const deadline = Date.now() + 5_000;
    const inDoc = () =>
      blocksOf(general.doc)
        .filter((b) => b.posted && /MCP-(SEND|REPLY)/.test(b.text))
        .map((b) => b.id);
    while (inDoc().length < 2 && Date.now() < deadline) await Bun.sleep(50);
    expect(inDoc().sort()).toEqual([sent.block!.id, replied.block!.id].sort());
  });
});
