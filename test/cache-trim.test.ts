import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { saveConfig, saveIdentity } from "../src/config.ts";
import { cachePath } from "../src/config/cache.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(240_000);

const SENDERS = 14;
const PER_SENDER = 114;
const home = mkdtempSync(join(tmpdir(), "kiwi-cache-trim-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-cache-trim-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
let roomId = "";

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  const owner = await generateIdentity("human");
  const reader = await generateIdentity("claude");
  const senders: Identity[] = [];
  for (let i = 0; i < SENDERS; i++) senders.push(await generateIdentity(`s${i}`));
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...reader, info: { name: "claude" } }, ...senders.map((s) => ({ ...s, info: { name: s.name } }))]);
  roomId = made.access.roomId;
  const ownerCh = new Channel(made.access, relay, owner);
  await ownerCh.send("early task", { kind: "event", ev: { op: "task.add", title: "a task from early on" } });
  await ownerCh.send("charter", { kind: "event", ev: { op: "charter.set", text: "the charter from early on" } });
  await Promise.all(
    senders.map(async (s) => {
      const ch = new Channel(await Channel.resume(relay, made.code, s), relay, s);
      for (let i = 0; i < PER_SENDER; i++) await ch.send(`${s.name} says ${i}`);
    }),
  );
  await ownerCh.send("late task", { kind: "event", ev: { op: "task.add", title: "a task from late on" } });
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, reader)), relay, code: made.code, as: "claude" } } });
  saveIdentity(reader, roomId);
});

afterAll(async () => {
  await stopDaemon(daemonSock(home)).catch(() => {});
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

async function kiwi(args: string[]): Promise<string> {
  const p = Bun.spawn(kiwiCmd(["-c", "test", "--as", "claude", ...args]), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDECODE: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

const lines = () => readFileSync(cachePath(roomId), "utf8").split("\n").filter(Boolean).length;

test("a long cache is trimmed to its newest messages above a local fold base, and the channel folds the same from it", async () => {
  const tasks = await kiwi(["tasks", "--all"]);
  const charter = (JSON.parse(await kiwi(["status", "--json"])) as { charter: unknown }).charter;
  expect(tasks).toContain("a task from early on");
  expect(tasks).toContain("a task from late on");
  expect(charter).toBe("the charter from early on");
  expect(existsSync(`${cachePath(roomId)}.base`)).toBe(true);
  expect(lines()).toBeLessThanOrEqual(320);
  expect(await kiwi(["tasks", "--all"])).toBe(tasks);
  expect((JSON.parse(await kiwi(["status", "--json"])) as { charter: unknown }).charter).toBe(charter);
  expect(await kiwi(["log", "-n", "3"])).toContain("says 113");
});
