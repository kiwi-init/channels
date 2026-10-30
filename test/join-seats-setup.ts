import { afterAll, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

type Env = Record<string, string>;

export interface JoinSeats {
  readonly claudeDir: string;
  scratch(tag: string): string;
  spawn(home: string, args: string[], env?: Env, cwd?: string, stdin?: string, via?: string[]): Bun.Subprocess<"ignore" | Uint8Array, "pipe", "pipe">;
  run(home: string, args: string[], env?: Env, cwd?: string, stdin?: string): Promise<{ code: number; out: string; err: string }>;
  ok(home: string, args: string[], env?: Env, cwd?: string): Promise<string>;
  until(pred: () => boolean | Promise<boolean>, label: string, ms?: number): Promise<void>;
  join_(owner: string, joiner: string, code: string, env: Env, cwd?: string, extra?: string[]): Promise<{ out: string; err: string; asked: string }>;
}

export const HANDLE = /^[a-z]+-[a-z]+$/;

export const DEAD = String(2 ** 22 + 4242);

export function youAre(out: string): string {
  return /You're "([^"]+)"/.exec(out)![1]!;
}

export function created(out: string): string {
  return /join code: (\S+)/.exec(out)![1]!;
}

export function joinSeats(): JoinSeats {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-js-relay-"));
  const claudeDir = mkdtempSync(join(tmpdir(), "kiwi-js-claude-"));
  const made: string[] = [dataDir, claudeDir];
  let server: ReturnType<typeof startRelay> | undefined;
  let relay = "";

  beforeAll(() => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    relay = server.url.origin;
  });
  afterAll(() => {
    server?.stop(true);
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  const scratch = (tag: string) => {
    const d = mkdtempSync(join(tmpdir(), `kiwi-js-${tag}-`));
    made.push(d);
    return d;
  };

  const spawn = (home: string, args: string[], env: Env = {}, cwd = home, stdin?: string, via: string[] = []) =>
    Bun.spawn([...via, ...kiwiCmd(args)], {
      cwd,
      // The owner's person seat (--as human) runs from a person's terminal, never an agent's harness.
      // KIWI_MODEL: an agent in a harness says what runs it or can't join; these sessions have no transcript to read it from.
      env: {
        ...process.env,
        KIWI_HOME: home,
        KIWI_RELAY: relay,
        CLAUDE_CONFIG_DIR: claudeDir,
        CLAUDE_PROJECT_DIR: "",
        KIWI_MODEL: "test-model",
        ...env,
        ...(args[0] === "--as" && args[1] === "human" ? { CLAUDECODE: "" } : {}),
      },
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });

  const run = async (home: string, args: string[], env: Env = {}, cwd = home, stdin?: string) => {
    const p = spawn(home, args, env, cwd, stdin);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out, err };
  };

  const ok = async (home: string, args: string[], env: Env = {}, cwd = home): Promise<string> => {
    const r = await run(home, args, env, cwd);
    if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
    return r.out;
  };

  const until = async (pred: () => boolean | Promise<boolean>, label: string, ms = 15_000) => {
    const end = Date.now() + ms;
    while (!(await pred())) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
      await Bun.sleep(50);
    }
  };

  const join_ = async (owner: string, joiner: string, code: string, env: Env, cwd = joiner, extra: string[] = []): Promise<{ out: string; err: string; asked: string }> => {
    const p = spawn(joiner, ["join", code, "--timeout", "40s", ...extra], env, cwd);
    let out = "";
    const reader = p.stdout.getReader();
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        out += new TextDecoder().decode(value);
      }
    })();
    await until(() => out.includes("waiting for the owner"), "join request");
    let listed = "";
    await until(async () => {
      listed = await ok(owner, ["--as", "human", "requests"]);
      return /\d{3}-\d{3}/.test(listed);
    }, "request listed with a code");
    const codeShown = /(\d{3}-\d{3})/.exec(listed)![1]!;
    await ok(owner, ["--as", "human", "approve", codeShown, "--yes"]);
    const code_ = await p.exited;
    await reading;
    const err = await new Response(p.stderr).text();
    if (code_ !== 0) throw new Error(`join exited ${code_}: ${err}`);
    return { out, err, asked: listed };
  };

  return { claudeDir, scratch, spawn, run, ok, until, join_ };
}
