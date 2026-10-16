import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { sum, trafficProxy } from "./traffic.ts";

setDefaultTimeout(120_000);

const CALLS = 6;
const BUDGET = { sockets: 1, http: 7 } as const;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-budget-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;

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

const owner = scratch("owner");
const agent = scratch("agent");

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "budget", "--as", "lead", "--open"))![1]!;
  const joining = spawn(agent, ["join", code, "--as", "dev"]);
  let listed = "";
  await until(async () => {
    listed = await ok(owner, "--as", "human", "requests");
    return /\d{3}-\d{3}/.test(listed);
  }, "request");
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await joining.exited).toBe(0);
  const path = join(agent, "config.json");
  const cfg = JSON.parse(readFileSync(path, "utf8")) as { channels: Record<string, { relay: string }> };
  for (const c of Object.values(cfg.channels)) c.relay = proxy.url;
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
});

afterAll(() => {
  proxy?.stop();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("relay traffic of an MCP agent looping on wait_for_messages", () => {
  test(`${CALLS} short waits with one message in the middle: one socket, the message once`, async () => {
    const p = Bun.spawn(kiwiCmd(["mcp"]), {
      cwd: agent,
      env: { ...process.env, KIWI_HOME: agent, KIWI_RELAY: proxy!.url, KIWI_NO_HOOKS: "1", KIWI_CHANNEL: "budget", KIWI_AS: "dev" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const reader = p.stdout.getReader();
      let buf = "";
      let id = 0;
      const rpc = async (method: string, params: object = {}): Promise<unknown> => {
        const myId = ++id;
        p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
        p.stdin.flush();
        for (;;) {
          const nl = buf.indexOf("\n");
          if (nl >= 0) {
            const msg = JSON.parse(buf.slice(0, nl)) as { id?: number; result?: unknown; error?: unknown };
            buf = buf.slice(nl + 1);
            if (msg.id === myId) return msg.result ?? msg.error;
            continue;
          }
          const { value, done } = await reader.read();
          if (done) throw new Error("mcp exited");
          buf += new TextDecoder().decode(value);
        }
      };
      const call = async (name: string, args: object = {}) => ((await rpc("tools/call", { name, arguments: args })) as { content: { text: string }[] }).content[0]!.text;
      await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      await call("read");

      await Bun.sleep(200);
      proxy!.reset();
      const results: string[] = [];
      for (let i = 0; i < CALLS; i++) {
        const waiting = call("wait_for_messages", { timeout_seconds: 1 });
        if (i === Math.floor(CALLS / 2)) {
          await Bun.sleep(300);
          await ok(owner, "--as", "lead", "send", "--to", "dev", "the one in the middle");
        }
        results.push(await waiting);
      }
      await Bun.sleep(200);
      const t = proxy!.reset();
      console.log(`mcp ${CALLS}x wait_for_messages: ${t.http} http ${JSON.stringify(t.routes)}, ${t.sockets} sockets, ${sum(t.framesDown)} frames down, ${t.bytesUp} B up, ${t.bytesDown} B down`);

      const hits = results.join("\n").split("the one in the middle").length - 1;
      expect(hits).toBe(1);
      expect(results.filter((r) => r.startsWith("no messages yet")).length).toBe(CALLS - 1);
      expect(t.sockets).toBeLessThanOrEqual(BUDGET.sockets);
      expect(t.http).toBeLessThanOrEqual(BUDGET.http);
    } finally {
      p.kill();
    }
  });
});
