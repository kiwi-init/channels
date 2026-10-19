import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { saveConfig, saveIdentity } from "../src/config.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-log-json-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-log-json-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  const owner = await generateIdentity("human");
  const reader = await generateIdentity("claude");
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...reader, info: { name: "claude" } }]);
  const ownerCh = new Channel(made.access, relay, owner);
  const early = await ownerCh.send("before the compaction", { to: ["claude"] });
  await ownerCh.send(`compacted the history through #${early}`, { kind: "event", ev: { op: "compact", summary: "Nothing open.", through: early } });
  await ownerCh.send("after the compaction", { to: ["claude"] });
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, reader)), relay, code: made.code, as: "claude" } } });
  saveIdentity(reader, made.access.roomId);
});

afterAll(async () => {
  await stopDaemon(daemonSock(home)).catch(() => {});
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

async function kiwi(args: string[]): Promise<{ out: string; err: string }> {
  const p = Bun.spawn(kiwiCmd(["-c", "test", "--as", "claude", ...args]), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDECODE: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return { out, err };
}

test("log --json prints only JSON Lines on stdout, and the compaction notice goes to stderr", async () => {
  const { out, err } = await kiwi(["log", "--json"]);
  const lines = out.split("\n").filter(Boolean);
  expect(lines.length).toBeGreaterThan(0);
  const bodies = lines.map((line) => (JSON.parse(line) as { body: string }).body);
  expect(bodies).toContain("after the compaction");
  expect(bodies).not.toContain("before the compaction");
  expect(err).toContain("history compacted through");
});

test("plain log still says the history was compacted", async () => {
  const { out } = await kiwi(["log"]);
  expect(out).toContain("history compacted through");
});
