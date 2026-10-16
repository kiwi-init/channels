import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeJoinCode } from "../src/crypto.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(180_000);

const BUDGET = {
  unchanged: { membersOk: 0, membersBytes: 0, infoOk: 0 },
} as const;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-roster-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;
let code = "";

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
  const exit = await p.exited;
  if (exit !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${exit}: ${err}`);
  return out;
}

async function until(pred: () => Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

async function admit(home: string, name: string): Promise<void> {
  const joining = spawn(home, ["join", code, "--as", name]);
  let listed = "";
  await until(async () => {
    listed = await ok(owner, "--as", "human", "requests");
    return /\d{3}-\d{3}/.test(listed);
  }, `${name}'s request`);
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await joining.exited).toBe(0);
}

const owner = scratch("owner");
const agent = scratch("agent");
const third = scratch("third");

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  code = /join code: (\S+)/.exec(await ok(owner, "create", "roster", "--as", "lead", "--open"))![1]!;
  await admit(agent, "dev");
  for (let i = 0; i < 3; i++) await ok(owner, "--as", "lead", "send", `warm-up ${i}`);
  await ok(agent, "listen", "--now");
});

afterAll(() => {
  proxy?.stop();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

interface Look {
  out: string;
  t: Traffic;
  membersOk: number;
  members304: number;
  membersBytes: number;
  infoOk: number;
  info304: number;
  infoBytes: number;
}

const look = async (label: string, ...args: string[]): Promise<Look> => {
  await Bun.sleep(100);
  proxy!.reset();
  const out = await ok(agent, ...args);
  await Bun.sleep(200);
  const t = proxy!.reset();
  const l: Look = {
    out,
    t,
    membersOk: t.statuses["GET /members 200"] ?? 0,
    members304: t.statuses["GET /members 304"] ?? 0,
    membersBytes: t.routeBytes["GET /members"] ?? 0,
    infoOk: t.statuses["GET /info 200"] ?? 0,
    info304: t.statuses["GET /info 304"] ?? 0,
    infoBytes: t.routeBytes["GET /info"] ?? 0,
  };
  console.log(
    `${label}: ${t.http} http, ${t.bytesDown} B down; GET /members ${l.membersOk}x200 ${l.members304}x304 ${l.membersBytes} B; GET /info ${l.infoOk}x200 ${l.info304}x304 ${l.infoBytes} B`,
  );
  return l;
};

describe("the roster and the channel info, fetched only when they changed", () => {
  test("listen --now and status, twice, with nothing changed", async () => {
    await look("listen --now (first)", "listen", "--now");
    await look("status (first)", "status");
    for (const args of [["listen", "--now"], ["status"]]) {
      const l = await look(`${args.join(" ")} (again, nothing changed)`, ...args);
      expect(l.membersOk).toBeLessThanOrEqual(BUDGET.unchanged.membersOk);
      expect(l.membersBytes).toBeLessThanOrEqual(BUDGET.unchanged.membersBytes);
      expect(l.infoOk).toBeLessThanOrEqual(BUDGET.unchanged.infoOk);
      expect(l.members304 + l.info304).toBeGreaterThan(0);
    }
  });

  test("a new member: the next look fetches the fresh roster", async () => {
    await admit(third, "qa");
    const l = await look("status (after a new member)", "status");
    expect(l.membersOk).toBeGreaterThanOrEqual(1);
    expect(l.out).toContain("qa");
    const again = await look("status (again)", "status");
    expect(again.membersOk).toBe(0);
    expect(again.out).toContain("qa");
  });

  test("the relay answers 304 only for the tag it would send, weak or strong", async () => {
    const { roomId, ownerFp } = decodeJoinCode(code);
    const url = `${server!.url.origin}/v1/rooms/${roomId}/info?fp=${ownerFp}`;
    const plain = await fetch(url);
    const etag = plain.headers.get("etag")!;
    expect(plain.status).toBe(200);
    expect(etag).toMatch(/^"info-/);
    expect(plain.headers.get("access-control-expose-headers")).toContain("etag");
    const body = await plain.text();
    for (const sent of [etag, `W/${etag}`, `"other", ${etag}`]) {
      const res = await fetch(url, { headers: { "if-none-match": sent } });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    }
    const stale = await fetch(url, { headers: { "if-none-match": '"info-stale"' } });
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe(body);
    const pre = await fetch(url, { method: "OPTIONS" });
    expect(pre.headers.get("access-control-allow-headers")).toContain("if-none-match");
    const gone = await fetch(`${server!.url.origin}/v1/rooms/${roomId}/members`, { headers: { "if-none-match": etag } });
    expect(gone.status).toBe(401);
  });

  test("a member leaves: the next look fetches the fresh roster and info", async () => {
    await ok(third, "leave");
    const l = await look("status (after qa left)", "status");
    expect(l.membersOk).toBeGreaterThanOrEqual(1);
    expect(l.infoOk).toBeGreaterThanOrEqual(1);
    const again = await look("status (again)", "status");
    expect(again.membersOk + again.infoOk).toBe(0);
  });
});
