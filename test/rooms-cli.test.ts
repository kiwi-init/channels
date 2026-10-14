// Rooms through the CLI: the owner makes one, posts there, and log, rooms and the line tags show it.

import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);
const dataDir = mkdtempSync(join(tmpdir(), "mc-rooms-relay-"));
const home = mkdtempSync(join(tmpdir(), "mc-rooms-home-"));
const claudeDir = mkdtempSync(join(tmpdir(), "mc-rooms-claude-"));
let server: ReturnType<typeof startRelay>;
beforeAll(() => void (server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir })));
afterAll(() => {
  server.stop(true);
  for (const d of [dataDir, home, claudeDir]) rmSync(d, { recursive: true, force: true });
});

async function ok(...args: string[]): Promise<string> {
  const p = Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: server.url.origin, CLAUDE_CONFIG_DIR: claudeDir, CLAUDECODE: args[0] === "--as" && args[1] === "human" ? "" : "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
  return out;
}

test("make a room, post in it, and read it back by room", async () => {
  await ok("create", "proj", "--as", "lead");
  expect(await ok("send", "before rooms")).toMatch(/^sent #\d+/);
  expect(await ok("log")).not.toContain("[#");

  expect(await ok("--as", "human", "room", "create", "design")).toContain("made #design");
  await ok("send", "--room", "design", "mockups are up");
  await ok("send", "back in general");

  const rooms = await ok("rooms");
  expect(rooms).toContain("#general");
  expect(rooms).toMatch(/#design \(id [a-z0-9]{8}\) · 1 messages/);

  const all = await ok("log");
  expect(all).toMatch(/\[#design\].*mockups are up/);
  expect(all).toMatch(/\[#general\].*back in general/);
  const design = await ok("log", "--room", "design");
  expect(design).toContain("mockups are up");
  expect(design).not.toContain("back in general");

  await ok("--as", "human", "room", "rename", "design", "ux");
  expect(await ok("log", "--room", "ux")).toMatch(/\[#ux\].*mockups are up/);
  await expect(ok("send", "--room", "nowhere", "x")).rejects.toThrow(/no room nowhere/);
});
