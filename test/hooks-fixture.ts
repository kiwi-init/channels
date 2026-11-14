import { expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { trafficProxy } from "./traffic.ts";

type Env = Record<string, string>;
type Transport = { kind: "direct" } | { kind: "proxy"; start: typeof trafficProxy };

export function hooksFixture(options: { prefix: string; sessionId: string; channel: string; transport: Transport; pollMs?: number }) {
  const cleanup: (() => void | Promise<unknown>)[] = [];
  const children = new Set<ReturnType<typeof spawn>>();
  let relay = "";
  let me = "";
  let proxy: ReturnType<typeof trafficProxy> | undefined;
  const scratch = (tag: string) => {
    const dir = mkdtempSync(join(tmpdir(), `${options.prefix}-${tag}-`));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };
  const dirs = (() => {
    try {
      return { dataDir: scratch("relay"), claudeDir: scratch("claude"), owner: scratch("owner"), agent: scratch("agent") };
    } catch (error) {
      for (const close of cleanup.reverse()) close();
      throw error;
    }
  })();
  const { dataDir, claudeDir, owner, agent } = dirs;
  const session = (id: string): Env => ({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: id, CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" });
  const env = session(options.sessionId);
  const input = JSON.stringify({ session_id: options.sessionId, cwd: agent });

  function spawn(home: string, args: string[], extra: Env = {}, stdin?: string) {
    if (!relay) throw new Error("hooks fixture has not started");
    const child = Bun.spawn(kiwiCmd(args), {
      cwd: home,
      env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "", KIWI_MODEL: "test-model", ...extra },
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    children.add(child);
    void child.exited.then(() => children.delete(child));
    return child;
  }

  async function ok(home: string, args: string[], extra: Env = {}, stdin?: string): Promise<string> {
    const child = spawn(home, args, extra, stdin);
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const code = await child.exited;
    if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
    return out;
  }

  async function until(pred: () => Promise<boolean>, label: string, ms = 20_000) {
    const end = Date.now() + ms;
    while (!(await pred())) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
      await Bun.sleep(options.pollMs ?? 50);
    }
  }

  async function dispose() {
    const errors: unknown[] = [];
    for (const child of children) child.kill();
    await Promise.all([...children].map((child) => child.exited));
    while (cleanup.length) {
      const close = cleanup.pop();
      try {
        await close?.();
      } catch (error) {
        errors.push(error);
      }
    }
    relay = "";
    if (errors.length) throw new AggregateError(errors, "hooks fixture cleanup failed");
  }

  async function start() {
    try {
      const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
      cleanup.push(() => server.stop(true));
      relay = server.url.origin;
      if (options.transport.kind === "proxy") {
        const started = options.transport.start(relay);
        proxy = started;
        cleanup.push(() => started.stop());
        relay = started.url;
      }
      cleanup.push(() => stopDaemon(daemonSock(agent)));
      const code = /join code: (\S+)/.exec(await ok(owner, ["create", options.channel, "--as", "boss"]))?.[1];
      if (!code) throw new Error("owner did not print a join code");
      let out = "";
      const joining = spawn(agent, ["join", code, "--timeout", "60s"], env);
      const reading = new Response(joining.stdout).text().then((text) => void (out = text));
      let listed = "";
      await until(async () => {
        listed = await ok(owner, ["--as", "human", "requests"], { CLAUDECODE: "" });
        return /\d{3}-\d{3}/.test(listed);
      }, "join request");
      const verification = /(\d{3}-\d{3})/.exec(listed)?.[1];
      if (!verification) throw new Error("owner did not list a join request");
      await ok(owner, ["--as", "human", "approve", verification, "--yes"], { CLAUDECODE: "" });
      expect(await joining.exited).toBe(0);
      await reading;
      const name = /You're "([^"]+)"/.exec(out)?.[1];
      if (!name) throw new Error("agent did not print its joined name");
      me = name;
    } catch (error) {
      await dispose();
      throw error;
    }
  }

  return {
    ...dirs,
    env,
    input,
    session,
    spawn,
    ok,
    until,
    start,
    dispose,
    hook: (event: string) => ok(agent, ["hook", event], env, input),
    get me() {
      return me;
    },
    get proxy() {
      if (!proxy) throw new Error("hooks fixture has no traffic proxy");
      return proxy;
    },
  };
}
