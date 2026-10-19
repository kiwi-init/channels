import { kiwiCmd } from "./owner.ts";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(90_000);

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-mimo-restart-${tag}-`));
  made.push(d);
  return d;
};
const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch("relay") });
const relay = server.url.origin;
const saved = new Map<string, string | undefined>();

afterAll(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete (globalThis as { __kiwi?: unknown }).__kiwi;
  server.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

type Env = Record<string, string>;

function spawn(home: string, args: string[], env: Env) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_MODEL: "test-model", ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, args: string[], env: Env): Promise<string> {
  const p = spawn(home, args, env);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")} failed: ${err}`);
  return out;
}

async function until(label: string, pred: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

type Prompted = { path: { id: string }; body: { parts: { type: string; text: string }[] } };
type Client = { session: { get: () => Promise<{ data: object }>; promptAsync: (o: Prompted) => Promise<unknown> } };
type Hooks = {
  "shell.env": (input: { cwd?: string; sessionID?: string }, output: { env: Record<string, string> }) => Promise<void>;
  event: (input: { event: { type: string; properties?: { info?: { id?: string } } } }) => Promise<void>;
};

async function boot(file: string, client: Client): Promise<Hooks> {
  const mod = (await import(file)) as { KiwiPlugin: (input: { client: Client }) => Promise<Hooks> };
  return mod.KiwiPlugin({ client });
}

const PERSON = { CLAUDECODE: "", MIMOCODE: "" };

test("a wake MiMoCode never took, when MiMoCode exits mid-retry and the session resumes, reaches the resumed session instead of being skipped", async () => {
  const owner = scratch("owner");
  const agent = scratch("agent");
  const mimoDir = scratch("mimo");
  const session = "ses_resumed";
  const S = { CLAUDECODE: "", MIMOCODE: "1", MIMOCODE_SESSION_ID: session, MIMOCODE_PID: "", KIWI_MIMO_DIR: mimoDir };
  const code = /join code: (\S+)/.exec(await ok(owner, ["create", "restart", "--as", "boss"], PERSON))![1]!;
  const joining = spawn(agent, ["join", code, "--as", "coder", "--timeout", "40s"], S);
  let listed = "";
  await until("the join request", async () => /\d{3}-\d{3}/.test((listed = await ok(owner, ["--as", "boss", "requests"], PERSON))));
  await ok(owner, ["--as", "boss", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"], PERSON);
  expect(await joining.exited).toBe(0);
  await ok(agent, ["hooks", "install", "mimo"], S);
  const plugin = join(mimoDir, "plugin", "kiwi.ts");
  expect(existsSync(plugin)).toBe(true);

  for (const [k, v] of Object.entries({ ...S, KIWI_HOME: agent, KIWI_RELAY: relay, KIWI_MODEL: "test-model" })) {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    process.env[k] = v;
  }

  const refused: string[] = [];
  const before = await boot(plugin, {
    session: {
      get: async () => ({ data: {} }),
      promptAsync: async (o) => {
        refused.push(o.body.parts.map((p) => p.text).join(""));
        throw new Error("connection refused");
      },
    },
  });
  await before["shell.env"]({ cwd: agent, sessionID: session }, { env: {} });
  await ok(owner, ["--as", "boss", "send", "--to", "coder", "the message MiMoCode never took"], PERSON);
  await until("the refused wake", () => refused.length >= 1);
  expect(refused[0]).toContain("the message MiMoCode never took");

  await before.event({ event: { type: "session.deleted", properties: { info: { id: session } } } });
  delete (globalThis as { __kiwi?: unknown }).__kiwi;
  await ok(owner, ["--as", "boss", "send", "--to", "coder", "sent while MiMoCode was down"], PERSON);

  const restarted = join(mimoDir, "plugin", "kiwi-restarted.ts");
  copyFileSync(plugin, restarted);
  const woke: string[] = [];
  const after = await boot(restarted, {
    session: {
      get: async () => ({ data: {} }),
      promptAsync: async (o) => {
        woke.push(o.body.parts.map((p) => p.text).join(""));
        return { data: true };
      },
    },
  });
  await after["shell.env"]({ cwd: agent, sessionID: session }, { env: {} });
  await until("the resumed session's first wake", () => woke.length >= 1);
  expect(woke[0]).toContain("the message MiMoCode never took");
  expect(woke[0]).toContain("sent while MiMoCode was down");

  await ok(owner, ["--as", "boss", "send", "--to", "coder", "after the wake landed"], PERSON);
  await until("the next wake", () => woke.length >= 2);
  expect(woke[1]).toContain("after the wake landed");
  expect(woke[1]).not.toContain("the message MiMoCode never took");
  await after.event({ event: { type: "session.deleted", properties: { info: { id: session } } } });
});
