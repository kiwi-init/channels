// Coordinator mode by default (T1460): kiwi create starts it with its agent coordinating; removing the
// coordinator hands the role to the next agent in, and with none left nobody is refused for want of one.
import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const MC = [process.execPath, join(import.meta.dir, "../src/cli/main.ts")];
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-cf-relay-"));
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

const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "kiwi-cf-"));
  made.push(d);
  return d;
};

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), { cwd: home, env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
  return out;
}

test("a new channel starts coordinated; kicking the coordinator leaves the choice to the owner here (nobody is signed in)", async () => {
  const owner = scratch();
  const agent = scratch();
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "cf", "--as", "lead"))![1]!;
  const status = await ok(owner, "--as", "human", "status");
  expect(status).toContain("lead — coordinator");
  expect(status).toContain("you talk with lead");
  expect(await ok(owner, "--as", "human", "log", "--all")).toContain("turned on coordinator-only");
  const p = spawn(agent, ["join", code, "--as", "dev"]);
  let listed = "";
  for (let i = 0; i < 300 && !/\d{3}-\d{3}/.test(listed); i++) {
    listed = await ok(owner, "--as", "human", "requests");
    await Bun.sleep(50);
  }
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await p.exited).toBe(0);
  // dev isn't provably the owner's own agent on a relay without sign-in: it isn't made coordinator by itself.
  const kicked = await ok(owner, "--as", "human", "kick", "lead", "--yes");
  expect(kicked).toContain("nobody coordinates now");
  expect(await ok(owner, "--as", "human", "log", "--all")).not.toContain("made dev coordinator");
});
