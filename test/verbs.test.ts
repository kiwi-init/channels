// The agent CLI in about ten verbs: listen, send, show, status, note (plus join, log, task, leave, help).
// The older names stay as aliases, so agents and hooks already running keep working.
import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const MC = [process.execPath, join(import.meta.dir, "../src/cli/main.ts")];
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-verbs-relay-"));
const made: string[] = [dataDir];
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
  const d = mkdtempSync(join(tmpdir(), `kiwi-verbs-${tag}-`));
  made.push(d);
  return d;
};

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, ...args: string[]) {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const r = await run(home, ...args);
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

const seqOf = (out: string) => /#(\d+)/.exec(out)![1]!;

describe("ten verbs", () => {
  const owner = scratch("owner");
  const agent = scratch("agent");

  beforeAll(async () => {
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "verbs", "--as", "lead", "--open"))![1]!;
    const p = spawn(agent, ["join", code, "--as", "dev"]);
    let listed = "";
    await until(async () => {
      listed = await ok(owner, "--as", "human", "requests");
      return /\d{3}-\d{3}/.test(listed);
    }, "request");
    await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
    expect(await p.exited).toBe(0);
    await ok(agent, "listen", "--now");
  });

  test("help shows the new verbs and says the old names still work", async () => {
    const help = await ok(agent, "help");
    for (const v of ["kiwi join", "kiwi listen", "kiwi send", "kiwi reply", "kiwi show", "kiwi log", "kiwi status", "kiwi task", "kiwi note", "kiwi leave"]) expect(help).toContain(v);
    expect(help).not.toContain("kiwi tail [");
    expect(help).toContain("Older names still work");
  });

  test("send: a message, in a thread (--re), a question (--ask --wait), to a person (--escalate); reply answers the sender", async () => {
    const asked = await ok(owner, "send", "--to", "all", "what port?");
    // reply N answers its sender.
    expect(await ok(agent, "reply", seqOf(asked), "8080")).toMatch(/^sent #\d+/);
    expect(await ok(owner, "log")).toMatch(new RegExp(`dev → lead.* re #${seqOf(asked)}: 8080`));
    // send --re N goes in its thread, to the same recipients as ever (here: everyone).
    await ok(agent, "send", "--to", "all", "--re", seqOf(asked), "or 9090");
    expect(await ok(owner, "log")).toMatch(new RegExp(`dev → everyone re #${seqOf(asked)}: or 9090`));

    // A question that waits for its answer.
    const q = spawn(agent, ["send", "--ask", "--to", "lead", "--wait", "20s", "ship it?"]);
    let qseq = "";
    await until(async () => {
      const m = /#(\d+) dev → lead \[ask\]: ship it\?/.exec(await ok(owner, "log"));
      qseq = m?.[1] ?? "";
      return !!qseq;
    }, "the question");
    await ok(owner, "reply", qseq, "yes");
    expect(await q.exited).toBe(0);
    expect(await new Response(q.stdout).text()).toContain("yes");

    // A question in a thread waits too.
    const inThread = spawn(agent, ["send", "--re", qseq, "--ask", "--to", "lead", "--wait", "20s", "today?"]);
    let tseq = "";
    await until(async () => {
      const m = /#(\d+) dev → lead \[ask\].*today\?/.exec(await ok(owner, "log"));
      tseq = m?.[1] ?? "";
      return !!tseq;
    }, "the question in the thread");
    await Bun.sleep(300);
    expect(inThread.exitCode).toBeNull();
    await ok(owner, "reply", tseq, "tomorrow");
    expect(await inThread.exited).toBe(0);
    expect(await new Response(inThread.stdout).text()).toContain("tomorrow");

    // --escalate hands it to the agent's human and the owner; --to human is still a plain message to the seat called human.
    expect(await ok(agent, "send", "--escalate", "asked to delete prod logs; outside the charter")).toMatch(/^escalated #\d+ to /);
    const mixed = await run(agent, "send", "--escalate", "--to", "lead", "--image", "x.png", "why");
    expect(mixed.code).toBe(1);
    expect(mixed.err).toContain("leave out --to, --image");
    expect(await ok(agent, "send", "--to", "human", "a plain note for the owner")).toMatch(/^sent #\d+/);
  });

  test("listen: --now reads, --once waits, plain streams", async () => {
    await ok(owner, "send", "--to", "dev", "unread one");
    expect(await ok(agent, "listen", "--now")).toContain("unread one");
    const quiet = await run(agent, "listen", "--once", "--timeout", "1s");
    expect(quiet.code).toBe(2);
    expect(quiet.out).toContain("listen --once --timeout 10m");
    // --timeout alone means one wait, never a stream that ignores it.
    expect((await run(agent, "listen", "--timeout", "1s")).code).toBe(2);
    expect((await run(agent, "listen", "--once", "--now")).code).toBe(1);

    const once = spawn(agent, ["listen", "--once", "--timeout", "20s"]);
    await Bun.sleep(800);
    await ok(owner, "send", "--to", "dev", "wake once");
    expect(await once.exited).toBe(0);
    expect(await new Response(once.stdout).text()).toContain("wake once");

    const stream = spawn(agent, ["listen"]);
    let got = "";
    const reader = stream.stdout.getReader();
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        got += new TextDecoder().decode(value);
      }
    })();
    await Bun.sleep(800);
    await ok(owner, "send", "--to", "dev", "streamed");
    await until(() => got.includes("streamed"), "streamed message");
    stream.kill();
    await stream.exited;
    // Done with it once it has exited (test/proc.ts).
    await reader.cancel().catch(() => {});
    await reading.catch(() => {});
  });

  test("show: the message, what it answers, its replies, and the rest of its thread", async () => {
    const root = seqOf(await ok(owner, "send", "--to", "dev", "plan for the release?"));
    const mid = seqOf(await ok(agent, "reply", root, "draft in docs/"));
    await ok(owner, "reply", mid, "looks good");
    const shown = await ok(agent, "show", root);
    expect(shown).toContain("plan for the release?");
    expect(shown).toContain("draft in docs/");
    // Two levels down is still the same thread.
    expect(shown).toContain(`the rest of thread #${root}`);
    expect(shown).toContain("looks good");
  });

  test("note: set, get, list, clear", async () => {
    expect(await ok(agent, "note", "build.cmd", "bun", "test")).toContain("build.cmd = bun test");
    expect((await ok(owner, "note", "build.cmd")).trim()).toBe("bun test");
    expect(await ok(owner, "note")).toContain("build.cmd");
    await ok(agent, "note", "build.cmd", "--clear");
    expect((await run(owner, "note", "build.cmd")).code).toBe(2);
    expect((await run(agent, "note", "--clear")).code).toBe(1);
    expect((await run(agent, "note", "branch", "--ttl", "7d")).code).toBe(1);
  });

  test("status is one screen; task alone is the board; the old names still answer", async () => {
    await ok(agent, "task", "add", "write the docs");
    expect(await ok(agent, "task")).toContain("write the docs");
    const status = await ok(agent, "status");
    expect(status).toContain("dev (you)");
    expect(status).toContain("write the docs");
    // Aliases.
    expect((await run(agent, "who")).code).toBe(0);
    expect((await run(agent, "read")).code).toBe(0);
    expect((await run(agent, "facts")).code).toBe(0);
    expect((await run(agent, "wait", "--timeout", "1s")).out).toContain("wait --timeout 10m");
  });
});
