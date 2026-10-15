// Joining without busywork: no --as (agents are called by what they run in, made unique by the
// owner's side), a seat per agent in its checkout (no -c/--as afterwards, two agents in one checkout
// each act as themselves, a restart takes its seat back), and Claude Code's hooks doing the listening.
import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListening, daemonSock } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const MC = [process.execPath, join(import.meta.dir, "../src/cli/main.ts")];
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

/** A pid that isn't running: a session that's gone. */
const DEAD = String(2 ** 22 + 4242);

type Env = Record<string, string>;

function spawn(home: string, args: string[], env: Env = {}, cwd = home, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd,
    // The owner's person seat (--as human) runs from a person's terminal, never an agent's harness.
    // KIWI_MODEL: an agent in a harness says what runs it or can't join; these sessions have no transcript to read it from.
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "", KIWI_MODEL: "test-model", ...env, ...(args[0] === "--as" && args[1] === "human" ? { CLAUDECODE: "" } : {}) },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, args: string[], env: Env = {}, cwd = home, stdin?: string) {
  const p = spawn(home, args, env, cwd, stdin);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, args: string[], env: Env = {}, cwd = home): Promise<string> {
  const r = await run(home, args, env, cwd);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

/** Join without --as and approve it on the owner's machine; returns everything the joiner printed. */
async function join_(owner: string, joiner: string, code: string, env: Env, cwd = joiner): Promise<{ out: string; err: string; asked: string }> {
  const p = spawn(joiner, ["join", code, "--timeout", "40s"], env, cwd);
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
}

function created(out: string): string {
  return /join code: (\S+)/.exec(out)![1]!;
}

describe("joining without --as", () => {
  test("agents are called by what they run in, and a taken name becomes the next free one, never a RECLAIM", async () => {
    const owner = scratch("own");
    const code = created(await ok(owner, ["create", "names", "--as", "boss"]));
    const a = scratch("a");
    const b = scratch("b");
    const first = await join_(owner, a, code, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "sa", CLAUDE_PID: String(process.pid) });
    expect(first.out).toContain('You\'re "claude" in channel "names"');
    await until(async () => (await daemonListening(daemonSock(a)).catch(() => [])).some((s) => s.agent === "claude"), "the joiner's daemon holding its seat");

    // Another computer's Claude asks as "claude" too: the owner is offered claude-2, a plain join.
    const second = await join_(owner, b, code, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "sb", CLAUDE_PID: String(process.pid) });
    expect(second.asked).toContain("claude-2");
    expect(second.asked).not.toContain("RECLAIM");
    expect(second.out).toContain("asked to join as claude.");
    expect(second.out).toContain('You\'re "claude-2" in channel "names"');
    // Its key here goes by its name in the channel.
    const room = readdirSync(join(b, "identities"))[0]!;
    expect(readdirSync(join(b, "identities", room))).toEqual(["claude-2.json"]);
    // And it talks as claude-2 without saying so.
    await ok(b, ["send", "hello from b"], { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "sb", CLAUDE_PID: String(process.pid) });
    expect(await ok(owner, ["log"])).toContain("claude-2 → ");
    // The short join text: a handful of lines, not a manual.
    expect(second.out.split("\n").filter(Boolean).length).toBeLessThan(13);
  });

  test("two agents in one checkout each act as themselves; a restart takes its seat back", async () => {
    const owner = scratch("own2");
    const code = created(await ok(owner, ["create", "shared", "--as", "boss"]));
    const h = scratch("same");
    // A's Claude Code is a process that's running for now.
    const aProcess = Bun.spawn(["sleep", "120"]);
    const A = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "A", CLAUDE_PID: String(aProcess.pid) };
    const B = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "B", CLAUDE_PID: String(process.pid) };
    await join_(owner, h, code, A);
    // B joins from the same folder while A's seat is there: it gets its own (the next free name).
    const b = await join_(owner, h, code, B);
    expect(b.out).toContain('You\'re "claude-2"');
    expect(b.err).not.toContain("not rebinding");

    // No -c/--as: each session speaks as itself.
    await ok(h, ["send", "from B"], B);
    expect(await ok(owner, ["log"])).toContain("claude-2 → all: from B");

    // A's session ends (its process exits). A new session in the same folder takes claude back.
    aProcess.kill();
    await aProcess.exited;
    const A2 = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "A2", CLAUDE_PID: String(process.ppid) };
    await ok(h, ["send", "from A2"], A2);
    expect(await ok(owner, ["log"])).toContain("claude → all: from A2");
    // Joining again from that session resumes the seat: no new request, no new name.
    const again = await run(h, ["join", code, "--timeout", "5s"], A2);
    expect(again.code).toBe(0);
    expect(again.out).toContain("resumed");
    expect(again.out).toContain('You\'re "claude"');

    // A third live Claude Code that never joined isn't anyone here. (The same process under a new
    // session id, after /clear, is still the same agent: that's why it's a different process here.)
    const cProcess = Bun.spawn(["sleep", "120"]);
    const C = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "C", CLAUDE_PID: String(cProcess.pid) };
    const refused = await run(h, ["send", "who am i"], C);
    cProcess.kill();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("in another session");
  });

  test("running the same join again while it waits asks once, under the same name", async () => {
    const owner = scratch("own3");
    const code = created(await ok(owner, ["create", "again", "--as", "boss"]));
    const h = scratch("again");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "S", CLAUDE_PID: String(process.pid) };
    const first = await run(h, ["join", code, "--timeout", "2s"], S);
    expect(first.code).toBe(3);
    const second = await run(h, ["join", code, "--timeout", "2s"], S);
    expect(second.code).toBe(3);
    expect(second.out).toContain("asked to join as claude.");
    // One request, not two: one line names claude (its "runs claude-code" is the same request).
    const listed = await ok(owner, ["--as", "human", "requests"]);
    expect(listed.match(/^\S+\s+claude\b/gm)?.length).toBe(1);
  });
});

