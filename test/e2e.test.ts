import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";

// KIWI_TEST_RELAY=http://localhost:8787 runs the suite against another relay,
// e.g. the Cloudflare one under `wrangler dev`.
const external = process.env.KIWI_TEST_RELAY;
// Real network round trips (and process spawns) need more than Bun's 5s default.
setDefaultTimeout(60_000);

/** Poll until `pred` holds. A fixed sleep is how this suite flakes when the machine is busy. */
async function untilTrue(pred: () => boolean | Promise<boolean>, label: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(25);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), "mc-relay-"));
let server: ReturnType<typeof startRelay> | undefined;
let relay: string;

beforeAll(() => {
  if (external) return void (relay = external);
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(async () => {
  // Close every channel the tests own, so nothing lingers on the relay (matters against a real one).
  for (const d of made) {
    try {
      const cfg = JSON.parse(readFileSync(join(d, "config.json"), "utf8")) as { channels: Record<string, { owner?: string }> };
      for (const [alias, c] of Object.entries(cfg.channels)) if (c.owner) await run(d, "-c", alias, "--as", c.owner, "close", "--yes");
    } catch {
      // No config.json (a home that never joined), or one that isn't JSON: nothing of it to close.
    }
  }
  server?.stop(true);
  // Test homes hold keys: don't leave them lying around in /tmp.
  for (const d of [dataDir, claudeDir, ...made]) rmSync(d, { recursive: true, force: true });
});

const MC = [process.execPath, join(import.meta.dir, "../src/cli/main.ts")];

// Tests never touch the real Claude Code settings.
const claudeDir = mkdtempSync(join(tmpdir(), "mc-claude-"));

/** Whether these args act as the owner's person seat: a person at a terminal, not an agent's harness. */
const asPerson = (args: string[]) => args.some((a, i) => a === "--as" && args[i + 1] === "human");

function mc(home: string, ...args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir, CLAUDECODE: asPerson(args) ? "" : "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = mc(home, ...args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const r = await run(home, ...args);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

/** Collect a long-running process's stdout lines as they arrive. */
function lines(p: ReturnType<typeof mc>) {
  const got: string[] = [];
  let buf = "";
  const reader = p.stdout.getReader();
  const done = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        got.push(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
  })();
  return {
    got,
    async until(pred: (l: string[]) => boolean, ms = 15_000) {
      const end = Date.now() + ms;
      while (!pred(got)) {
        if (Date.now() > end) throw new Error(`timed out; got:\n${got.join("\n")}`);
        await Bun.sleep(25);
      }
    },
    stop: async () => {
      p.kill();
      await p.exited;
      // Done with it once it has exited (test/proc.ts).
      await Promise.race([done, Bun.sleep(300)]);
      await reader.cancel().catch(() => {});
      await done.catch(() => {});
    },
  };
}

const made: string[] = [];
const home = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `mc-${tag}-`));
  made.push(d);
  return d;
};

/**
 * The code check, as people run it: the joiner asks; the owner's machine opens
 * the request (signing its half); the joiner then shows the code.
 */
async function codeShown(owner: string, l: { got: string[]; until: (f: (x: string[]) => boolean) => Promise<void> }): Promise<string> {
  await l.until((x) => x.some((y) => y.includes("waiting for the owner to open your request")));
  await ok(owner, "--as", "human", "requests");
  await l.until((x) => x.some((y) => /verification code \d{3}-\d{3}/.test(y)));
  return /verification code (\d{3}-\d{3})/.exec(l.got.join("\n"))![1]!;
}

/**
 * Join through the real flow: the joiner asks and waits, the owner's machine
 * sees the request, matches the verification code and approves.
 */
async function joinVia(owner: string, joiner: string, code: string, alias: string, name: string, role?: string): Promise<string> {
  const p = mc(joiner, "join", code, alias, "--as", name);
  const l = lines(p);
  const v = await codeShown(owner, l);
  expect(await ok(owner, "--as", "human", "requests")).toContain(`${v}  ${name}`);
  await ok(owner, "--as", "human", "approve", v, "--yes", ...(role ? ["--role", role] : []));
  expect(await p.exited).toBe(0);
  await l.until((x) => x.some((y) => y.includes("You're \"")));
  return l.got.join("\n");
}

