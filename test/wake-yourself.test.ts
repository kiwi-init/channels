import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListeners, daemonSock } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(90_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-wy-relay-"));
const claudeDir = mkdtempSync(join(tmpdir(), "kiwi-wy-claude-"));
const made: string[] = [dataDir, claudeDir];
const shells: { kill: () => void }[] = [];
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  for (const s of shells) s.kill();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-wy-${tag}-`));
  made.push(d);
  return d;
};

type Env = Record<string, string>;
type Ran = { code: number; out: string; err: string };

function baseEnv(home: string, env: Env): Env {
  return { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "", KIWI_MODEL: "test-model", ...env };
}

function spawn(home: string, args: string[], env: Env = {}, cwd = home, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd,
    env: baseEnv(home, env),
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, args: string[], env: Env = {}, cwd = home, stdin?: string): Promise<Ran> {
  const p = spawn(home, args, env, cwd, stdin);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, args: string[], env: Env = {}, cwd = home): Promise<string> {
  const r = await run(home, args, env, cwd);
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

async function approve(owner: string): Promise<void> {
  let listed = "";
  await until(async () => {
    listed = await ok(owner, ["--as", "human", "requests"]);
    return /\d{3}-\d{3}/.test(listed);
  }, "request listed with a code");
  await ok(owner, ["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
}

function created(out: string): string {
  return /join code: (\S+)/.exec(out)![1]!;
}

function youAre(out: string): string {
  return /You're "([^"]+)"/.exec(out)![1]!;
}

async function listenersOf(home: string, agent: string) {
  return (await daemonListeners(daemonSock(home)).catch(() => [])).filter((l) => l.kind === "listen" && l.agent === agent);
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function fakeKimi(home: string, cwd: string, env: Env) {
  const bin = join(scratch("kimi-bin"), "kimi");
  copyFileSync(Bun.which("bash") ?? "/bin/sh", bin);
  chmodSync(bin, 0o755);
  const io = scratch("kimi-io");
  const proc = Bun.spawn([bin], { cwd, env: baseEnv(home, { TERM: "xterm-256color", NO_COLOR: "", ...env }), stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  shells.push(proc);
  let n = 0;
  const line = (args: string[], tool: boolean, stdin: string | undefined, background: boolean) => {
    const id = String(++n);
    const input = join(io, `${id}.in`);
    writeFileSync(input, stdin ?? "");
    const cmd = `${tool ? "TERM=dumb NO_COLOR=1 " : ""}${kiwiCmd(args).map(q).join(" ")} < ${q(input)} > ${q(join(io, `${id}.out`))} 2> ${q(join(io, `${id}.err`))}`;
    proc.stdin.write(background ? `${cmd} &\n` : `${cmd}; echo $? > ${q(join(io, `${id}.tmp`))} && mv ${q(join(io, `${id}.tmp`))} ${q(join(io, `${id}.code`))}\n`);
    proc.stdin.flush();
    return id;
  };
  const read = (id: string, what: "out" | "err") => (existsSync(join(io, `${id}.${what}`)) ? readFileSync(join(io, `${id}.${what}`), "utf8") : "");
  const done = async (id: string): Promise<Ran> => {
    const code = join(io, `${id}.code`);
    await until(() => existsSync(code), `kimi command ${id}`, 60_000);
    return { code: Number(readFileSync(code, "utf8")), out: read(id, "out"), err: read(id, "err") };
  };
  return {
    pid: proc.pid,
    tool: (args: string[]) => done(line(args, true, undefined, false)),
    hook: (args: string[], stdin: string) => done(line(args, false, stdin, false)),
    background: (args: string[]) => {
      const id = line(args, true, undefined, true);
      return { out: () => read(id, "out") };
    },
  };
}

const KIMI_USER = `default_model = "kimi-code/k3"

[[hooks]]
event = "Notification"
command = "notify-send kimi"
`;

describe("Kimi Code keeps its own listener running", () => {
  test("join installs its Stop hook beside the user's config; Stop blocks with exit 2 until `listen --once` runs, and again once it has ended", async () => {
    const owner = scratch("kimi-own");
    const code = created(await ok(owner, ["create", "kimi-wake", "--as", "boss"]));
    const h = scratch("kimi");
    const kimiDir = scratch("kimi-home");
    writeFileSync(join(kimiDir, "config.toml"), KIMI_USER);
    const kimi = fakeKimi(h, h, { KIWI_KIMI_DIR: kimiDir });

    const joining = kimi.tool(["join", code, "--timeout", "40s"]);
    await approve(owner);
    const joined = await joining;
    expect(joined.code).toBe(0);
    const me = youAre(joined.out);
    expect(joined.out).toContain("listen --once`, run_in_background: true, disable_timeout: true");
    expect(joined.err).toContain(`installed Kimi Code hooks (${join(kimiDir, "config.toml")})`);
    const config = readFileSync(join(kimiDir, "config.toml"), "utf8");
    expect(config.startsWith(KIMI_USER)).toBe(true);
    const hooks = (Bun.TOML.parse(config) as { hooks: { event: string; command: string; timeout?: number }[] }).hooks;
    expect(hooks.map((x) => x.event)).toEqual(["Notification", "Stop"]);
    expect(hooks[1]!.command).toEndWith(" hook kimi-stop # kiwi");
    expect(hooks[1]!.timeout).toBe(30);

    const stopInput = JSON.stringify({ hook_event_name: "Stop", session_id: "session_kimi", cwd: h, stop_hook_active: false });
    const deaf = await kimi.hook(["hook", "kimi-stop"], stopInput);
    expect(deaf.code).toBe(2);
    expect(deaf.out).toBe("");
    expect(deaf.err).toContain("no Kiwi listener of yours is running for kimi-wake");
    expect(deaf.err).toContain("listen --once`, run_in_background: true, disable_timeout: true");
    expect(deaf.err).toContain("If you are a subagent, ignore this and end your turn.");

    const listener = kimi.background(["listen", "--once"]);
    await until(async () => (await listenersOf(h, me)).some((l) => l.pid === kimi.pid && l.harness === "kimi"), "the listener held for this Kimi session");
    const armed = await kimi.hook(["hook", "kimi-stop"], stopInput);
    expect(armed).toEqual({ code: 0, out: "", err: "" });

    await ok(owner, ["send", "--to", me, "wakes the kimi listener"]);
    await until(() => listener.out().includes("wakes the kimi listener"), "listen --once handing over the message");
    await until(async () => (await listenersOf(h, me)).length === 0, "the listener gone");
    const rearm = await kimi.hook(["hook", "kimi-stop"], stopInput);
    expect(rearm.code).toBe(2);
    expect(rearm.err).toContain("no Kiwi listener of yours is running");
    expect(rearm.err).not.toContain("wakes the kimi listener");

    await ok(owner, ["send", "--to", me, "unread at stop"]);
    const unread = await kimi.hook(["hook", "kimi-stop"], stopInput);
    expect(unread.code).toBe(2);
    expect(unread.err).toContain("unread Kiwi Channels messages for you");
    expect(unread.err).toContain("unread at stop");
    expect(unread.err).toContain("no Kiwi listener of yours is running");
    expect(unread.out).toBe("");

    expect((await kimi.tool(["hooks", "uninstall", "kimi"])).code).toBe(0);
    expect(readFileSync(join(kimiDir, "config.toml"), "utf8")).toBe(KIMI_USER);
  });
});