describe("review fixes (#1352)", () => {
  test("a join that died while waiting: running it again after the approval takes the name the owner's side gave", async () => {
    const owner = scratch("own6");
    const code = created(await ok(owner, ["create", "rerun", "--as", "boss"]));
    await join_(owner, scratch("first"), code, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "f", CLAUDE_PID: String(process.pid) });
    const b = scratch("died");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "d", CLAUDE_PID: String(process.pid) };
    // It asks, shows its code, and its shell gives up before the owner gets to it.
    const p = spawn(b, ["join", code, "--timeout", "4s"], S);
    let listed = "";
    await until(async () => {
      listed = await ok(owner, ["--as", "human", "requests"]);
      return /\d{3}-\d{3}/.test(listed);
    }, "request with a code");
    expect(listed).toContain("claude-2");
    expect(await p.exited).toBe(3);
    await ok(owner, ["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
    const again = await run(b, ["join", code, "--timeout", "5s"], S);
    expect(again.code).toBe(0);
    expect(again.out).toContain('You\'re "claude-2"');
    const room = readdirSync(join(b, "identities"))[0]!;
    expect(readdirSync(join(b, "identities", room))).toEqual(["claude-2.json"]);
    expect(await ok(b, ["status"], S)).toContain("claude-2 (you)");
  });

  test("two live Codex sessions in one folder: the second isn't the first, and joins as codex-2", async () => {
    const owner = scratch("own7");
    const code = created(await ok(owner, ["create", "codex", "--as", "boss"]));
    const h = scratch("codex");
    const T1 = { CODEX_THREAD_ID: "t1" };
    const T2 = { CODEX_THREAD_ID: "t2" };
    expect((await join_(owner, h, code, T1)).out).toContain('You\'re "codex"');
    const refused = await run(h, ["send", "who am i"], T2);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("in another session");
    expect((await join_(owner, h, code, T2)).out).toContain('You\'re "codex-2"');
    await ok(h, ["send", "from t1"], T1);
    await ok(h, ["send", "from t2"], T2);
    const log = await ok(owner, ["log"]);
    expect(log).toContain("codex → all: from t1");
    expect(log).toContain("codex-2 → all: from t2");
  });

  test("two agents of one machine let in under new names never lose each other's keys", async () => {
    const owner = scratch("own9");
    const code = created(await ok(owner, ["create", "keys", "--as", "boss"]));
    // Another computer already holds "claude".
    await join_(owner, scratch("remote"), code, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "rm", CLAUDE_PID: String(process.pid) });
    const h = scratch("twokeys");
    const d2 = join(h, "two");
    const d3 = join(h, "three");
    mkdirSync(d2);
    mkdirSync(d3);
    const procs = [Bun.spawn(["sleep", "120"]), Bun.spawn(["sleep", "120"])];
    const S2 = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s2", CLAUDE_PID: String(procs[0]!.pid) };
    const S3 = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s3", CLAUDE_PID: String(procs[1]!.pid) };
    try {
      // Locally they ask as claude and claude-2; the owner is offered claude-2 and claude-3.
      const j2 = spawn(h, ["join", code, "--timeout", "40s"], S2, d2);
      await until(async () => (await ok(owner, ["--as", "human", "requests"])).includes("claude-2"), "first request");
      const j3 = spawn(h, ["join", code, "--timeout", "40s"], S3, d3);
      let listed = "";
      await until(async () => {
        listed = await ok(owner, ["--as", "human", "requests"]);
        return (listed.match(/\d{3}-\d{3}/g) ?? []).length === 2;
      }, "both requests with codes");
      expect(listed).toContain("claude-3");
      expect(listed).not.toContain("claude-2-2");
      for (const c of listed.match(/\d{3}-\d{3}/g)!) await ok(owner, ["--as", "human", "approve", c, "--yes"]);
      expect(await j2.exited).toBe(0);
      expect(await j3.exited).toBe(0);
      await ok(h, ["send", "two here"], S2, d2);
      await ok(h, ["send", "three here"], S3, d3);
      const log = await ok(owner, ["log"]);
      expect(log).toMatch(/claude-[23] → all: two here/);
      expect(log).toMatch(/claude-[23] → all: three here/);
      const room = readdirSync(join(h, "identities"))[0]!;
      expect(readdirSync(join(h, "identities", room)).sort()).toEqual(["claude-2.json", "claude-3.json"]);
    } finally {
      for (const p of procs) p.kill();
    }
  });

  test("two joins at once on one machine ask under different names", async () => {
    const owner = scratch("own8");
    const code = created(await ok(owner, ["create", "race", "--as", "boss"]));
    const h = scratch("race");
    const d1 = join(h, "one");
    const d2 = join(h, "two");
    mkdirSync(d1);
    mkdirSync(d2);
    const [a, b] = await Promise.all([
      run(h, ["join", code, "--timeout", "3s"], { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "r1", CLAUDE_PID: String(process.pid) }, d1),
      run(h, ["join", code, "--timeout", "3s"], { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "r2", CLAUDE_PID: String(process.pid) }, d2),
    ]);
    const asked = [a.out, b.out].map((o) => /asked to join as (\S+)\./.exec(o)?.[1]).sort();
    expect(asked).toEqual(["claude", "claude-2"]);
  });
});