describe("presence over a membership channel", () => {
  test("presence is relayed between members but never stored", async () => {
    const [human, mac, win] = await Promise.all([generateIdentity("human"), generateIdentity("mac"), generateIdentity("win")]);
    const { access } = await Channel.create(relay, human, { name: "human" }, [
      { ...mac, info: { name: "mac" } },
      { ...win, info: { name: "win" } },
    ]);
    const macCh = new Channel({ ...access, keys: { ...access.keys } }, relay, mac);
    const winCh = new Channel({ ...access, keys: { ...access.keys } }, relay, win);
    await macCh.send("before");
    const got: Message[] = [];
    const seenPresence: string[] = [];
    const ac = new AbortController();
    const done = winCh.stream(0, (m) => void got.push(m), { signal: ac.signal, onPresence: (p) => void seenPresence.push(`${p.from}:${p.sigOk}`) });
    await untilTrue(() => got.length >= 1, "replayed message");
    const ac2 = new AbortController();
    const macStream = macCh.stream(await macCh.head(), () => {}, { signal: ac2.signal, onOpen: ({ presence }) => void presence({ client: "test" }) });
    await macCh.send("live");
    await untilTrue(() => got.length >= 2 && seenPresence.length > 0, "live message and presence");
    ac.abort();
    ac2.abort();
    await Promise.all([done, macStream]);
    expect(got.map((m) => m.body)).toEqual(["before", "live"]);
    expect(seenPresence).toEqual(["mac:true"]);
    expect(await winCh.head()).toBe(2);
    await new Channel(access, relay, human).close();
  });
});