describe("Grok keeps its own monitor running", () => {
  test("its Stop hook blocks until a monitor runs this seat's listen; SessionStart and prompt hooks, whose output Grok drops, don't use up messages", async () => {
    const owner = scratch("grok-own");
    const code = created(await ok(owner, ["create", "grok-wake", "--as", "boss"]));
    const h = scratch("grok");
    const grokDir = scratch("grok-home");
    const G = { GROK_SESSION_ID: "g1", KIWI_GROK_DIR: grokDir };
    const joining = run(h, ["join", code, "--timeout", "40s"], G);
    await approve(owner);
    const joined = await joining;
    expect(joined.code).toBe(0);
    const me = youAre(joined.out);
    expect(joined.out).toContain("start the monitor tool with command");
    const file = JSON.parse(readFileSync(join(grokDir, "hooks", "kiwi.json"), "utf8")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(Object.keys(file.hooks)).toEqual(["Stop"]);

    const stop = async (extra: Record<string, unknown>) => {
      const r = await run(h, ["hook", "stop"], G, h, JSON.stringify({ hook_event_name: "Stop", hookEventName: "stop", session_id: "g1", cwd: h, stop_hook_active: false, reason: "end_turn", ...extra }));
      expect(r.code).toBe(0);
      return r.out ? (JSON.parse(r.out) as { decision: string; reason: string }) : null;
    };

    await ok(owner, ["send", "--to", me, "kept for the stop hook"]);
    expect((await run(h, ["hook", "session-start"], G, h, JSON.stringify({ hook_event_name: "SessionStart", session_id: "g1", cwd: h }))).out).toBe("");
    expect((await run(h, ["hook", "prompt"], G, h, JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "g1", cwd: h }))).out).toBe("");
    expect(await stop({ reason: "shutdown", backgroundTasks: [] })).toBeNull();
    const handed = await stop({ backgroundTasks: [] });
    expect(handed?.decision).toBe("block");
    expect(handed?.reason).toContain("kept for the stop hook");
    expect(handed?.reason).toContain("no Kiwi listener of yours is running for grok-wake");

    const deaf = await stop({ backgroundTasks: [{ id: "t1", type: "shell", status: "running", command: "sleep 100" }] });
    expect(deaf?.decision).toBe("block");
    expect(deaf?.reason).toContain("no Kiwi listener of yours is running for grok-wake");
    const listen = /start the monitor tool with command `([^`]+)`/.exec(deaf!.reason)![1]!;
    expect(listen).toEndWith(" listen");
    expect(await stop({ stop_hook_active: true, backgroundTasks: [] })).toBeNull();
    expect(await stop({})).toBeNull();
    expect(await stop({ backgroundTasks: [{ id: "m1", type: "monitor", status: "running", description: listen }] })).toBeNull();
    const elsewhere = `${listen} -c other --as other`;
    expect((await stop({ backgroundTasks: [{ id: "m3", type: "monitor", status: "running", description: elsewhere }] }))?.decision).toBe("block");

    const monitor = spawn(h, ["listen"], G);
    shells.push(monitor);
    await until(async () => (await listenersOf(h, me)).some((l) => l.session === "g1"), "the monitor's listener held for this Grok session");
    expect(await stop({ backgroundTasks: [{ id: "m2", type: "monitor", status: "running", description: "kiwi messages" }] })).toBeNull();
    expect((await stop({ backgroundTasks: [{ id: "s2", type: "shell", status: "running", command: listen }] }))?.decision).toBe("block");
    monitor.kill();
  });
});