describe("Claude Code's hooks do the listening", () => {
  test("installed with asyncRewake; the listener wakes the session with the message; nothing nags about a Monitor", async () => {
    const owner = scratch("own4");
    const code = created(await ok(owner, ["create", "hooked", "--as", "boss"]));
    const h = scratch("hooked");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "L", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };
    const joined = await join_(owner, h, code, S);
    expect(joined.out).toContain("Kiwi's hooks wake you");
    expect(joined.out).not.toContain("Monitor");

    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8")) as { hooks: Record<string, { hooks: { command: string; asyncRewake?: boolean; async?: boolean }[] }[]> };
    for (const e of ["SessionStart", "UserPromptSubmit", "Stop"]) {
      const listener = settings.hooks[e]!.flatMap((x) => x.hooks).find((x) => x.command.endsWith(" hook listen # kiwi"));
      expect(listener).toMatchObject({ async: true, asyncRewake: true });
    }

    const input = JSON.stringify({ session_id: "L", cwd: h });
    expect((await run(h, ["hook", "session-start"], S, h, input)).out).toContain("arrive on their own");
    // Nothing listening yet, and still no nag: the hooks are the listener.
    expect((await run(h, ["hook", "stop"], S, h, input)).out).toBe("");

    const listening = spawn(h, ["hook", "listen"], S, h, input);
    // A second listener for the same agent steps aside at once.
    await until(() => existsSync(join(h, "listen-hooks")) && readdirSync(join(h, "listen-hooks")).length > 0, "listener slot");
    expect((await run(h, ["hook", "listen"], S, h, input)).code).toBe(0);
    await ok(owner, ["send", "--to", "claude", "wake up"]);
    expect(await listening.exited).toBe(2);
    expect(await new Response(listening.stderr).text()).toContain("boss → claude: wake up");

    // A listener whose session ends goes too, and leaves the next message unread for whoever comes next.
    const session = Bun.spawn(["sleep", "120"]);
    const orphan = spawn(h, ["hook", "listen"], { ...S, CLAUDE_CODE_SESSION_ID: "L2", CLAUDE_PID: String(session.pid) }, h, JSON.stringify({ session_id: "L2", cwd: h }));
    await Bun.sleep(1500);
    session.kill();
    expect(await orphan.exited).toBe(0);
    await ok(owner, ["send", "--to", "claude", "after the session ended"]);
    expect(await ok(h, ["read"], S)).toContain("after the session ended");

    // Peek: what the listener handed over is committed by the session's next hook, not by the listener.
    const peeking = spawn(h, ["hook", "listen"], S, h, input);
    await Bun.sleep(1000);
    await ok(owner, ["send", "--to", "claude", "handed, not yet read"]);
    expect(await peeking.exited).toBe(2);
    // The same session's next hook commits it: its prompt hook doesn't hand it over a second time.
    expect((await run(h, ["hook", "prompt"], S, h, input)).out).not.toContain("handed, not yet read");

    // A listener that hears a message but has nobody to hand it to (its session is gone) leaves it unread.
    await ok(owner, ["send", "--to", "claude", "nobody to hand this to"]);
    const late = await run(h, ["hook", "listen"], { ...S, CLAUDE_CODE_SESSION_ID: "L3", CLAUDE_PID: DEAD }, h, JSON.stringify({ session_id: "L3", cwd: h }));
    expect(late.code).toBe(0);
    expect(late.err).toBe("");
    expect(await ok(h, ["read"], S)).toContain("nobody to hand this to");
  });

  test("an older Claude Code, or none, gets the Monitor instructions and no listener", async () => {
    const owner = scratch("own5");
    const code = created(await ok(owner, ["create", "older", "--as", "boss"]));
    const h = scratch("older");
    // Its own settings: what an older Claude Code's join installs, with no listener in it.
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "O", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-100_agent", CLAUDE_CONFIG_DIR: scratch("older-claude") };
    const joined = await join_(owner, h, code, S);
    expect(joined.out).toContain("Start a Monitor on `");
    const input = JSON.stringify({ session_id: "O", cwd: h });
    expect(readFileSync(join(S.CLAUDE_CONFIG_DIR, "settings.json"), "utf8")).not.toContain("hook listen");
    const r = await run(h, ["hook", "listen"], S, h, input);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    // Without a listener, a stop with nothing listening still says to start one.
    expect((await run(h, ["hook", "stop"], S, h, input)).out).toContain("Start a Monitor");
  });
});