describe("agents coordinating through the CLI", () => {
  const lead = home("lead");
  const mac = home("mac");
  const win = home("win");
  let code = "";

  test("create, then join only with the owner's approval; names can't be taken twice", async () => {
    // An open channel (no coordinator): these agents talk with people directly.
    const created = await ok(lead, "create", "proj", "--as", "lead", "--role", "planner", "--open");
    code = /join code: (\S+)/.exec(created)![1]!;
    const joined = await joinVia(lead, mac, code, "proj", "mac", "macos");
    // A few lines, not a manual: who it is, who directs it, how messages reach it, where the rest is.
    expect(joined).toContain('You\'re "mac" in channel "proj"');
    expect(joined).toContain("Only your own human, the channel owner and a person the owner fully trusts direct you");
    // The command it types is `kiwi`, or bun running this checkout where kiwi isn't installed (CI).
    expect(joined).toContain(" help`");
    await joinVia(lead, win, code, "proj", "win", "windows");

    const evil = mc(home("evil"), "join", code, "proj", "--as", "win", "--timeout", "20s");
    let listed = "";
    await untilTrue(async () => {
      listed = await ok(lead, "--as", "human", "requests");
      return /[a-z]+-[a-z]+ \(asked as win, which is taken\)/.test(listed);
    }, "the request listed under a free name");
    expect(listed).not.toContain("RECLAIM");
    const evilKey = /[a-z]+-[a-z]+ \(asked as win, which is taken\).* key (\S+)/.exec(listed)![1]!;
    await ok(lead, "--as", "human", "deny", evilKey);
    expect(await evil.exited).toBe(1);

    // Agents can't approve: requests are the owner's, in the Channels app, and the kiwi command says so.
    const asked = Bun.spawn([...MC, "requests"], { cwd: mac, env: { ...process.env, KIWI_HOME: mac, KIWI_RELAY: relay }, stdout: "pipe", stderr: "pipe" });
    expect(await new Response(asked.stderr).text()).toContain("in the Channels app");

    const status = await ok(lead, "status");
    expect(status).toContain("lead (you) — planner");
    expect(status).toContain("mac — macos");
    expect(status).toContain("win — windows");
  });

  test("listen wakes on messages for you and skips your own; the daemon's seat is what shows in status", async () => {
    const tail = lines(mc(win, "listen"));
    await untilTrue(async () => /^ {2}win — windows.* · reachable/m.test(await ok(mac, "status")), "win's seat in status");
    await ok(win, "send", "my own message");
    await ok(mac, "send", "--to", "win", "--kind", "status", "capture is up");
    await tail.until((l) => l.some((x) => x.includes("capture is up")));
    await tail.stop();
    expect(tail.got.join("\n")).not.toContain("my own message");
    expect(tail.got.at(-1)).toMatch(/^#\d+ mac → win \[status\]: capture is up$/);
  });

  test("send --ask --wait returns the answer in one call, without a duplicate wake-up", async () => {
    const backlog = await ok(mac, "listen", "--now");
    expect(backlog).toContain("win → all [event]: joined");
    expect(backlog).not.toContain("forged");
    const asker = mc(mac, "send", "--ask", "--to", "win", "--wait", "30s", "which edge is the PC on?");
    const wait = await ok(win, "listen", "--once", "--timeout", "20s");
    const askSeq = /^#(\d+) mac → win \[ask\]/m.exec(wait)![1]!;
    await ok(win, "reply", askSeq, "the left edge");
    const answer = await new Response(asker.stdout).text();
    expect(await asker.exited).toBe(0);
    expect(answer.trim()).toMatch(new RegExp(`^#\\d+ win → mac re #${askSeq}: the left edge$`));
    expect(await ok(mac, "listen", "--now")).toBe("");
  });

  test("task board: owners, races and notifications", async () => {
    await ok(lead, "listen", "--now");
    const want = /#(\d+)/.exec(await ok(lead, "--as", "human", "send", "protocol v2, with a Windows client"))![1]!;
    const t1 = /added (T\d+)/.exec(await ok(lead, "task", "add", "Define protocol v2", "--ask", want))![1]!;
    // --after is gone: said so, and the task is still added (agents with older instructions keep working).
    const added = await run(lead, "task", "add", "Windows client for v2", "--owner", "win", "--after", t1, "--ask", want);
    expect(added.code).toBe(0);
    expect(added.err).toContain("--after is gone");
    const t2 = /added (T\d+)/.exec(added.out)![1]!;

    // win is told it was given a task.
    expect(await ok(win, "listen", "--now")).toContain(`added task ${t2} “Windows client for v2” for win`);

    // mac claims T1; win can't take it.
    expect(await ok(mac, "task", "claim", t1)).toBe(`${t1} doing @mac: Define protocol v2\n`);
    const stolen = await run(win, "task", "claim", t1);
    expect(stolen.code).toBe(1);
    expect(stolen.err).toContain("is owned by mac");

    // Finishing T1 notifies its creator.
    await ok(mac, "task", "done", t1, "spec in docs/v2.md");
    expect(await ok(lead, "listen", "--now")).toContain(`finished ${t1} “Define protocol v2”: spec in docs/v2.md`);

    const board = await ok(win, "task", "--all");
    expect(board).toMatch(new RegExp(`${t2}\\s+planned\\s+@win Windows client for v2`));
    expect(board).toMatch(new RegExp(`${t1}\\s+done\\s+@mac Define protocol v2`));

    // Handing it over is giving it to someone with where it stands.
    expect(await ok(win, "task", "assign", t2, "mac", "the socket code is on branch win/v2")).toBe(`${t2} is mac's now\n`);
    expect(await ok(win, "task", "show", t2)).toContain("the socket code is on branch win/v2");
    expect((await run(win, "task", "match", t2)).err).toContain("is gone");

    expect(await ok(mac, "task", "assign", t2, "win", "the client is urgent now", "--first")).toBe(`${t2} is win's now, before their other tasks\n`);
    expect(JSON.parse(await ok(win, "task", "show", t2, "--json")).first).toBeGreaterThan(0);
    await ok(win, "task", "drop", t2);
    expect((await run(lead, "task", "first", t2)).err).toContain("has no owner to go first for");
    await ok(lead, "task", "assign", t2, "win");
    expect(JSON.parse(await ok(win, "task", "show", t2, "--json")).first).toBeUndefined();
    await ok(lead, "task", "first", t2);
    expect(JSON.parse(await ok(win, "task", "show", t2, "--json")).first).toBeGreaterThan(0);

    // Cancelling finishes it, marked cancelled, but never around a review: its doer can't, someone else may.
    const t3 = /added (T\d+)/.exec(await ok(lead, "task", "add", "Spike the old transport", "--review", "any", "--from", t1))![1]!;
    await ok(win, "task", "claim", t3);
    const refused = await run(win, "task", "cancel", t3, "not needed");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("before it's cancelled");
    expect(await ok(lead, "task", "cancel", t3, "not needed")).toBe(`${t3} done (cancelled) @win: Spike the old transport\n`);
  });

  test("claims are gone, and the old commands say so without failing", async () => {
    for (const cmd of [["claim", "crates/net", "--ttl", "20m"], ["release"], ["claims"]]) {
      expect(await ok(win, ...cmd)).toBe("claims are gone: say what you're working on in the task, or post it\n");
    }
  });

  test("facts are shared and last write wins", async () => {
    await ok(mac, "note", "mac.ip", "192.168.1.20");
    await ok(win, "note", "mac.ip", "192.168.1.21");
    expect((await ok(lead, "note", "mac.ip")).trim()).toBe("192.168.1.21");
    expect(await ok(lead, "note")).toContain("mac.ip = 192.168.1.21  (win, ");
    expect((await run(lead, "note", "nope")).code).toBe(2);
  });

  test("role addressing and the status snapshot", async () => {
    await ok(lead, "send", "--ask", "--to", "role:windows", "status of the v2 client?");
    const status = await ok(win, "status");
    expect(status).toContain("waiting on you (1)");
    expect(status).toContain("status of the v2 client?");
    expect(status).toMatch(/tasks \(\d+ open, 2 done \(1 cancelled\)\)/);
    expect(status).toContain("mac.ip = 192.168.1.21");
  });
});

describe("leaving, removal and closing through the CLI", () => {
  test("access ends at once and every local copy is wiped", async () => {
    const owner = home("x-owner");
    const a = home("x-a");
    const b = home("x-b");
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "x", "--as", "boss"))![1]!;
    await joinVia(owner, a, code, "x", "alice");
    await joinVia(owner, b, code, "x", "bob");
    await ok(a, "send", "hi from alice");
    writeFileSync(join(a, "note.md"), "from a file\nsecond line\n");
    await ok(a, "send", "--file", join(a, "note.md"));
    expect(await ok(owner, "log")).toContain("from a file");
    const both = await run(a, "send", "words", "--file", join(a, "note.md"));
    expect(both.code).toBe(1);
    expect(both.err).toContain("give the text as words or with --file, not both");
    expect((await run(a, "send", "--file", join(a, "missing.md"))).err).toContain(`can't read ${join(a, "missing.md")}`);

    // alice leaves: she's out and forgets the channel; the owner's next command rotates the key.
    expect(await ok(a, "leave")).toContain("left");
    expect(await ok(a, "channels")).toBe("");
    // Her keys for this channel are destroyed with it, so no backup of the relay can ever be opened with them.
    expect(readdirSync(join(a, "identities"))).toEqual([]);
    expect(await ok(owner, "status", "--all")).toMatch(/left or removed: .*alice/);
    await ok(b, "send", "after alice left");
    expect(await ok(owner, "log")).toContain("after alice left");

    // bob is kicked: his next command fails, and his machine forgets the channel.
    expect(await ok(owner, "--as", "human", "kick", "bob")).toContain("rotated");
    const after = await run(b, "status");
    expect(after.code).toBe(4);
    expect(after.err).toContain("the owner removed you from this channel (x); forgot bob's key on this machine");
    expect(after.err).toContain("kiwi join CODE --as bob");
    expect(await ok(b, "channels")).toBe("");
    expect(readdirSync(join(b, "identities"))).toEqual([]);

    // The owner closes it: deleted at the relay, nothing left locally.
    expect((await run(owner, "--as", "human", "close")).err).toContain("go-ahead");
    expect(await ok(owner, "--as", "human", "close", "--yes")).toContain("closed");
    expect(await ok(owner, "channels")).toBe("");
    expect(readdirSync(join(owner, "identities"))).toEqual([]);
    expect(readdirSync(join(owner, "cache"))).toEqual([]);
    if (!external) expect(readdirSync(dataDir).filter((f) => f.endsWith(".sqlite")).length).toBeGreaterThan(0);
  });
});

