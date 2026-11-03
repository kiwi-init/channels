import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListeners, daemonSock } from "../src/daemon.ts";
import { seatBudget } from "../src/hooks/answer.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(90_000);

const INSTALLED = join(homedir(), ".kiwi", "bin", "kiwi");
const KIWI = Bun.which("kiwi") ? "kiwi" : existsSync(INSTALLED) ? INSTALLED : [process.execPath, join(import.meta.dir, "..", "src", "cli", "main.ts")].map((s) => `'${s}'`).join(" ");
const seatJoins = (alias: string, me: string) => [`${KIWI} join`, `${KIWI} -c ${alias} --as ${me} join`];

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

function printed(p: ReturnType<typeof spawn>): () => string {
  let text = "";
  void (async () => {
    for await (const chunk of p.stdout) text += new TextDecoder().decode(chunk);
  })();
  return () => text;
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

async function approve(owner: string, channel: string[] = []): Promise<void> {
  let listed = "";
  await until(async () => {
    listed = await ok(owner, [...channel, "--as", "human", "requests"]);
    return /\d{3}-\d{3}/.test(listed);
  }, "request listed with a code");
  await ok(owner, [...channel, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
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

function fakeKimi(home: string, cwd: string, env: Env, name = "kimi") {
  const bin = join(scratch(`${name}-bin`), name);
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
      return { out: () => read(id, "out"), err: () => read(id, "err") };
    },
  };
}

const KIMI_USER = `default_model = "kimi-code/k3"

[[hooks]]
event = "Notification"
command = "notify-send kimi"
`;

describe("Kimi Code keeps its own listener running", () => {
  test("join, run in the background, is the listener: it hands over the first message, Stop blocks with exit 2 until `kiwi join` runs again, and again once it has ended (#1539)", async () => {
    const owner = scratch("kimi-own");
    const code = created(await ok(owner, ["create", "kimi-wake", "--as", "boss"]));
    const h = scratch("kimi");
    const kimiDir = scratch("kimi-home");
    writeFileSync(join(kimiDir, "config.toml"), KIMI_USER);
    const kimi = fakeKimi(h, h, { KIWI_KIMI_DIR: kimiDir });

    const joined = kimi.background(["join", code, "--timeout", "40s"]);
    await until(() => joined.out().includes("If this command isn't running in the background, stop it and run it again with the Bash tool as a background task"), "the background hint");
    await approve(owner);
    await until(() => joined.out().includes("You're \""), "the brief");
    const me = youAre(joined.out());
    expect(joined.out()).toContain(`call the Bash tool with command \`${KIWI} join\`, run_in_background: true, disable_timeout: true`);
    await until(() => joined.out().includes("Listening now: this command ends when a message for you arrives. While it runs in the background, don't start another"), "join listening");
    expect(joined.err()).toContain(`installed Kimi Code hooks (${join(kimiDir, "config.toml")})`);
    const config = readFileSync(join(kimiDir, "config.toml"), "utf8");
    expect(config.startsWith(KIMI_USER)).toBe(true);
    const hooks = (Bun.TOML.parse(config) as { hooks: { event: string; command: string; timeout?: number }[] }).hooks;
    expect(hooks.map((x) => x.event)).toEqual(["Notification", "Stop"]);
    expect(hooks[1]!.command).toEndWith(" hook kimi-stop # kiwi");
    expect(hooks[1]!.timeout).toBe(30);

    const stopInput = JSON.stringify({ hook_event_name: "Stop", session_id: "session_kimi", cwd: h, stop_hook_active: false });
    await until(async () => (await listenersOf(h, me)).some((l) => l.pid === kimi.pid && l.harness === "kimi"), "join's listener held for this Kimi session");
    expect(await kimi.hook(["hook", "kimi-stop"], stopInput)).toEqual({ code: 0, out: "", err: "" });
    await ok(owner, ["send", "--to", me, "handed over by join"]);
    await until(() => joined.out().includes("handed over by join"), "join handing over the first message");
    await until(async () => (await listenersOf(h, me)).length === 0, "join gone");

    const deaf = await kimi.hook(["hook", "kimi-stop"], stopInput);
    expect(deaf.code).toBe(2);
    expect(deaf.out).toBe("");
    expect(deaf.err).toContain("no Kiwi listener of yours is running for kimi-wake");
    expect(
      seatJoins("kimi-wake", me)
        .map((c) => `call the Bash tool with command \`${c}\`, run_in_background: true, disable_timeout: true`)
        .some((line) => deaf.err.includes(line)),
    ).toBe(true);
    expect(deaf.err).not.toMatch(/ listen\b/);
    expect(deaf.err).toContain("If you are a subagent, ignore this and end your turn.");

    const listener = kimi.background(["join"]);
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

describe("ZCode keeps its own listener running", () => {
  test("join installs its Stop hook in config.json and stays as the listener; Stop blocks, Claude-shaped, once join has woken the agent, until `kiwi join` runs again (#1539)", async () => {
    const owner = scratch("zcode-own");
    const code = created(await ok(owner, ["create", "zcode-wake", "--as", "boss"]));
    const h = scratch("zcode");
    const zcodeDir = scratch("zcode-home");
    writeFileSync(join(zcodeDir, "config.json"), JSON.stringify({ model: "glm-5" }));
    const zcode = fakeKimi(h, h, { KIWI_ZCODE_DIR: zcodeDir, ZCODE_RUNTIME_ENV: "1" }, "zcode-cli");

    const joined = zcode.background(["join", code, "--timeout", "40s"]);
    await approve(owner);
    await until(() => joined.out().includes("You're \""), "the brief");
    const me = youAre(joined.out());
    expect(joined.out()).toContain(`call the Bash tool with command \`${KIWI} join\`, run_in_background: true, and no timeout`);
    await until(() => joined.err().includes(`installed ZCode hooks (${join(zcodeDir, "config.json")})`), "the hooks installed");
    const config = JSON.parse(readFileSync(join(zcodeDir, "config.json"), "utf8")) as { model: string; hooks: { enabled: boolean; events: { Stop: { hooks: { command: string }[] }[] } } };
    expect(config.model).toBe("glm-5");
    expect(config.hooks.enabled).toBe(true);
    const command = config.hooks.events.Stop.flatMap((g) => g.hooks.map((x) => x.command));
    expect(command).toHaveLength(1);
    expect(command[0]).toEndWith(" hook stop # kiwi");

    const otherCode = created(await ok(owner, ["create", "zcode-other", "--as", "boss"]));
    const joinedOther = zcode.background(["join", otherCode, "--timeout", "40s"]);
    await approve(owner, ["-c", "zcode-other"]);
    await until(() => joinedOther.out().includes("You're \""), "the other brief");
    const other = youAre(joinedOther.out());

    const stopInput = JSON.stringify({
      hookEventName: "Stop",
      sessionId: "sess_zcode",
      session_id: "sess_zcode",
      cwd: h,
      stopHookActive: false,
      stop_hook_active: false,
      responsePreview: "done",
      toolCallCount: 0,
    });
    const decision = (r: Ran) => JSON.parse(r.out) as { decision: string; reason: string };
    const held = async (agent: string) => (await listenersOf(h, agent)).some((l) => l.pid === zcode.pid && l.harness === "zcode");
    await until(async () => (await held(me)) && (await held(other)), "join holding a listener for each seat of this ZCode process");
    expect(await zcode.hook(["hook", "stop"], stopInput)).toEqual({ code: 0, out: "", err: "" });

    await ok(owner, ["-c", "zcode-wake", "send", "--to", me, "wakes the zcode listener"]);
    await until(() => joined.out().includes("wakes the zcode listener"), "join handing over the message");
    await until(async () => (await listenersOf(h, me)).length === 0, "join gone");
    const rearm = await zcode.hook(["hook", "stop"], stopInput);
    expect(rearm.code).toBe(0);
    expect(decision(rearm).decision).toBe("block");
    expect(decision(rearm).reason).toContain("no Kiwi listener of yours is running for zcode-wake");
    expect(decision(rearm).reason).toContain(`call the Bash tool with command \`${KIWI} -c zcode-wake --as ${me} join\`, run_in_background: true, and no timeout`);
    expect(decision(rearm).reason).not.toContain("running for zcode-other");

    await ok(owner, ["-c", "zcode-wake", "send", "--to", me, "unread at stop"]);
    const unread = await zcode.hook(["hook", "stop"], stopInput);
    expect(decision(unread).reason).toContain("unread Kiwi Channels messages for you");
    expect(decision(unread).reason).toContain("unread at stop");

    expect((await zcode.tool(["hooks", "uninstall", "zcode"])).code).toBe(0);
    expect(JSON.parse(readFileSync(join(zcodeDir, "config.json"), "utf8"))).toEqual({ model: "glm-5" });
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
      expect(joined.out).toContain("Kiwi wakes you in this session when a message for you arrives (Kimi's server). Don't keep a listener running.");
      expect(joined.out).not.toMatch(/ listen\b/);
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
      expect(text.text).toContain(`--as ${me} join`);
      expect(text.text).not.toContain("attic");
      await until(() => existsSync(join(h, "wake.log")) && readFileSync(join(h, "wake.log"), "utf8").includes(`\t${me}\tkimi-server\t1\tok`), "the wake log");
    } finally {
      kimiServer.stop(true);
    }
  });
});

describe("Grok keeps its own monitor running", () => {
  test("join keeps streaming as the monitor; its Stop hook blocks until a monitor runs this seat's join; SessionStart and prompt hooks, whose output Grok drops, don't use up messages (#1539)", async () => {
    const owner = scratch("grok-own");
    const code = created(await ok(owner, ["create", "grok-wake", "--as", "boss"]));
    const h = scratch("grok");
    const grokDir = scratch("grok-home");
    const G = { GROK_SESSION_ID: "g1", KIWI_GROK_DIR: grokDir };
    const joining = spawn(h, ["join", code, "--timeout", "40s"], G);
    shells.push(joining);
    const joined = printed(joining);
    await until(() => joined().includes("stop it and run it again with the monitor tool (persistent: true)"), "the monitor hint");
    await approve(owner);
    await until(() => joined().includes("You're \""), "the brief");
    const me = youAre(joined());
    expect(joined()).toMatch(/start the monitor tool with command `([^`]+)`, description "\1", persistent: true/);
    await until(() => joined().includes("Listening now: each message for you prints here as it arrives. If this command is your monitor, don't start another"), "join saying it listens");
    await until(async () => (await listenersOf(h, me)).some((l) => l.session === "g1"), "join streaming for this Grok session");
    await ok(owner, ["send", "--to", me, "streamed by join"]);
    await until(() => joined().includes("streamed by join"), "join printing the message");
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
    const original = (command: string) => stop({ backgroundTasks: [{ id: "j1", type: "monitor", status: "running", command }] });
    expect(await original(`kiwi join ${code} --timeout 40s`)).toBeNull();
    expect(await original(`[monitor] /home/u/.kiwi/bin/kiwi join "${code}" --as="${me}"`)).toBeNull();
    expect(await original(`sh -c 'k=$(command -v kiwi || echo "$HOME/.kiwi/bin/kiwi"); exec "$k" "$@"' kiwi join ${code}`)).toBeNull();
    expect((await original("tail -f build.log"))?.decision).toBe("block");
    expect((await stop({ backgroundTasks: [{ id: "s1", type: "shell", status: "running", command: `kiwi join ${code}` }] }))?.decision).toBe("block");

    joining.kill();
    await joining.exited;
    await until(async () => (await listenersOf(h, me)).length === 0, "join gone");
    expect((await original(`kiwi join ${code}`))?.decision).toBe("block");
    expect((await original(`echo kiwi join ${code}; sleep 3600`))?.decision).toBe("block");
    const otherSession = spawn(h, ["-c", "grok-wake", "--as", me, "listen"], { CLAUDECODE: "", KIWI_GROK_DIR: grokDir });
    shells.push(otherSession);
    await until(async () => (await listenersOf(h, me)).length === 1, "a listener for this seat outside this Grok session");
    expect((await original(`kiwi join ${code}`))?.decision).toBe("block");
    otherSession.kill();
    await otherSession.exited;
    await until(async () => (await listenersOf(h, me)).length === 0, "that listener gone");

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
    expect(seatJoins("grok-wake", me)).toContain(listen);
    expect(await stop({ stop_hook_active: true, backgroundTasks: [] })).toBeNull();
    const activeLogged = readFileSync(join(h, "stop.log"), "utf8").trim().split("\n").at(-1)!;
    expect(activeLogged).toContain("grok-wake");
    expect(activeLogged).toContain(me);
    expect(activeLogged).toContain("grok: listener check skipped: stop_hook_active");
    const missing = await stop({});
    expect(missing?.decision).toBe("block");
    expect(missing?.reason).toContain("no Kiwi listener of yours is running for grok-wake");
    const missingLogged = readFileSync(join(h, "stop.log"), "utf8").trim().split("\n").at(-1)!;
    expect(missingLogged).toContain("grok-wake");
    expect(missingLogged).toContain(me);
    expect(missingLogged).toContain("grok: no backgroundTasks; no live listener");
    expect(await stop({ backgroundTasks: [{ id: "m1", type: "monitor", status: "running", description: listen }] })).toBeNull();
    const elsewhere = `${listen} -c other --as other`;
    expect((await stop({ backgroundTasks: [{ id: "m3", type: "monitor", status: "running", description: elsewhere }] }))?.decision).toBe("block");
    const logged = readFileSync(join(h, "stop.log"), "utf8").trim().split("\n").at(-1)!;
    expect(logged).toContain("grok-wake");
    expect(logged).toContain(`grok: no listener among 1 monitors\t${JSON.stringify(elsewhere)}`);
    expect(logged).toContain(JSON.stringify(listen));
    expect(await stop({ backgroundTasks: [{ id: "m6", type: "monitor", status: "running", description: `[monitor] ${listen}` }] })).toBeNull();
    expect(await stop({ backgroundTasks: [{ id: "m7", type: "monitor", status: "running", display_command: `[monitor] ${listen}` }] })).toBeNull();

    const monitor = spawn(h, ["join"], G);
    shells.push(monitor);
    await until(async () => (await listenersOf(h, me)).some((l) => l.session === "g1"), "the monitor's listener held for this Grok session");
    expect(await stop({})).toBeNull();
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
    await monitor.exited;
    await until(async () => (await listenersOf(h, me)).length === 0, "the monitor's join gone");
    expect(await stop({ backgroundTasks: [{ id: "m8", type: "monitor", status: "running", description: listen.replace(/ join$/, " listen") }] })).toBeNull();
  });
});

describe("Cursor keeps its own listener running", () => {
  test("join stays as the listener until the first message; then its stop hook asks for `kiwi join` in the background until one of this chat runs (#1539)", async () => {
    const owner = scratch("cursor-own");
    const code = created(await ok(owner, ["create", "cursor-wake", "--as", "boss"]));
    const h = scratch("cursor");
    const C = { CURSOR_AGENT: "1", CURSOR_CONVERSATION_ID: "chat-1", KIWI_CURSOR_DIR: scratch("cursor-home") };
    const joining = spawn(h, ["join", code, "--timeout", "40s"], C);
    shells.push(joining);
    const joined = printed(joining);
    await approve(owner);
    await until(() => joined().includes("You're \""), "the brief");
    const me = youAre(joined());
    expect(joined()).toContain(`run \`${KIWI} join\` with the Shell tool as a background command (is_background: true)`);
    await until(async () => (await listenersOf(h, me)).some((l) => l.session === "chat-1" && l.harness === "cursor"), "join listening for this Cursor chat");
    await ok(owner, ["send", "--to", me, "handed over by join"]);
    expect(await joining.exited).toBe(0);
    await until(() => joined().includes("handed over by join"), "join printing the message");
    await until(async () => (await listenersOf(h, me)).length === 0, "join gone");

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

    const listener = spawn(h, ["join"], C);
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
    expect(unread).toContain("Unread Kiwi messages (cursor-wake).");
    expect(unread).toContain("no Kiwi listener of yours is running");

    const resuming = spawn(h, ["join", code], C);
    shells.push(resuming);
    const resumed = printed(resuming);
    expect(await resuming.exited).toBe(0);
    await until(() => resumed().includes("unread at stop"), "the resumed join handing over what was unread");
    expect(resumed()).toContain("this key is already a member: resumed, nothing new was granted.");
    expect(resumed()).toContain("Listening now: this command ends when a message for you arrives.");
  });
});

describe("Grok Bot on a VM whose shell has Cursor's variables", () => {
  test("its seat is Grok Bot's, and a Cursor-shaped stop hook acts as Grok Bot: unread messages handed over, no listener asked for", async () => {
    const owner = scratch("gb-own");
    const code = created(await ok(owner, ["create", "gb-cursor", "--as", "boss"]));
    const h = scratch("gb");
    const B = { CURSOR_AGENT: "1", CURSOR_CONVERSATION_ID: "chat-gb", KIWI_HARNESS: "grok-bot", KIWI_MODEL: "grok-bot", KIWI_CURSOR_DIR: scratch("gb-cursor") };
    const joining = run(h, ["join", code, "--timeout", "40s"], B);
    await approve(owner);
    const joined = await joining;
    expect(joined.code).toBe(0);
    const me = youAre(joined.out);
    const config = JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { bindings: Record<string, { harness?: string } | { harness?: string }[]> };
    expect(
      Object.values(config.bindings)
        .flat()
        .map((b) => b.harness),
    ).toEqual(["grok-bot"]);
    expect((await ok(h, ["wake"], B)).includes("Cursor gives Kiwi no way")).toBe(false);

    await ok(owner, ["send", "--to", me, "for the grok bot"]);
    const r = await run(
      h,
      ["hook", "stop"],
      { KIWI_HARNESS: "grok-bot" },
      h,
      JSON.stringify({ conversation_id: "chat-gb", generation_id: "g", hook_event_name: "stop", cursor_version: "2026.10.18", workspace_roots: [h], status: "completed", loop_count: 0 }),
    );
    expect(r.code).toBe(0);
    const follow = (JSON.parse(r.out) as { followup_message: string }).followup_message;
    expect(follow).toContain("Unread Kiwi messages (gb-cursor).");
    expect(follow).not.toContain("no Kiwi listener of yours is running");
  });
});
