import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, INFO_MAX_AGE_MS } from "../src/client.ts";
import { generateIdentity } from "../src/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { trafficProxy } from "./traffic.ts";

setDefaultTimeout(120_000);

const INFO_PER_COMMAND = 1;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-budget-info-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: proxy!.url, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

async function until(pred: () => Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const owner = scratch("owner");
const agent = scratch("agent");

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "budget-info", "--as", "lead", "--open"))![1]!;
  const joining = spawn(agent, ["join", code, "--as", "dev"]);
  let listed = "";
  await until(async () => {
    listed = await ok(owner, "--as", "human", "requests");
    return /\d{3}-\d{3}/.test(listed);
  }, "request");
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await joining.exited).toBe(0);
  for (let i = 0; i < 3; i++) await ok(owner, "--as", "lead", "send", `warm-up ${i}`);
  await ok(agent, "listen", "--now");
});

afterAll(() => {
  proxy?.stop();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const infoReads = async (label: string, args: string[]): Promise<number> => {
  await Bun.sleep(100);
  proxy!.reset();
  await ok(agent, ...args);
  await Bun.sleep(200);
  const t = proxy!.reset();
  const n = t.routes["GET /info"] ?? 0;
  console.log(`${label}: ${n} GET /info of ${t.http} http ${JSON.stringify(t.routes)}`);
  return n;
};

describe("GET /info at most once per agent command (one shared read per process)", () => {
  test("kiwi send", async () => {
    expect(await infoReads("send", ["send", "hello from the info budget"])).toBeLessThanOrEqual(INFO_PER_COMMAND);
  });

  test("kiwi listen --now with one new message", async () => {
    await ok(owner, "--as", "lead", "send", "one new");
    expect(await infoReads("listen --now", ["listen", "--now"])).toBeLessThanOrEqual(INFO_PER_COMMAND);
  });

  test("kiwi status", async () => {
    expect(await infoReads("status", ["status"])).toBeLessThanOrEqual(INFO_PER_COMMAND);
  });

  test("kiwi tasks", async () => {
    expect(await infoReads("tasks", ["tasks"])).toBeLessThanOrEqual(INFO_PER_COMMAND);
  });

  test("kiwi rooms", async () => {
    expect(await infoReads("rooms", ["rooms"])).toBeLessThanOrEqual(INFO_PER_COMMAND);
  });
});

describe("the app's reads of one channel", () => {
  test("title, mode, guard and rooms asked together share one GET /info, and the next ask reads afresh", async () => {
    const owner = await generateIdentity("human");
    const made = await Channel.create(proxy!.url, owner, { name: "human" }, [], undefined, undefined, "first");
    const app = new Channel(made.access, proxy!.url, owner);
    const other = new Channel(made.access, proxy!.url, owner);
    await Bun.sleep(100);
    proxy!.reset();
    const [title] = await Promise.all([app.title(), app.mode(), app.guard(), app.rooms(), app.info()]);
    const together = proxy!.reset().routes["GET /info"] ?? 0;
    console.log(`app open: ${together} GET /info for title, mode, guard, rooms and info`);
    expect(title).toBe("first");
    expect(together).toBe(1);
    await other.setTitle("second");
    expect(await app.title()).toBe("second");
  });

  test("a session keeps its read until it changes the info itself", async () => {
    const owner = await generateIdentity("human");
    const made = await Channel.create(proxy!.url, owner, { name: "human" }, [], undefined, undefined, "first");
    const kept = new Channel(made.access, proxy!.url, owner, undefined, { keepInfo: true });
    await Bun.sleep(100);
    proxy!.reset();
    expect(await kept.title()).toBe("first");
    await kept.mode();
    await kept.guard();
    expect(proxy!.reset().routes["GET /info"] ?? 0).toBe(1);
    await kept.setTitle("second");
    expect(await kept.title()).toBe("second");
    await kept.setCharter({ text: "Docs only.", since: 1 });
    expect((await kept.guard())?.charter).toEqual({ text: "Docs only.", since: 1 });
  });

  test("a kept read hands each caller its own copy", async () => {
    const owner = await generateIdentity("human");
    const made = await Channel.create(proxy!.url, owner, { name: "human" }, [], undefined, undefined, "first");
    const kept = new Channel(made.access, proxy!.url, owner, undefined, { keepInfo: true });
    const first = await kept.info();
    const epoch = first.epoch;
    first.epoch = epoch + 7;
    first.title = null;
    const again = await kept.info();
    expect(again.epoch).toBe(epoch);
    expect(again.title).not.toBeNull();
    expect(await kept.title()).toBe("first");
  });

  test("a kept read expires: past its max age the next read goes to the relay and sees another client's change", async () => {
    expect(INFO_MAX_AGE_MS).toBe(30_000);
    const owner = await generateIdentity("human");
    const made = await Channel.create(proxy!.url, owner, { name: "human" }, [], undefined, undefined, "first");
    const kept = new Channel(made.access, proxy!.url, owner, undefined, { keepInfo: true, infoMaxAgeMs: 300 });
    const other = new Channel(made.access, proxy!.url, owner);
    await Bun.sleep(100);
    proxy!.reset();
    expect(await kept.title()).toBe("first");
    await other.setTitle("second");
    await other.setCharter({ text: "Docs only.", since: 1 });
    proxy!.reset();
    expect(await kept.title()).toBe("first");
    expect(await kept.guard()).toBeNull();
    expect(proxy!.reset().routes["GET /info"] ?? 0).toBe(0);
    await Bun.sleep(400);
    expect(await kept.title()).toBe("second");
    expect((await kept.guard())?.charter).toEqual({ text: "Docs only.", since: 1 });
    const after = proxy!.reset().routes["GET /info"] ?? 0;
    console.log(`after max age: ${after} GET /info for title and guard`);
    expect(after).toBe(1);
  });
});
