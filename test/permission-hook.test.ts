import { joinAgent, joinPerson, kiwiCmd, pairComputer, setupChannel } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { permissionReply } from "@kiwi/core/permission.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { saveIdentity, updateConfig } from "../src/config.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(90_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-permission-relay-"));
const agent = mkdtempSync(join(tmpdir(), "kiwi-permission-agent-"));
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
const SESSION = "4b1f8c1e-0000-4000-8000-00000000a11e";
const CWD = "/Users/ada/src/app";
let human: Channel;
let owner: Channel;

function spawn(home: string, args: string[], env: Record<string, string> = {}, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1", ...env },
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function until<T>(get: () => Promise<T | undefined>, label: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await get();
    if (got !== undefined) return got;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(700);
  }
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  const s = await setupChannel(relay, { ownerName: "ada" });
  const bea = await generateIdentity("bea-person");
  human = (await joinPerson(s, "bea", bea)).ch;
  owner = s.ownerCh;
  const dev = await joinAgent(s, "dev", await pairComputer(bea));
  const was = process.env.KIWI_HOME;
  process.env.KIWI_HOME = agent;
  try {
    saveIdentity(dev.id, s.roomId);
    updateConfig((c) => {
      c.channels.perm = { ...dev.ch.access, relay, code: s.code, as: "dev" };
      c.bindings = { ...c.bindings, [agent]: { alias: "perm", as: "dev", harness: "claude", session: SESSION, at: Date.now() } };
    });
  } finally {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
  }
});

afterAll(() => {
  server?.stop(true);
  for (const d of [dataDir, agent]) rmSync(d, { recursive: true, force: true });
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
    JSON.stringify({ session_id: SESSION, transcript_path: transcript, cwd: CWD, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: input, ...extra }),
  );
  const out = new Response(hook.stdout).text();
  const err = new Response(hook.stderr).text();
  return {
    err,
    id,
    transcript,
    hook,
    result: async () => ({ code: await hook.exited, out: await out }),
  };
}

const theAsk = (p: { hook: { exitCode: number | null }; err: Promise<string> }, command: string) =>
  until(async () => {
    if (p.hook.exitCode !== null) throw new Error(`the hook exited ${p.hook.exitCode} before asking: ${await p.err}`);
    return (await human.history(0)).messages.find((m: Message) => m.from === "dev" && m.permission?.command === command);
  }, `the ask for ${command}`);

const answer = (ask: Message, allow: boolean, by: Channel = human, perm = true) =>
  by.send(allow ? "A: Allow once" : "B: Deny", { to: [ask.from], re: [ask.seq], ...(perm ? { perm: permissionReply(ask, allow)! } : {}) });

describe("kiwi hook permission", () => {
  test("asks the agent's human with the call's id, and their signed Allow comes back as Claude Code's allow", async () => {
    const p = promptFor("touch allowed.txt");
    const ask = await theAsk(p, "touch allowed.txt");
    expect(ask.esc).toBe(true);
    expect(ask.to).toEqual(["bea", "ada"]);
    expect(ask.choices).toEqual(["A: Allow once", "B: Deny"]);
    expect(ask.permission).toMatchObject({ tool: "Bash", cwd: CWD, call: p.id, canAllow: true });
    await answer(ask, true);
    expect(await p.result()).toEqual({ code: 0, out: JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } }) });
  });

  test("a Deny tells Claude who denied it", async () => {
    const p = promptFor("touch denied.txt");
    await answer(await theAsk(p, "touch denied.txt"), false);
    const { out } = await p.result();
    expect(JSON.parse(out)).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Denied from the Kiwi app by bea" } } });
  });

  test("the owner can Deny but not Allow a call on someone else's computer", async () => {
    const p = promptFor("touch owners.txt");
    const ask = await theAsk(p, "touch owners.txt");
    await answer(ask, true, owner);
    await Bun.sleep(1_500);
    expect(p.hook.exitCode).toBeNull();
    await answer(ask, false, owner);
    expect(JSON.parse((await p.result()).out).hookSpecificOutput.decision).toEqual({ behavior: "deny", message: "Denied from the Kiwi app by ada" });
  });

  test("a plain-text 'A: Allow once' without the signed answer field is ignored; answered in the terminal, the hook says nothing and closes the ask", async () => {
    const p = promptFor("touch typed.txt");
    const ask = await theAsk(p, "touch typed.txt");
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
