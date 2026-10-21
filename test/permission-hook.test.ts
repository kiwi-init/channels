import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { loadConfig, loadIdentity } from "../src/config.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(90_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-permission-relay-"));
const made: string[] = [dataDir];
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-permission-${tag}-`));
  made.push(d);
  return d;
};

const owner = scratch("owner");
const agent = scratch("agent");
const SESSION = "4b1f8c1e-0000-4000-8000-00000000a11e";
let human: Channel;

function spawn(home: string, args: string[], env: Record<string, string> = {}, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1", ...env },
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
  return out;
}

async function until<T>(get: () => Promise<T | undefined>, label: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await get();
    if (got !== undefined) return got;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(100);
  }
}

function asOwner<T>(f: () => T): T {
  const was = process.env.KIWI_HOME;
  process.env.KIWI_HOME = owner;
  try {
    return f();
  } finally {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
  }
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "perm", "--as", "lead", "--open"))![1]!;
  const joining = spawn(agent, ["join", code, "--as", "dev", "--model", "claude-opus-5-5"], { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: SESSION });
  const listed = await until(async () => {
    const out = await ok(owner, "--as", "human", "requests");
    return /\d{3}-\d{3}/.test(out) ? out : undefined;
  }, "the join request");
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await joining.exited).toBe(0);
  const cfg = asOwner(() => Object.values(loadConfig().channels)[0]!);
  const id = await asOwner(() => loadIdentity("human", cfg.roomId));
  human = new Channel(cfg, relay, id);
});

afterAll(() => {
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

let calls = 0;
function promptFor(command: string, extra: Record<string, unknown> = {}) {
  const transcript = join(agent, `t${calls}.jsonl`);
  const id = `toolu_${String(calls++).padStart(4, "0")}`;
  const input = { command, description: "Create a file" };
  writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { id: `msg_${id}`, content: [{ type: "tool_use", id, name: "Bash", input }] } }) + "\n");
  const hook = spawn(
    agent,
    ["hook", "permission"],
    { CLAUDE_PID: String(process.pid) },
    JSON.stringify({ session_id: SESSION, transcript_path: transcript, cwd: agent, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: input, ...extra }),
  );
  const out = new Response(hook.stdout).text();
  return {
    id,
    transcript,
    hook,
    result: async () => ({ code: await hook.exited, out: await out }),
  };
}

const theAsk = (command: string) =>
  until(async () => (await human.history(0)).messages.find((m: Message) => m.from === "dev" && m.permission?.command === command), `the ask for ${command}`);

const answer = (ask: Message, allow: boolean, by: Channel = human, perm = true) =>
  by.send(allow ? "A: Allow once" : "B: Deny", { to: [ask.from], re: [ask.seq], ...(perm ? { perm: { ask: ask.id, allow } } : {}) });

describe("kiwi hook permission", () => {
  test("asks the agent's human with the call's id, and their signed Allow comes back as Claude Code's allow", async () => {
    const p = promptFor("touch allowed.txt");
    const ask = await theAsk("touch allowed.txt");
    expect(ask.esc).toBe(true);
    expect(ask.to).toEqual(["human"]);
    expect(ask.choices).toEqual(["A: Allow once", "B: Deny"]);
    expect(ask.permission).toMatchObject({ tool: "Bash", cwd: agent, call: p.id, canAllow: true });
    await answer(ask, true);
    expect(await p.result()).toEqual({ code: 0, out: JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } }) });
  });

  test("a Deny tells Claude who denied it", async () => {
    const p = promptFor("touch denied.txt");
    await answer(await theAsk("touch denied.txt"), false);
    const { out } = await p.result();
    expect(JSON.parse(out)).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Denied from the Kiwi app by human" } } });
  });

  test("a plain-text 'A: Allow once' without the signed answer field is ignored; answered in the terminal, the hook says nothing and closes the ask", async () => {
    const p = promptFor("touch typed.txt");
    const ask = await theAsk("touch typed.txt");
    await answer(ask, true, human, false);
    await Bun.sleep(1_500);
    appendFileSync(p.transcript, JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: p.id, content: "(Bash completed with no output)" }] } }) + "\n");
    expect(await p.result()).toEqual({ code: 0, out: "" });
    const closing = await until(async () => (await human.history(0)).messages.find((m: Message) => m.from === "dev" && m.re?.includes(ask.seq) && m.settled !== undefined), "the closing reply");
    expect(closing.settled).toBe("terminal");
  });

  test("no seat recorded for the session, or a subagent's call, stays in the terminal without asking anyone", async () => {
    for (const extra of [{ session_id: "someone-elses-session" }, { agent_id: "sub-1" }]) {
      const p = promptFor(`touch quiet-${Object.keys(extra)[0]}.txt`, extra);
      expect(await p.result()).toEqual({ code: 0, out: "" });
    }
    const asked = (await human.history(0)).messages.filter((m: Message) => m.permission?.command?.startsWith("touch quiet"));
    expect(asked).toEqual([]);
  });
});
