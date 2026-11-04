import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docWakeToolLine } from "../src/agent/docs.ts";
import { addDocWake, pendingDocWakes, type DocWakeItem } from "../src/config/doc-wakes.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(120_000);

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-docmcp-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const owner = scratch("owner");
const agent = scratch("agent");
let server: ReturnType<typeof startRelay> | undefined;

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: server!.url.origin, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

async function until(pred: () => Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

function asAgent<T>(fn: () => T): T {
  const was = process.env.KIWI_HOME;
  process.env.KIWI_HOME = agent;
  try {
    return fn();
  } finally {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
  }
}

const wake = (block: string, key: string, text: string): DocWakeItem => ({ key, th: "a".repeat(22), block, author: "lead", text, context: "", selection: null, at: Date.now() });

function mcp() {
  const p = Bun.spawn(kiwiCmd(["mcp"]), {
    cwd: agent,
    env: { ...process.env, KIWI_HOME: agent, KIWI_RELAY: server!.url.origin, KIWI_NO_HOOKS: "1", KIWI_CHANNEL: "docmcp", KIWI_AS: "dev" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
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
  const call = async (name: string, args: object = {}) => ((await rpc("tools/call", { name, arguments: args })) as { content: { text: string }[] }).content[0]!.text;
  const start = async () => {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    p.stdin.flush();
  };
  return { call, start, stop: () => p.kill() };
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "docmcp", "--as", "lead", "--open"))![1]!;
  const joining = spawn(agent, ["join", code, "--as", "dev"]);
  let listed = "";
  await until(async () => {
    listed = await ok(owner, "--as", "human", "requests");
    return /\d{3}-\d{3}/.test(listed);
  }, "request");
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await joining.exited).toBe(0);
});

afterAll(() => {
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("doc wakes reach an agent on the MCP server (T668)", () => {
  test("wait_for_messages returns a queued block once, with the send call that answers it in the doc", async () => {
    const m = mcp();
    try {
      await m.start();
      await m.call("read");
      asAgent(() => addDocWake("docmcp", "dev", wake("b1", "task:7", "can you look at the parser?")));
      const got = await m.call("wait_for_messages", { timeout_seconds: 10 });
      expect(got).toContain("lead in T7's shared doc: can you look at the parser?");
      expect(got).toContain('answer in the doc: send {"text":"…","task":"T7"}');
      expect(asAgent(() => pendingDocWakes("docmcp", "dev"))).toEqual([]);
      expect(await m.call("wait_for_messages", { timeout_seconds: 2 })).toStartWith("no messages yet");
    } finally {
      m.stop();
    }
  });

  test("a block in #general is answered with main", () => {
    expect(docWakeToolLine(wake("b2", "main", "hi all"))).toContain('send {"text":"…","main":true}');
  });
});
