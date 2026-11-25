import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { b64url, newChannelKey } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { LIVE_LIMITS, liveState, MAX_LIVE_BLOBS, openLive, sealLive, wellFormedLiveBlob, wellFormedLiveTokens, type LiveBlob } from "@kiwi/core/live.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { APNS_SANDBOX_HOST, LIVE_STALE_S, liveBody, pusherFrom, type LiveSend, type Pusher } from "../src/relay/push.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const ROOM = "r".repeat(22);
const START = "5a".repeat(80);
const UPDATE = "6b".repeat(40);
const pem = (der: ArrayBuffer): string => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----\n`;

const longest = (i: number) =>
  liveState({
    name: `agent-${i}`.padEnd(LIVE_LIMITS.n + 10, "x"),
    face: "reviewer".padEnd(LIVE_LIMITS.f + 5, "y"),
    color: "#ff00aa".padEnd(LIVE_LIMITS.c + 5, "z"),
    task: `T${1000 + i} `.padEnd(LIVE_LIMITS.t + 40, "ü"),
    since: 1_800_000_000_000,
    title: "a channel with a long name".padEnd(LIVE_LIMITS.h + 20, "é"),
  });

describe("a live blob", () => {
  test("seals one agent's state with the channel key, bound to its room", async () => {
    const key = newChannelKey();
    const state = liveState({ name: "builder-one", face: "builder", color: "green", task: "T50 iPhone: Live Activity", since: 1_800_000_000_000, title: "channels" });
    const blob = await sealLive(key, ROOM, state);
    expect(wellFormedLiveBlob(blob)).toBe(true);
    expect(await openLive(key, ROOM, blob)).toEqual(state);
    expect(await openLive(key, "o".repeat(22), blob)).toBeNull();
    expect(await openLive(newChannelKey(), ROOM, blob)).toBeNull();
  });

  test("cuts every field to its limit, so the longest still fits", async () => {
    const s = longest(1);
    expect(s.n.length).toBe(LIVE_LIMITS.n);
    expect(s.t!.length).toBe(LIVE_LIMITS.t);
    expect(s.h.length).toBe(LIVE_LIMITS.h);
    expect(wellFormedLiveBlob(await sealLive(newChannelKey(), ROOM, s))).toBe(true);
  });

  test("a blob of emoji and accents still fits the relay's limit", async () => {
    const s = liveState({ name: "🦊".repeat(40), face: "builder", color: "#123456", task: `T1 ${"🚀".repeat(80)}`, since: 1_800_000_000_000, title: "ç".repeat(60) });
    expect(Array.from(s.t!).at(-1)).toBe("…");
    expect(wellFormedLiveBlob(await sealLive(newChannelKey(), ROOM, s))).toBe(true);
  });

  test("six of the longest blobs fit an APNs Live Activity push with room to spare", async () => {
    const key = newChannelKey();
    const blobs = await Promise.all(Array.from({ length: MAX_LIVE_BLOBS }, (_, i) => sealLive(key, ROOM, longest(i))));
    const start = new TextEncoder().encode(JSON.stringify(liveBody({ token: START, sandbox: false, event: "start", room: ROOM, blobs }, 1_800_000_000))).byteLength;
    expect(start).toBeLessThan(3_600);
  });

  test("the relay takes only an iv and a short ciphertext", () => {
    const iv = b64url(new Uint8Array(12));
    expect(wellFormedLiveBlob({ iv, ct: "c".repeat(40) })).toBe(true);
    expect(wellFormedLiveBlob({ iv, ct: "c".repeat(481) })).toBe(false);
    expect(wellFormedLiveBlob({ iv: "short", ct: "c".repeat(40) })).toBe(false);
    expect(wellFormedLiveBlob({ iv, ct: "c".repeat(40), name: "builder-one" })).toBe(false);
    expect(wellFormedLiveBlob({ iv, ct: "not base64url!" })).toBe(false);
  });

  test("a phone registers a start token, an update token or both", () => {
    expect(wellFormedLiveTokens({ start: START })).toBe(true);
    expect(wellFormedLiveTokens({ update: UPDATE, sandbox: true })).toBe(true);
    expect(wellFormedLiveTokens({ start: START, update: UPDATE })).toBe(true);
    expect(wellFormedLiveTokens({})).toBe(false);
    expect(wellFormedLiveTokens({ sandbox: true })).toBe(false);
    expect(wellFormedLiveTokens({ start: "zz" })).toBe(false);
    expect(wellFormedLiveTokens({ start: START, tag: "x" })).toBe(false);
  });
});

describe("APNs Live Activity pushes", () => {
  test("go to the liveactivity topic, carry only sealed blobs and end with a dismissal", async () => {
    const key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: String(init?.body) });
      return String(input).includes(UPDATE) ? new Response(null, { status: 410 }) : new Response(null, { status: 200 });
    }) as typeof fetch;
    const p = pusherFrom({
      apnsKey: pem(await crypto.subtle.exportKey("pkcs8", key.privateKey)),
      apnsKeyId: "KEYID12345",
      apnsTeamId: "TEAM123456",
      apnsTopic: "com.kiwiinit.channels",
      fetch: f,
      now: () => 1_800_000_000_000,
    })!;
    const blobs = [{ iv: "i".repeat(16), ct: "c".repeat(40) }];
    const dead = await p.live!([
      { token: START, sandbox: true, event: "start", room: ROOM, blobs },
      { token: UPDATE, sandbox: true, event: "end", room: ROOM, blobs: [] },
    ]);
    expect(dead).toEqual([UPDATE]);
    expect(sent[0]!.url).toBe(`${APNS_SANDBOX_HOST}/3/device/${START}`);
    expect(sent[0]!.headers["apns-topic"]).toBe("com.kiwiinit.channels.push-type.liveactivity");
    expect(sent[0]!.headers["apns-push-type"]).toBe("liveactivity");
    expect(sent[0]!.headers["apns-priority"]).toBe("10");
    expect(JSON.parse(sent[0]!.body)).toEqual({
      aps: {
        timestamp: 1_800_000_000,
        event: "start",
        "content-state": { s: [["i".repeat(16), "c".repeat(40)]] },
        "stale-date": 1_800_000_000 + LIVE_STALE_S,
        "attributes-type": "AgentsActivity",
        attributes: { channel: ROOM, title: "" },
        alert: { title: "Channels", body: "Agents are working" },
      },
    });
    expect(JSON.parse(sent[1]!.body)).toEqual({ aps: { timestamp: 1_800_000_000, event: "end", "content-state": { s: [] }, "dismissal-date": 1_800_000_060 } });
  });

  test("an update goes at the low priority", async () => {
    const key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const sent: Record<string, string>[] = [];
    const f = (async (_: string | URL | Request, init?: RequestInit) => {
      sent.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const p = pusherFrom({ apnsKey: pem(await crypto.subtle.exportKey("pkcs8", key.privateKey)), apnsKeyId: "KEYID12345", apnsTeamId: "TEAM123456", apnsTopic: "com.kiwiinit.channels", fetch: f })!;
    await p.live!([{ token: UPDATE, sandbox: false, event: "update", room: ROOM, blobs: [] }]);
    expect(sent[0]!["apns-priority"]).toBe("5");
  });
});

describe("the relay starts, updates and ends a phone's Live Activity from the agents' blobs", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-live-"));
  const pushed: LiveSend[][] = [];
  let dead: string[] = [];
  let server: ReturnType<typeof startRelay>;
  let relay: string;
  let roomId: string;
  let owner: Identity;
  let phone: Identity;
  let agent: Identity;
  const recording: Pusher = {
    async send() {
      return [];
    },
    async live(sends) {
      pushed.push([...sends]);
      const gone = sends.filter((s) => dead.includes(s.token)).map((s) => s.token);
      dead = [];
      return gone;
    },
  };

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), pusher: recording });
    relay = server.url.origin;
    owner = await generateIdentity("alice");
    phone = await generateIdentity("alice-phone");
    agent = await generateIdentity("builder-one");
    const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
    roomId = made.access.roomId;
    const ownerCh = new Channel(made.access, relay, owner);
    for (const id of [phone, agent]) {
      const ask = await Channel.requestJoin(relay, made.code, id, { name: id === phone ? "alice-phone" : "builder-one" });
      await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id, requestId: ask.requestId }]))[0]!);
    }
  });
  afterAll(() => {
    server.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function room(method: string, path: string, as: Identity, body?: unknown): Promise<Response> {
    const text = body === undefined ? "" : JSON.stringify(body);
    const headers = { "content-type": "application/json", authorization: `Bearer ${await signRequest(as, roomId, method, path, text)}` };
    return fetch(`${relay}/v1/rooms/${roomId}${path}`, { method, headers, body: text || undefined });
  }

  const blob = (): LiveBlob => ({ iv: b64url(crypto.getRandomValues(new Uint8Array(12))), ct: b64url(crypto.getRandomValues(new Uint8Array(60))) });

  async function step(method: "PUT" | "DELETE", as: Identity, body?: LiveBlob): Promise<LiveSend[]> {
    pushed.length = 0;
    expect((await room(method, "/live", as, body)).status).toBe(200);
    await Bun.sleep(30);
    return pushed.flat();
  }

  test("a phone registers its tokens; bad ones and bad blobs are refused", async () => {
    expect((await room("PUT", "/live-token", phone, { start: "zz" })).status).toBe(400);
    expect((await room("PUT", "/live-token", phone, { start: START, sandbox: true })).status).toBe(200);
    expect((await room("PUT", "/live", agent, { iv: "x", ct: "y" })).status).toBe(400);
    expect((await room("PUT", "/live", agent, { ...blob(), name: "builder-one" })).status).toBe(400);
  });

  test("the first agent at work starts it once, with the sealed blob", async () => {
    const first = blob();
    expect(await step("PUT", agent, first)).toEqual([{ token: START, sandbox: true, event: "start", room: roomId, blobs: [first] }]);
    expect(await step("PUT", agent, blob())).toEqual([]);
  });

  test("once the phone sends its activity's token, each change updates it with every blob", async () => {
    expect((await room("PUT", "/live-token", phone, { update: UPDATE, sandbox: true })).status).toBe(200);
    const mine = blob();
    const sends = await step("PUT", owner, mine);
    expect(sends.map((s) => [s.token, s.event, s.blobs.length])).toEqual([[UPDATE, "update", 2]]);
    expect(sends[0]!.blobs[0]).toEqual(mine);
  });

  test("a stop updates it; the last stop ends it; the next start starts a new one", async () => {
    expect((await step("DELETE", agent)).map((s) => [s.event, s.blobs.length])).toEqual([["update", 1]]);
    expect(await step("DELETE", agent)).toEqual([]);
    expect((await step("DELETE", owner)).map((s) => [s.token, s.event, s.blobs.length])).toEqual([[UPDATE, "end", 0]]);
    expect((await step("PUT", agent, blob())).map((s) => [s.token, s.event])).toEqual([[START, "start"]]);
  });

  test("the phone's own blob never pushes to itself", async () => {
    expect(await step("PUT", phone, blob())).toEqual([]);
    await step("DELETE", phone);
  });

  test("a token APNs calls dead is forgotten", async () => {
    await step("DELETE", agent);
    dead = [START];
    expect((await step("PUT", agent, blob())).map((s) => s.event)).toEqual(["start"]);
    await step("DELETE", agent);
    expect(await step("PUT", agent, blob())).toEqual([]);
  });

  test("a removed phone is never pushed again", async () => {
    expect((await room("PUT", "/live-token", phone, { start: START, update: UPDATE })).status).toBe(200);
    expect((await step("PUT", agent, blob())).map((s) => s.event)).toEqual(["update"]);
    expect((await room("DELETE", `/members/${phone.pk}`, owner)).status).toBe(200);
    expect(await step("PUT", agent, blob())).toEqual([]);
  });
});
