import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListeners, daemonSock } from "../src/daemon.ts";
import { seatBudget } from "../src/hooks/answer.ts";
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

    for (let i = 0; i < 8; i++) await ok(owner, ["send", "--to", me, `stop-backlog-${i} ${"s".repeat(1_400)}`]);
    const crowded = await kimi.hook(["hook", "kimi-stop"], stopInput);
    expect(crowded.code).toBe(2);
    expect(crowded.err.trimEnd().length).toBeLessThanOrEqual(seatBudget(1));
    expect(crowded.err).toContain("no Kiwi listener of yours is running");
    expect(crowded.err).toContain("more unread: they come next");

    expect((await kimi.tool(["hooks", "uninstall", "kimi"])).code).toBe(0);
    expect(readFileSync(join(kimiDir, "config.toml"), "utf8")).toBe(KIMI_USER);
  });
});

describe("A Kimi Code session Kimi's server hosts is woken through that server", () => {
  test("join records the busy session, its Stop hook keeps it current without asking for a listener, and a message posts the prompt to it", async () => {
    const owner = scratch("kimi-srv-own");
    const code = created(await ok(owner, ["create", "kimi-served", "--as", "boss"]));
    const h = scratch("kimi-srv");
    const kimiDir = scratch("kimi-srv-home");
    const posted: { path: string; auth: string | null; body: unknown }[] = [];
    const kimiServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (req.headers.get("authorization") !== "Bearer srv-token") return Response.json({ code: 40100, msg: "unauthorized" }, { status: 401 });
        if (req.method === "GET" && url.pathname === "/api/v1/sessions" && url.searchParams.get("busy") === "true") {
          const items = [
            { id: "session_joined", busy: true, metadata: { cwd: h } },
            { id: "session_elsewhere", busy: true, metadata: { cwd: kimiDir } },
          ];
          return Response.json({ code: 0, msg: "success", data: { items, has_more: false } });
        }
        posted.push({ path: url.pathname, auth: req.headers.get("authorization"), body: await req.json() });
        return Response.json({ code: 0, msg: "success", data: { status: "running" } });
      },
    });
    try {
      const kimi = fakeKimi(h, h, { KIMI_CODE_HOME: kimiDir });
      mkdirSync(join(kimiDir, "server", "instances"), { recursive: true });
      writeFileSync(
        join(kimiDir, "server", "instances", "01KIMI.json"),
        JSON.stringify({ server_id: "01KIMI", pid: kimi.pid, host: "127.0.0.1", port: kimiServer.port, started_at: 1, heartbeat_at: 1 }),
      );
      writeFileSync(join(kimiDir, "server.token"), "srv-token\n");

      const joining = kimi.tool(["join", code, "--timeout", "40s"]);
      await approve(owner);
      const joined = await joining;
      expect(joined.code).toBe(0);
      const me = youAre(joined.out);
      expect(joined.out).toContain("Kiwi wakes you in this session when a message for you arrives (Kimi's server). Don't run listen.");
      expect(joined.out).not.toContain("listen --once");
      const seat = () =>
        Object.values((JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { bindings: Record<string, { as: string; harnessSession?: string }> }).bindings).find((b) => b.as === me);
      expect(seat()?.harnessSession).toBe("session_joined");

      const stop = await kimi.hook(["hook", "kimi-stop"], JSON.stringify({ hook_event_name: "Stop", session_id: "session_stopped", cwd: h, stop_hook_active: false }));
      expect(stop).toEqual({ code: 0, out: "", err: "" });
      expect(seat()?.harnessSession).toBe("session_stopped");

      await ok(owner, ["send", "--to", me, "the secret is in the attic"]);
      await until(() => posted.length === 1, "the prompt posted to Kimi's server");
      expect(posted[0]!.path).toBe("/api/v1/sessions/session_stopped/prompts");
      expect(posted[0]!.auth).toBe("Bearer srv-token");
      const text = (posted[0]!.body as { content: { type: string; text: string }[] }).content[0]!;
      expect(text.type).toBe("text");
      expect(text.text).toContain(`--as ${me} listen --now`);
      expect(text.text).not.toContain("attic");
      await until(() => existsSync(join(h, "wake.log")) && readFileSync(join(h, "wake.log"), "utf8").includes(`\t${me}\tkimi-server\t1\tok`), "the wake log");
    } finally {
      kimiServer.stop(true);
    }
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
    expect(joined.out).toMatch(/start the monitor tool with command `([^`]+)`, description "\1", persistent: true/);
    const file = JSON.parse(readFileSync(join(grokDir, "hooks", "kiwi.json"), "utf8")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(Object.keys(file.hooks)).toEqual(["Stop"]);

    const stop = async (extra: Record<string, unknown>) => {
      const r = await run(
        h,
        ["hook", "stop"],
        G,
        h,
        JSON.stringify({ hook_event_name: "Stop", hookEventName: "stop", session_id: "g1", cwd: h, stop_hook_active: false, reason: "end_turn", ...extra }),
      );
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
    expect((await stop({ backgroundTasks: [{ id: "m2", type: "monitor", status: "running", description: "tail -f build.log" }] }))?.decision).toBe("block");
    expect(
      (
        await stop({
          backgroundTasks: [
            { id: "s2", type: "shell", status: "running", command: listen },
            { id: "m4", type: "monitor", status: "running", description: "tail -f build.log" },
          ],
        })
      )?.decision,
    ).toBe("block");
    expect(await stop({ backgroundTasks: [{ id: "m5", type: "monitor", status: "running", description: listen }] })).toBeNull();
    monitor.kill();
  });
});

describe("Cursor keeps its own listener running", () => {
  test("its stop hook asks for `listen --once` in the background until one of this chat runs, and again once it has woken the agent", async () => {
    const owner = scratch("cursor-own");
    const code = created(await ok(owner, ["create", "cursor-wake", "--as", "boss"]));
    const h = scratch("cursor");
    const C = { CURSOR_AGENT: "1", CURSOR_CONVERSATION_ID: "chat-1", KIWI_CURSOR_DIR: scratch("cursor-home") };
    const joining = run(h, ["join", code, "--timeout", "40s"], C);
    await approve(owner);
    const joined = await joining;
    expect(joined.code).toBe(0);
    const me = youAre(joined.out);
    expect(joined.out).toContain("listen --once` with the Shell tool as a background command (is_background: true)");

    const stop = async (extra: Record<string, unknown> = {}) => {
      const r = await run(
        h,
        ["hook", "stop"],
        {},
        h,
        JSON.stringify({ conversation_id: "chat-1", generation_id: "g", hook_event_name: "stop", cursor_version: "2026.10.18", workspace_roots: [h], status: "completed", loop_count: 0, ...extra }),
      );
      expect(r.code).toBe(0);
      return r.out ? (JSON.parse(r.out) as { followup_message: string }).followup_message : null;
    };

    const deaf = await stop();
    expect(deaf).toContain("no Kiwi listener of yours is running for cursor-wake");
    expect(deaf).toContain("is_background: true");
    expect(await stop({ status: "aborted" })).toBeNull();

    const listener = spawn(h, ["listen", "--once"], C);
    shells.push(listener);
    await until(async () => (await listenersOf(h, me)).some((l) => l.session === "chat-1" && l.harness === "cursor"), "the listener held for this Cursor chat");
    expect(await stop()).toBeNull();
    expect(await stop({ conversation_id: "chat-2" })).toBeNull();

    await ok(owner, ["send", "--to", me, "wakes the cursor listener"]);
    expect(await new Response(listener.stdout).text()).toContain("wakes the cursor listener");
    expect(await listener.exited).toBe(0);
    await until(async () => (await listenersOf(h, me)).length === 0, "the listener gone");
    const rearm = await stop();
    expect(rearm).toContain("no Kiwi listener of yours is running");
    expect(rearm).not.toContain("wakes the cursor listener");

    await ok(owner, ["send", "--to", me, "unread at stop"]);
    const unread = await stop();
    expect(unread).toContain("Unread Kiwi messages.");
    expect(unread).toContain("no Kiwi listener of yours is running");
  });
});
