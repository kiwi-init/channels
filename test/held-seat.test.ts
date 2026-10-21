import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config, SeatRecord } from "../src/config.ts";
import { daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { heldText } from "../src/hold.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(120_000);

type Env = Record<string, string>;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-held-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const claudeDir = scratch("claude");
const owner = scratch("owner");
const agent = scratch("agent");
let server: ReturnType<typeof startRelay> | undefined;
let me = "";
let alias = "";
let token = "";
const stand = Bun.spawn(["sleep", "600"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });

const PLAIN: Env = Object.fromEntries(
  [
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_PID",
    "CODEX_THREAD_ID",
    "GEMINI_CLI",
    "CURSOR_AGENT",
    "GROK_SESSION_ID",
    "OPENCODE_SESSION_ID",
    "MIMOCODE",
    "MIMOCODE_PID",
    "MIMOCODE_SESSION_ID",
    "PI_CODING_AGENT",
    "KIWI_PI_PID",
    "KIWI_PI_SESSION",
    "KIWI_AS",
    "KIWI_CHANNEL",
    "KIWI_SEAT_TOKEN",
  ].map((k) => [k, ""]),
);
const claude = (session: string, pid: number): Env => ({ ...PLAIN, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(pid), AI_AGENT: "claude-code_2-1-296_agent" });
const OLD = claude("old-session", process.pid);
const NEW = claude("new-session", stand.pid);

function spawn(home: string, args: string[], env: Env = {}, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: Object.fromEntries(
      Object.entries({ ...process.env, KIWI_HOME: home, KIWI_RELAY: server!.url.origin, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: agent, KIWI_MODEL: "test-model", ...env }).filter(
        ([, v]) => v !== "",
      ),
    ),
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, args: string[], env: Env = {}, stdin?: string): Promise<{ code: number; out: string; err: string }> {
  const p = spawn(home, args, env, stdin);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, args: string[], env: Env = {}, stdin?: string): Promise<string> {
  const r = await run(home, args, env, stdin);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const prompt = (env: Env) => ok(agent, ["hook", "prompt"], env, JSON.stringify({ session_id: env.CLAUDE_CODE_SESSION_ID, cwd: agent, hook_event_name: "UserPromptSubmit", prompt: "go on" }));
const sessionStart = (env: Env) =>
  ok(agent, ["hook", "session-start"], env, JSON.stringify({ session_id: env.CLAUDE_CODE_SESSION_ID, cwd: agent, source: "startup", hook_event_name: "SessionStart" }));
const seats = (): SeatRecord[] => Object.values((JSON.parse(readFileSync(join(agent, "config.json"), "utf8")) as Config).bindings ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v]));
const send = (text: string) => ok(owner, ["send", "--to", me, text]);

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const code = /join code: (\S+)/.exec(await ok(owner, ["create", "held", "--as", "boss"], PLAIN))![1]!;
  let out = "";
  const joining = spawn(agent, ["join", code, "--timeout", "60s"], OLD);
  const reading = new Response(joining.stdout).text().then((t) => void (out = t));
  let listed = "";
  await until(async () => {
    listed = await ok(owner, ["--as", "human", "requests"], PLAIN);
    return /\d{3}-\d{3}/.test(listed);
  }, "join request");
  await ok(owner, ["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"], PLAIN);
  expect(await joining.exited).toBe(0);
  await reading;
  me = /You're "([^"]+)"/.exec(out)![1]!;
  alias = seats()[0]!.alias;
  await until(async () => (await daemonListening(daemonSock(agent)).catch(() => [])).some((s) => s.agent === me), "the daemon holding the seat");
});

afterAll(async () => {
  stand.kill();
  await stopDaemon(daemonSock(agent)).catch(() => {});
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

test("while a loop holds the seat, no hook, kiwi command or running listener reads for it, and what arrives stays unread", async () => {
  await send("before the hold");
  expect(await prompt(OLD)).toContain("before the hold");
  const listener = spawn(agent, ["listen"], OLD);
  let heard = "";
  const hearing = (async () => {
    for await (const chunk of listener.stdout) heard += new TextDecoder().decode(chunk);
  })();
  const listenerErr = new Response(listener.stderr).text();
  await send("heard live");
  await until(() => heard.includes("heard live"), "the running listener hearing a message");

  token = (await ok(agent, ["seat", "hold"], { ...PLAIN, KIWI_AS: me })).trim();
  expect(token).toMatch(/^[\w-]{40,}$/);
  const [held] = seats();
  expect(held).toMatchObject({ alias, as: me, hold: { key: expect.any(String) } });
  expect(held).not.toHaveProperty("session");
  expect(held).not.toHaveProperty("pid");
  expect(JSON.stringify(seats())).not.toContain(token);

  await send("while held");
  await until(() => listener.exitCode !== null, "the running listener exiting");
  expect(listener.exitCode).not.toBe(0);
  await hearing;
  expect(await listenerErr).toContain(heldText(alias, me));
  expect(heard).not.toContain("while held");

  expect(await prompt(OLD)).not.toContain("while held");
  expect(await sessionStart(NEW)).not.toContain("while held");
  expect(await prompt(NEW)).not.toContain("while held");
  expect(seats()[0]).toMatchObject({ hold: { key: held!.hold!.key } });
  expect(seats()[0]).not.toHaveProperty("session");

  for (const [args, env] of [
    [["listen", "--now"], OLD],
    [["--as", me, "listen", "--now"], OLD],
    [["--as", me, "listen", "--now"], PLAIN],
    [["listen", "--now"], { ...PLAIN, KIWI_AS: me }],
    [["listen", "--now"], { ...NEW, KIWI_AS: me }],
    [["-c", alias, "--as", me, "status"], OLD],
    [["listen", "--now"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: "not-the-token" }],
  ] satisfies [string[], Env][]) {
    const r = await run(agent, args, env);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(heldText(alias, me));
    expect(r.out).not.toContain("while held");
  }
  expect((await run(agent, ["--as", me, "status"], { ...PLAIN, KIWI_SEAT_TOKEN: token })).code).toBe(0);

  expect((await run(agent, ["seat", "hold"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: "another" })).err).toContain("held with another KIWI_SEAT_TOKEN");
  expect((await run(agent, ["seat", "bind", "--harness", "claude", "--session", "x"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: "another" })).err).toContain("held with another KIWI_SEAT_TOKEN");
  expect((await run(agent, ["seat", "release"], { ...PLAIN, KIWI_AS: me })).code).not.toBe(0);
  expect(seats()[0]).toMatchObject({ hold: { key: held!.hold!.key } });
});

test("the loop hands the seat to the session it names, which gets what arrived during the hold; the old session gets nothing", async () => {
  const bound = await ok(agent, ["seat", "bind", "--harness", "claude", "--session", "new-session", "--pid", String(stand.pid)], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: token });
  expect(bound).toContain(`bound to claude session new-session`);
  const [seat] = seats();
  expect(seat).toMatchObject({ alias, as: me, harness: "claude", session: "new-session", pid: stand.pid });
  expect(seat).not.toHaveProperty("hold");
  expect(await prompt(OLD)).not.toContain("while held");
  const told = await prompt(NEW);
  expect(told).toContain("while held");
  expect(told).not.toContain("before the hold");
  expect(seats()[0]).toMatchObject({ session: "new-session" });
  expect((await run(agent, ["seat", "bind", "--harness", "claude", "--session", "other"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: token })).err).toContain("isn't held");
});