describe("images and cross-channel tasks through the CLI", () => {
  test("quick, send --image, log markers, save, an oversize non-image refused, tasks --global", async () => {
    const a = home("imgcli");
    const created = await ok(a, "quick", "pics", "--as", "pic");
    const code = /join code: (\S+)/.exec(created)![1]!;
    expect(created).toContain('You\'re "pic" in channel "pics"');

    // No --as needed: the agent is called by what it runs in.
    const plain = await ok(home("plaincli"), "create", "plain");
    expect(plain).toMatch(/join code: \S+/);
    expect(plain).toContain('You\'re "claude" in channel "plain"');

    const dir = home("imgfiles");
    mkdirSync(dir, { recursive: true });
    const png = join(dir, "shot.png");
    await Bun.write(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    const sent = await ok(a, "send", "--image", png, "the dialog");
    const seq = /sent #(\d+)/.exec(sent)![1]!;
    expect(code.startsWith("mc2-")).toBe(true);
    expect(await ok(a, "log", "-n", "3")).toContain("[image: shot.png");
    expect(await ok(a, "show", seq, dir)).toContain(join(dir, `#${seq}-shot.png`));

    const big = join(dir, "big.png");
    await Bun.write(big, Buffer.alloc(300 * 1024));
    const rej = await run(a, "send", "--image", big, "too big");
    expect(rej.code).toBe(1);
    expect(rej.err).toContain("couldn't be read as an image");

    await ok(a, "create", "second", "--as", "pic");
    await ok(a, "--as", "human", "task", "add", "second task");
    const all = await ok(a, "task", "--global");
    expect(all).toContain("## pics");
    expect(all).toContain("## second");
    expect(all).toContain("second task");
  });

  test("listen --webhook POSTs every message to a webhook", async () => {
    const a = home("watcher");
    const created = await ok(a, "create", "w", "--as", "eye");
    const code = /join code: (\S+)/.exec(created)![1]!;
    const b = home("watchsender");
    await joinVia(a, b, code, "w", "peer");
    const hooks: string[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        if (req.method === "POST") hooks.push(await req.text());
        return new Response("ok");
      },
    });
    await ok(a, "listen", "--now");
    const watching = mc(a, "listen", "--webhook", `http://127.0.0.1:${server.port}/hook`);
    const linesP = lines(watching);
    await ok(b, "send", "ping the hook");
    // The first POST may be something else. Wait until this message's body is there, then stop.
    await untilTrue(
      () =>
        hooks.some((h) => {
          try {
            return (JSON.parse(h) as { text?: string }).text === "ping the hook";
          } catch {
            return false;
          }
        }),
      "webhook body",
    );
    watching.kill();
    await linesP.stop().catch(() => {});
    server.stop(true);
    expect(hooks.length).toBeGreaterThanOrEqual(1);
    const bodies = hooks.map((h) => JSON.parse(h) as { from: string; text: string; kind: string });
    expect(bodies).toContainEqual(expect.objectContaining({ channel: "w", from: "peer", text: "ping the hook", kind: "msg" }));
  });
});