describe("what runs an agent", () => {
  test("an agent in a harness says its model or can't ask; the owner sees it, and approving signs it into the seat", async () => {
    const owner = scratch("own6");
    const code = created(await ok(owner, ["create", "runs", "--as", "boss"]));
    const h = scratch("runs");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "R", CLAUDE_PID: String(process.pid) };
    // No transcript for this session and nothing said: refused before any request is made.
    const refused = await run(h, ["join", code], { ...S, KIWI_MODEL: "" });
    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain("say what model runs you");
    expect(await ok(owner, ["--as", "human", "requests"])).toBe("no pending join requests\n");

    // Said outright: the request carries it, and the owner reads it next to the code.
    const joined = await join_(owner, h, code, { ...S, KIWI_MODEL: "claude-fable-5-1" });
    expect(joined.asked).toContain("runs claude-code · claude-fable-5-1");
    expect(joined.out).toContain('You\'re "claude" in channel "runs"');
    // Approved: the seat's record says so, owner-signed, and status shows it beside the card.
    const status = await ok(owner, ["--as", "human", "status"]);
    expect(status).toContain("runs claude-code · claude-fable-5-1 (owner-signed)");
    // The agent's card is its own word: naming another model there changes the card, not the record.
    await ok(h, ["card", "--model", "claude-opus-5-5"], S);
    const later = await ok(owner, ["--as", "human", "status"]);
    expect(later).toContain("runs claude-code · claude-fable-5-1 (owner-signed); its card says claude-opus-5-5");
  });

  test("a harness kiwi can't tell apart declares itself with --harness and --model", async () => {
    const owner = scratch("own7");
    const code = created(await ok(owner, ["create", "other", "--as", "boss"]));
    const h = scratch("other");
    // No harness marker at all: --harness alone is not enough, --model alone is not enough.
    const half = await run(h, ["join", code, "--as", "glm", "--harness", "opencode"], { CLAUDECODE: "", KIWI_MODEL: "" });
    expect(half.code).not.toBe(0);
    expect(half.err).toContain("--model");
    const p = spawn(h, ["join", code, "--as", "glm", "--harness", "OpenCode", "--model", "glm-5.3", "--timeout", "40s"], { CLAUDECODE: "", KIWI_MODEL: "" });
    let listed = "";
    await until(async () => {
      listed = await ok(owner, ["--as", "human", "requests"]);
      return /\d{3}-\d{3}/.test(listed);
    }, "request listed");
    expect(listed).toContain("glm · runs opencode · glm-5.3");
    await ok(owner, ["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
    expect(await p.exited).toBe(0);
    expect(await ok(owner, ["--as", "human", "status"])).toContain("runs opencode · glm-5.3 (owner-signed)");
  });
});

describe("--as", () => {
  test("a typo does not mint a new unused identity", async () => {
    const owner = scratch("as-typo");
    await ok(owner, ["create", "proj", "--as", "boss"]);
    const r = await run(owner, ["-c", "proj", "--as", "typo", "status"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('typo has no key in "proj" on this machine');
    const idDir = join(owner, "identities");
    const files = existsSync(idDir)
      ? readdirSync(idDir).flatMap((room) => readdirSync(join(idDir, room)))
      : [];
    expect(files.some((f) => f.toLowerCase().includes("typo"))).toBe(false);
  });
});
