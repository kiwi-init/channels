import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-filtered-relay-"));
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
  const d = mkdtempSync(join(tmpdir(), `kiwi-filtered-${tag}-`));
  made.push(d);
  return d;
};

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), { cwd: home, env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
}

async function run(home: string, ...args: string[]): Promise<{ code: number; out: string }> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0 && code !== 2) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
  return { code, out };
}

const ok = async (home: string, ...args: string[]) => (await run(home, ...args)).out;

async function join_(owner: string, joiner: string, code: string, name: string) {
  const p = spawn(joiner, ["join", code, "--as", name]);
  let listed = "";
  for (let i = 0; i < 300 && !new RegExp(`\\d{3}-\\d{3}\\s+${name}\\b`).test(listed); i++) {
    listed = await ok(owner, "--as", "human", "requests");
    await Bun.sleep(50);
  }
  await ok(owner, "--as", "human", "approve", new RegExp(`(\\d{3}-\\d{3})\\s+${name}\\b`).exec(listed)![1]!, "--yes");
  expect(await p.exited).toBe(0);
}

async function channel(tag: string): Promise<{ owner: string; dev: string }> {
  const owner = scratch(`${tag}-owner`);
  const dev = scratch(`${tag}-dev`);
  const code = /join code: (\S+)/.exec(await ok(owner, "create", tag, "--as", "lead"))![1]!;
  await join_(owner, dev, code, "dev");
  await ok(dev, "listen", "--now");
  return { owner, dev };
}

async function threadAndAside(owner: string): Promise<string> {
  const q = /#(\d+)/.exec(await ok(owner, "--as", "lead", "send", "--to", "dev", "which branch?"))![1]!;
  await ok(owner, "--as", "lead", "send", "--to", "dev", "the deploy is on hold");
  await ok(owner, "--as", "lead", "reply", q, "also: the lockfile");
  return q;
}

describe("a filtered read leaves unread what it didn't show (T137)", () => {
  test("listen --now --thread N shows that thread, and the next plain listen still gets the rest", async () => {
    const { owner, dev } = await channel("now");
    const q = await threadAndAside(owner);
    const thread = await ok(dev, "listen", "--now", "--thread", q);
    expect(thread).toContain("which branch?");
    expect(thread).toContain("also: the lockfile");
    expect(thread).not.toContain("the deploy is on hold");
    const rest = await ok(dev, "listen", "--now");
    expect(rest).toContain("the deploy is on hold");
    expect(rest).not.toContain("which branch?");
    expect(rest).not.toContain("also: the lockfile");
    expect(await ok(dev, "listen", "--now")).not.toContain("the deploy is on hold");
  });

  test("listen --once --thread N leaves the rest for the next listen too", async () => {
    const { owner, dev } = await channel("once");
    const q = await threadAndAside(owner);
    const heard = await run(dev, "listen", "--once", "--thread", q, "--timeout", "5s");
    expect(heard.out).toContain("which branch?");
    expect(heard.out).not.toContain("the deploy is on hold");
    const rest = await ok(dev, "listen", "--now");
    expect(rest).toContain("the deploy is on hold");
    expect(rest).not.toContain("also: the lockfile");
  });

  test("a webhook that fails keeps the message unread", async () => {
    const { owner, dev } = await channel("hook");
    let posts = 0;
    const hook = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        posts++;
        return new Response("down", { status: 500 });
      },
    });
    try {
      await ok(owner, "--as", "lead", "send", "--to", "dev", "the deploy is on hold");
      const watch = spawn(dev, ["listen", "--webhook", `http://127.0.0.1:${hook.port}/`]);
      for (let i = 0; i < 200 && posts === 0; i++) await Bun.sleep(50);
      watch.kill();
      await watch.exited;
      expect(posts).toBeGreaterThan(0);
    } finally {
      hook.stop(true);
    }
    expect(await ok(dev, "listen", "--now")).toContain("the deploy is on hold");
  });
});