describe("several agents on one machine", () => {
  test("each agent keeps its own name, by folder; nothing guesses between them", async () => {
    const owner = home("multi-owner");
    const shared = home("multi-shared"); // one KIWI_HOME, like two agents on the same Mac
    const dirA = home("multi-a");
    const dirB = home("multi-b");
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "m", "--as", "boss"))![1]!;

    const inDir = (dir: string, ...args: string[]) =>
      Bun.spawn(kiwiCmd(args), { cwd: dir, env: { ...process.env, KIWI_HOME: shared, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const runIn = async (dir: string, ...args: string[]) => {
      const p = inDir(dir, ...args);
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      return { code: await p.exited, out, err };
    };
    const joinFrom = async (dir: string, name: string) => {
      const p = inDir(dir, "join", code, "--as", name);
      const l = lines(p);
      await ok(owner, "--as", "human", "approve", await codeShown(owner, l), "--yes");
      expect(await p.exited).toBe(0);
    };
    await joinFrom(dirA, "alpha");
    await joinFrom(dirB, "beta"); // beta joined last: it must not take over alpha's folder

    expect((await runIn(dirA, "send", "from a")).code).toBe(0);
    expect((await runIn(dirB, "send", "from b")).code).toBe(0);
    const log = await ok(owner, "log");
    expect(log).toMatch(/alpha → all: from a/);
    expect(log).toMatch(/beta → all: from b/);

    // Outside either folder there's no way to know who's speaking: refuse instead of guessing.
    const elsewhere = home("multi-elsewhere");
    const r = await runIn(elsewhere, "send", "who am i");
    expect(r.code).toBe(1);
    expect(r.err).toContain("several agents on this machine are in this channel");
    expect((await runIn(elsewhere, "--as", "beta", "send", "explicit")).code).toBe(0);
  });

  test("agents in different channels on one machine never touch each other's state", async () => {
    const ownerA = home("iso-owner-a");
    const ownerB = home("iso-owner-b");
    const shared = home("iso-shared"); // one KIWI_HOME for every agent on this "machine"
    const [dirA, dirB, dirC, elsewhere] = [home("iso-a"), home("iso-b"), home("iso-c"), home("iso-elsewhere")];
    const codeA = /join code: (\S+)/.exec(await ok(ownerA, "create", "a", "--as", "boss"))![1]!;
    const codeB = /join code: (\S+)/.exec(await ok(ownerB, "create", "b", "--as", "boss"))![1]!;

    const inDir = (dir: string, ...args: string[]) =>
      Bun.spawn(kiwiCmd(args), { cwd: dir, env: { ...process.env, KIWI_HOME: shared, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const runIn = async (dir: string, ...args: string[]) => {
      const p = inDir(dir, ...args);
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      return { code: await p.exited, out, err };
    };
    const joinFrom = async (dir: string, owner: string, code: string, name: string) => {
      const p = inDir(dir, "join", code, "--as", name);
      const l = lines(p);
      await ok(owner, "--as", "human", "approve", await codeShown(owner, l), "--yes");
      expect(await p.exited).toBe(0);
    };
    // Joined concurrently, like separate sessions: neither may lose the other's config.
    await Promise.all([joinFrom(dirA, ownerA, codeA, "alpha"), joinFrom(dirB, ownerB, codeB, "beta")]);
    await joinFrom(dirC, ownerA, codeA, "gamma"); // a second local agent in channel a

    // Outside a bound folder, with several channels here, nothing picks one for you.
    const r = await runIn(elsewhere, "send", "where does this go");
    expect(r.code).toBe(1);
    expect(r.err).toContain("isn't bound to a channel");

    // Removing gamma forgets gamma only; alpha, in the same channel, keeps its key.
    await ok(ownerA, "--as", "human", "kick", "gamma");
    expect((await runIn(dirC, "status")).code).toBe(4);
    expect((await runIn(dirA, "send", "alpha still here")).code).toBe(0);

    // Closing b forgets b only; a is untouched.
    await ok(ownerB, "--as", "human", "close", "--yes");
    expect((await runIn(dirB, "status")).code).toBe(4);
    expect((await runIn(dirA, "send", "a is fine")).code).toBe(0);
    const cfg = JSON.parse(readFileSync(join(shared, "config.json"), "utf8")) as { channels: Record<string, unknown>; bindings: Record<string, { as: string }> };
    expect(Object.keys(cfg.channels)).toHaveLength(1);
    expect(Object.values(cfg.bindings).map((b) => b.as)).toEqual(["alpha"]);
    expect(await ok(ownerA, "log")).toMatch(/alpha → all: a is fine/);
  });

  test("a channel is called by its name on every machine that joins it", async () => {
    const owner = home("nm-owner");
    const joiner = home("nm-joiner");
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "launch-plan", "--as", "boss"))![1]!;
    const p = mc(joiner, "join", code, "--as", "w");
    const l = lines(p);
    await ok(owner, "--as", "human", "approve", await codeShown(owner, l), "--yes");
    expect(await p.exited).toBe(0);
    expect(await new Response(p.stderr).text()).toContain('joined "launch-plan" as w');
    expect(await ok(joiner, "channels")).toContain("launch-plan");
  });

  test("a home folder is never bound", async () => {
    const owner = home("hb-owner");
    const h = home("hb-home");
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "hb", "--as", "boss"))![1]!;
    const p = Bun.spawn([...MC, "join", code, "--as", "solo"], {
      cwd: h,
      env: { ...process.env, HOME: h, KIWI_HOME: h, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const l = lines(p);
    await ok(owner, "--as", "human", "approve", await codeShown(owner, l), "--yes");
    expect(await p.exited).toBe(0);
    expect(await new Response(p.stderr).text()).toContain("too broad");
    expect(JSON.parse(readFileSync(join(h, "config.json"), "utf8")).bindings ?? {}).toEqual({});
  });
});

describe("Claude Code hooks", () => {
  async function hook(dir: string, mcHome: string, event: string, input: object): Promise<string> {
    const p = Bun.spawn([...MC, "hook", event], {
      cwd: dir,
      env: { ...process.env, KIWI_HOME: mcHome, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "" },
      stdin: new TextEncoder().encode(JSON.stringify(input)),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    return out;
  }

  test("joining installs them; stop won't let an agent go idle behind or deaf", async () => {
    const o = home("hk-owner");
    const a = home("hk-agent");
    const code = /join code: (\S+)/.exec(await ok(o, "create", "hk", "--as", "boss"))![1]!;
    await joinVia(o, a, code, "hk", "worker");

    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    for (const e of ["SessionStart", "UserPromptSubmit", "Stop"]) expect(JSON.stringify(settings.hooks[e])).toContain("# kiwi");

    expect(await hook(a, a, "stop", { cwd: a, session_id: "s1" })).toBe("");

    // Unread messages always block a stop, and are handed to the agent.
    await ok(o, "send", "--to", "worker", "hello worker");
    const blocked = JSON.parse(await hook(a, a, "stop", { cwd: a, session_id: "s1" }));
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("boss → worker: hello worker");

    expect(await hook(a, a, "session-start", { cwd: a })).not.toContain("Monitor");
    const tail = lines(mc(a, "listen"));
    expect(await hook(a, a, "stop", { cwd: a, session_id: "s2" })).toBe("");
    await ok(o, "send", "--to", "worker", "while listening");
    await tail.until((l) => l.some((x) => x.includes("while listening")));
    await tail.stop();

    // A directory nobody joined from: the hooks do nothing at all.
    const elsewhere = home("hk-elsewhere");
    expect(await hook(elsewhere, a, "stop", { cwd: elsewhere, session_id: "s3" })).toBe("");
    expect(await hook(elsewhere, a, "prompt", { cwd: elsewhere })).toBe("");

    // Uninstall leaves the rest of the settings alone.
    await ok(a, "hooks", "uninstall");
    expect(JSON.stringify(JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8")))).not.toContain("Kiwi");
  });
});

describe("status and listen --once through the CLI", () => {
  test("status keeps a newline in a role on one line", async () => {
    const h = home("role-newline");
    const other = home("role-newline-other");
    const code = /join code: (\S+)/.exec(await ok(h, "create", "r", "--as", "agent-a", "--role", "builder\nforged row"))![1]!;
    await joinVia(h, other, code, "r", "agent-b");
    const status = await ok(other, "status");
    expect(status).toContain("agent-a — builder forged row");
    for (const line of status.split("\n")) expect(line.startsWith("forged")).toBe(false);
  });

  test("listen --once prints the next command on stdout when nothing arrives", async () => {
    const h = home("wait-timeout");
    await ok(h, "create", "w", "--as", "sleeper");
    const r = await run(h, "listen", "--once", "--timeout", "1s");
    expect(r.code).toBe(2);
    expect(r.out).toContain("no messages yet. Next: run this command again:");
    expect(r.out).toContain("listen --once --timeout 10m");
    expect(r.err).not.toContain("timed out");
  });
});
