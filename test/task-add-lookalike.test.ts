import { spawnOwned } from "./owned.ts";
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(90_000);

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-lookalike-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const owner = scratch("owner");
let server: ReturnType<typeof startRelay> | undefined;

async function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = spawnOwned(kiwiCmd(["--as", "human", ...args]), {
    cwd: owner,
    env: { ...process.env, KIWI_HOME: owner, KIWI_RELAY: server!.url.origin, KIWI_NO_HOOKS: "1", CLAUDECODE: "" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(...args: string[]): Promise<string> {
  const r = await run(...args);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const p = spawnOwned(kiwiCmd(["create", "lookalike", "--as", "boss"]), {
    cwd: owner,
    env: { ...process.env, KIWI_HOME: owner, KIWI_RELAY: server.url.origin, KIWI_NO_HOOKS: "1", CLAUDECODE: "" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await p.exited).toBe(0);
});

afterAll(() => {
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

test("the goal line after an add reads as a hint, under the line that says the task was added (#2697)", async () => {
  const ask = /#(\d+)/.exec(await ok("send", "a fresh ask for the hint"))![1]!;
  const [added, hint] = (await ok("task", "add", "write the hint test", "--ask", ask)).trim().split("\n");
  expect(added).toMatch(/^added T\d+$/);
  expect(hint).toBe(`hint: #${ask} has no goal yet. The task is added; to name a goal for the board: kiwi goal ${ask} "0.27.7: …"`);
});

test("a rerun of task add refuses the lookalike instead of creating a duplicate; --force creates it (#2697)", async () => {
  const ask = /#(\d+)/.exec(await ok("send", "can the seats move weekly?"))![1]!;
  const first = await ok("task", "add", "rotate the seats", "--ask", ask);
  const added = first.trim().split("\n")[0];
  const task = /^added (T\d+)/.exec(added ?? "")![1]!;

  const again = await run("task", "add", "rotate the seats", "--ask", ask, "--start", "--goal", "Seats rotated");
  expect(again.code).not.toBe(0);
  expect(again.out).not.toContain("added");
  expect(again.err).toContain(`not added: "rotate the seats" looks like ${task}, still open`);
  expect(again.err).toContain("--force");

  const board = await ok("task", "--all");
  expect(count(board, "rotate the seats")).toBe(1);
  expect(board).not.toContain("Seats rotated");
  expect(board).not.toContain("working");

  const forced = await ok("task", "add", "rotate the seats", "--ask", ask, "--force", "--start", "--goal", "Seats rotated");
  expect(forced).toMatch(/^added T\d+/);
  expect(forced).toContain(`added anyway (--force): looks like ${task}`);
  const after = await ok("task", "--all");
  expect(count(after, "rotate the seats")).toBe(2);
  expect(after).toContain("Seats rotated");
  expect(after).toContain("working   @human rotate the seats");
});
