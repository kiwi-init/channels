import { kiwiCmd } from "./owner.ts";
import { afterAll, afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliveredUpTo } from "../src/hooks/delivered.ts";
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

afterEach(() => {
  delete (globalThis as { __kiwi?: unknown }).__kiwi;
});

afterAll(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
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

function textOf(o: Prompted): string {
  return o.body.parts.map((p) => p.text).join("");
}

const PERSON = { CLAUDECODE: "", MIMOCODE: "" };

async function seatInMimo(channel: string, session: string): Promise<{ owner: string; agent: string; plugin: string; copy: (name: string) => string }> {
  const owner = scratch("owner");
  const agent = scratch("agent");
  const mimoDir = scratch("mimo");
  const S = { CLAUDECODE: "", MIMOCODE: "1", MIMOCODE_SESSION_ID: session, MIMOCODE_PID: "", KIWI_MIMO_DIR: mimoDir };
  const code = /join code: (\S+)/.exec(await ok(owner, ["create", channel, "--as", "boss"], PERSON))![1]!;
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
  const copy = (name: string) => {
    const file = join(scratch(name), "kiwi.ts");
    copyFileSync(plugin, file);
    return file;
  };
  return { owner, agent, plugin, copy };
}

test("a wake MiMoCode never took, when MiMoCode exits mid-retry and the session resumes, reaches the resumed session instead of being skipped", async () => {
  const session = "ses_resumed";
  const { owner, agent, plugin, copy } = await seatInMimo("restart", session);

  const refused: string[] = [];
  const before = await boot(plugin, {
    session: {
      get: async () => ({ data: {} }),
      promptAsync: async (o) => {
        refused.push(textOf(o));
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

  const woke: string[] = [];
  const after = await boot(copy("kiwi-restarted"), {
    session: {
      get: async () => ({ data: {} }),
      promptAsync: async (o) => {
        woke.push(textOf(o));
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

test("a wake handed to MiMoCode is logged in wake.log, and the refusals before it landed are logged with their reason", async () => {
  const session = "ses_logged";
  const { owner, agent, plugin } = await seatInMimo("logged", session);
  let tries = 0;
  const woke: string[] = [];
  const hooks = await boot(plugin, {
    session: {
      get: async () => ({ data: {} }),
      promptAsync: async (o) => {
        tries += 1;
        if (tries <= 2) throw new Error("connection refused");
        woke.push(textOf(o));
        return { data: true };
      },
    },
  });
  const log = join(agent, "wake.log");
  const rows = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split("\t"))
      : [];
  try {
    await hooks["shell.env"]({ cwd: agent, sessionID: session }, { env: {} });
    await ok(owner, ["--as", "boss", "send", "--to", "coder", "logged once it lands"], PERSON);
    await until("the wake that landed", () => woke.length === 1);
    await until("the refusals logged", () => rows().some((r) => r[5] === "failed"));
    const [handed, failed] = rows();
    expect(handed?.slice(1, 6)).toEqual(["logged", "coder", "mimo-plugin", "1", "handed"]);
    expect(failed?.slice(1, 6)).toEqual(["logged", "coder", "mimo-plugin", "0", "failed"]);
    expect(failed?.[6]).toBe("MiMoCode refused the wake 2 times before it landed: connection refused");
  } finally {
    await hooks.event({ event: { type: "session.deleted", properties: { info: { id: session } } } });
  }
});

test("two MiMoCode processes on one session, each landing its wake of the same message, count it delivered once instead of handing it back and forth", async () => {
  const session = "ses_twice";
  const { owner, agent, plugin, copy } = await seatInMimo("twice", session);
  const calls: { from: string; text: string; land: () => void }[] = [];
  const holding = (from: string): Client => ({
    session: {
      get: async () => ({ data: {} }),
      promptAsync: (o) => new Promise((resolve) => void calls.push({ from, text: textOf(o), land: () => resolve({ data: true }) })),
    },
  });
  const first = await boot(plugin, holding("first"));
  let second: Hooks | null = null;
  try {
    await first["shell.env"]({ cwd: agent, sessionID: session }, { env: {} });
    await ok(owner, ["--as", "boss", "send", "--to", "coder", "one message, two processes"], PERSON);
    await until("the first process's wake", () => calls.length === 1);
    delete (globalThis as { __kiwi?: unknown }).__kiwi;
    second = await boot(copy("kiwi-second"), holding("second"));
    await second["shell.env"]({ cwd: agent, sessionID: session }, { env: {} });
    await until("the second process's wake", () => calls.length === 2);
    expect(calls.map((c) => c.from)).toEqual(["first", "second"]);
    for (const c of calls) expect(c.text).toContain("one message, two processes");

    calls[0]!.land();
    await until("the first landed wake counted delivered", () => deliveredUpTo("twice", "coder", session) > 0);
    calls[1]!.land();
    await Bun.sleep(1_500);
    expect(calls).toHaveLength(2);
  } finally {
    await first.event({ event: { type: "session.deleted", properties: { info: { id: session } } } });
    await second?.event({ event: { type: "session.deleted", properties: { info: { id: session } } } });
    for (const c of calls) c.land();
  }
});
