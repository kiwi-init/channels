import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";
import { kiwiCmd } from "./owner.ts";
import { trafficProxy } from "./traffic.ts";

setDefaultTimeout(60_000);

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-join-wait-${tag}-`));
  made.push(d);
  return d;
};
let server: ReturnType<typeof startRelay>;
let relay: string;
beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch("relay") });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

async function owned() {
  const owner = await generateIdentity("boss");
  const { code, access } = await Channel.create(relay, owner, { name: "boss" });
  return { code, ownerCh: new Channel(access, relay, owner) };
}

async function asking() {
  const { code, ownerCh } = await owned();
  const joiner = await generateIdentity("win");
  const { requestId } = await Channel.requestJoin(relay, code, joiner, { name: "win" });
  const first = await Channel.watchJoin(relay, code, joiner, requestId, null, 20);
  return { code, ownerCh, joiner, requestId, first };
}

async function timed<T>(p: Promise<T>): Promise<{ got: T; ms: number }> {
  const start = Date.now();
  const got = await p;
  return { got, ms: Date.now() - start };
}

async function raw(code: string, id: Identity, path: string, headers: Record<string, string> = {}) {
  const roomId = decodeJoinCode(code).roomId;
  const u = new URL(`/v1/rooms/${roomId}${path}`, relay);
  const authorization = `Bearer ${await signRequest(id, roomId, "GET", path, "")}`;
  return timed(fetch(u, { headers: { authorization, ...headers } }));
}

describe("join waits on the relay instead of polling it", () => {
  test("the first look answers at once, with a tag to wait on", async () => {
    const { first } = await asking();
    expect(first.status).toEqual({ status: "pending", code: null });
    expect(first.tag).toMatch(/^"request-/);
  });

  test("the code appears as soon as the owner opens the request", async () => {
    const { code, ownerCh, joiner, requestId, first } = await asking();
    const watching = timed(Channel.watchJoin(relay, code, joiner, requestId, first.tag, 20));
    await Bun.sleep(300);
    const budget = memoryBudget();
    await ownerCh.requests({ budget });
    const { got, ms } = await watching;
    expect(ms).toBeLessThan(5_000);
    const shown = got.status?.status === "pending" ? got.status.code : null;
    expect(shown).toMatch(/^\d{3}-\d{3}$/);
    expect(got.tag).not.toBe(first.tag);
    const [seen] = await ownerCh.requests({ budget });
    expect(seen!.code).toBe(shown);
  });

  test("approval wakes the wait and hands over the keys", async () => {
    const { code, ownerCh, joiner, requestId, first } = await asking();
    const budget = memoryBudget();
    await ownerCh.requests({ budget });
    const shown = await Channel.watchJoin(relay, code, joiner, requestId, first.tag, 20);
    const revealed = await Channel.watchJoin(relay, code, joiner, requestId, shown.tag, 20);
    expect(revealed.status).toEqual(shown.status);
    const watching = timed(Channel.watchJoin(relay, code, joiner, requestId, revealed.tag, 20));
    await Bun.sleep(300);
    const [req] = await ownerCh.requests({ budget });
    expect(req!.check).toBe("ready");
    await ownerCh.approve(req!);
    const { got, ms } = await watching;
    expect(ms).toBeLessThan(5_000);
    expect(got.status).toMatchObject({ status: "approved", access: { roomId: decodeJoinCode(code).roomId } });
  });

  test("denial wakes the wait", async () => {
    const { code, ownerCh, joiner, requestId, first } = await asking();
    const watching = timed(Channel.watchJoin(relay, code, joiner, requestId, first.tag, 20));
    await Bun.sleep(300);
    await ownerCh.deny(requestId);
    const { got, ms } = await watching;
    expect(ms).toBeLessThan(5_000);
    expect(got.status).toEqual({ status: "denied" });
  });

  test("with nothing new, the wait ends after the time asked and says nothing changed", async () => {
    const { code, joiner, requestId, first } = await asking();
    const { got, ms } = await timed(Channel.watchJoin(relay, code, joiner, requestId, first.tag, 1));
    expect(ms).toBeGreaterThanOrEqual(900);
    expect(ms).toBeLessThan(5_000);
    expect(got).toEqual({ tag: first.tag, status: null });
  });

  test("a write that leaves the request as it was doesn't end the wait", async () => {
    const { code, ownerCh, joiner, requestId, first } = await asking();
    const watching = timed(Channel.watchJoin(relay, code, joiner, requestId, first.tag, 2));
    await Bun.sleep(300);
    await ownerCh.send("unrelated");
    const { got, ms } = await watching;
    expect(ms).toBeGreaterThanOrEqual(1_900);
    expect(got).toEqual({ tag: first.tag, status: null });
  });

  test("an old client that polls without waiting gets its answer at once, as before", async () => {
    const { code, ownerCh, joiner, requestId, first } = await asking();
    const plain = await raw(code, joiner, `/requests/${requestId}`);
    expect(plain.ms).toBeLessThan(1_000);
    expect(plain.got.status).toBe(200);
    expect(await plain.got.json()).toEqual({ status: "pending", ownerNonce: null, revealed: false });
    const unchanged = await raw(code, joiner, `/requests/${requestId}`, { "if-none-match": first.tag! });
    expect(unchanged.ms).toBeLessThan(1_000);
    expect(unchanged.got.status).toBe(304);
    expect(await Channel.joinStatus(relay, code, joiner, requestId)).toEqual({ status: "pending", code: null });
    await ownerCh.requests({ budget: memoryBudget() });
    expect(await Channel.joinStatus(relay, code, joiner, requestId)).toMatchObject({ status: "pending", code: expect.stringMatching(/^\d{3}-\d{3}$/) });
  });

  test("a stranger's key can't wait on someone else's request", async () => {
    const { code, requestId } = await asking();
    const stranger = await generateIdentity("eve");
    const { got } = await raw(code, stranger, `/requests/${requestId}?wait=5`, { "if-none-match": "*" });
    expect(got.status).toBe(404);
  });
});

describe("kiwi join", () => {
  function joining(home: string, proxy: string, code: string, timeout: string) {
    return Bun.spawn(kiwiCmd(["join", code, "--as", "dev", "--model", "test-model", "--timeout", timeout]), {
      cwd: home,
      env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: proxy, KIWI_NO_HOOKS: "1" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  test("waits out its timeout in a couple of requests, not a poll every 1.5 s", async () => {
    const proxy = trafficProxy(relay);
    try {
      const { code } = await owned();
      const p = joining(scratch("agent"), proxy.url, code, "4s");
      const [, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      expect(await p.exited).toBe(3);
      expect(err).toContain("run exactly the same command again");
      expect(proxy.reset().routes["GET /requests/:id"]).toBeLessThanOrEqual(2);
    } finally {
      proxy.stop();
    }
  });

  test("shows the code and joins as soon as the owner approves", async () => {
    const proxy = trafficProxy(relay);
    try {
      const { code, ownerCh } = await owned();
      const p = joining(scratch("agent"), proxy.url, code, "60s");
      const out = new Response(p.stdout).text();
      const budget = memoryBudget();
      const deadline = Date.now() + 20_000;
      let ready = (await ownerCh.requests({ budget }))[0];
      while (ready?.check !== "ready") {
        if (Date.now() > deadline) throw new Error("the request never got its code");
        await Bun.sleep(100);
        ready = (await ownerCh.requests({ budget }))[0];
      }
      const approved = Date.now();
      await ownerCh.approve(ready);
      expect(await p.exited).toBe(0);
      expect(Date.now() - approved).toBeLessThan(10_000);
      const printed = await out;
      expect(printed).toContain(`verification code ${ready.code}`);
      expect(proxy.reset().routes["GET /requests/:id"]).toBeLessThanOrEqual(6);
    } finally {
      proxy.stop();
    }
  });
});
