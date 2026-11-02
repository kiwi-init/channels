import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { b64url, fromB64url } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { MAX_WAKE, wellFormedPush, wellFormedWake, type PushRegistration } from "@kiwi/core/push.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { APNS_HOST, APNS_SANDBOX_HOST, FCM_SCOPE, pusherFrom, type Pusher, type Wake } from "../src/relay/push.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const pem = (der: ArrayBuffer): string => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----\n`;

const decode = (part: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(fromB64url(part))) as Record<string, unknown>;

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function fakeFetch(answer: (url: string, body: string) => Response | Promise<Response>): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    sent.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
    return answer(url, body);
  };
  return { fetch: fake as typeof fetch, sent };
}

const TOKEN = "a1".repeat(32);
const wake = (over: Partial<Wake> = {}): Wake => ({ pk: "p".repeat(43), platform: "apns", token: TOKEN, tag: "tag-12345", sandbox: false, seq: 7, ...over });

describe("what a phone may register and name", () => {
  test("a registration is an APNs or FCM token with a tag", () => {
    expect(wellFormedPush({ platform: "apns", token: TOKEN, tag: "tag-12345" })).toBe(true);
    expect(wellFormedPush({ platform: "apns", token: TOKEN, tag: "tag-12345", sandbox: true })).toBe(true);
    expect(wellFormedPush({ platform: "fcm", token: "dAbc:APA91b-xyz_0123456789", tag: "tag-12345" })).toBe(true);
    expect(wellFormedPush({ platform: "apns", token: "not hex", tag: "tag-12345" })).toBe(false);
    expect(wellFormedPush({ platform: "apns", token: TOKEN, tag: "x" })).toBe(false);
    expect(wellFormedPush({ platform: "webpush", token: TOKEN, tag: "tag-12345" })).toBe(false);
    expect(wellFormedPush({ platform: "apns", token: TOKEN, tag: "tag-12345", sandbox: "yes" })).toBe(false);
  });

  test("a wake list holds at most MAX_WAKE member keys", () => {
    expect(wellFormedWake(["k".repeat(43)])).toBe(true);
    expect(wellFormedWake(Array.from({ length: MAX_WAKE + 1 }, () => "k".repeat(43)))).toBe(false);
    expect(wellFormedWake(["short"])).toBe(false);
    expect(wellFormedWake("k".repeat(43))).toBe(false);
  });
});

describe("APNs wakes", () => {
  let key: CryptoKeyPair;
  beforeAll(async () => {
    key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  });
  const pusher = async (f: typeof fetch, now = () => 1_800_000_000_000): Promise<Pusher> =>
    pusherFrom({ apnsKey: pem(await crypto.subtle.exportKey("pkcs8", key.privateKey)), apnsKeyId: "KEYID12345", apnsTeamId: "TEAM123456", apnsTopic: "com.kiwiinit.channels", fetch: f, now })!;

  test("no key, or half a key, means no pusher", () => {
    expect(pusherFrom({})).toBeNull();
    expect(pusherFrom({ apnsKeyId: "KEYID12345", apnsTeamId: "TEAM123456", apnsTopic: "t" })).toBeNull();
    expect(pusherFrom({ apnsKey: "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----", apnsTeamId: "TEAM123456", apnsTopic: "t" })).toBeNull();
  });

  test("a wake carries only the tag and the sequence number, signed with the team's key", async () => {
    const { fetch: f, sent } = fakeFetch(() => new Response(null, { status: 200 }));
    expect(await (await pusher(f)).send([wake(), wake({ sandbox: true, seq: 8 })])).toEqual([]);
    expect(sent.map((s) => s.url)).toEqual([`${APNS_HOST}/3/device/${TOKEN}`, `${APNS_SANDBOX_HOST}/3/device/${TOKEN}`]);
    const [first] = sent;
    expect(first!.headers["apns-topic"]).toBe("com.kiwiinit.channels");
    expect(first!.headers["apns-push-type"]).toBe("alert");
    expect(first!.headers["apns-priority"]).toBe("10");
    expect(JSON.parse(first!.body)).toEqual({ aps: { alert: { title: "Channels", body: "New message" }, "mutable-content": 1, sound: "default" }, k: "tag-12345", s: 7 });
    const jwt = first!.headers.authorization!.replace(/^bearer /, "");
    const [h, c, sig] = jwt.split(".");
    expect(decode(h!)).toEqual({ alg: "ES256", kid: "KEYID12345" });
    expect(decode(c!)).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key.publicKey, fromB64url(sig!), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
    expect(sent[1]!.headers.authorization).toBe(first!.headers.authorization);
  });

  test("the provider token is signed again after 40 minutes", async () => {
    let t = 1_800_000_000_000;
    const { fetch: f, sent } = fakeFetch(() => new Response(null, { status: 200 }));
    const p = await pusher(f, () => t);
    await p.send([wake()]);
    t += 41 * 60_000;
    await p.send([wake()]);
    expect(sent[0]!.headers.authorization).not.toBe(sent[1]!.headers.authorization);
  });

  test("a gone or bad device token comes back dead; other refusals don't", async () => {
    const answers: Record<string, Response> = {
      ["d1".repeat(32)]: new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 }),
      ["d2".repeat(32)]: new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 }),
      ["d3".repeat(32)]: new Response(JSON.stringify({ reason: "PayloadTooLarge" }), { status: 400 }),
      ["d4".repeat(32)]: new Response(JSON.stringify({ reason: "TooManyRequests" }), { status: 429 }),
    };
    const { fetch: f } = fakeFetch((url) => answers[url.split("/").at(-1)!]!);
    const dead = await (await pusher(f)).send(Object.keys(answers).map((token) => wake({ token })));
    expect(dead).toEqual(["d1".repeat(32), "d2".repeat(32)]);
  });

  test("a network failure loses that wake and nothing else", async () => {
    const { fetch: f } = fakeFetch(() => {
      throw new Error("offline");
    });
    expect(await (await pusher(f)).send([wake()])).toEqual([]);
  });
});

describe("FCM wakes", () => {
  let key: CryptoKeyPair;
  let account: string;
  beforeAll(async () => {
    key = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    account = JSON.stringify({
      type: "service_account",
      project_id: "kiwi-channels",
      client_email: "push@kiwi-channels.iam.gserviceaccount.com",
      private_key: pem(await crypto.subtle.exportKey("pkcs8", key.privateKey)),
      token_uri: "https://oauth2.example/token",
    });
  });
  const FCM = "dAbc:APA91b-xyz_0123456789";

  test("a service account that isn't JSON leaves Android push off", () => {
    expect(pusherFrom({ fcmServiceAccount: "{not json" })).toBeNull();
    expect(pusherFrom({ fcmServiceAccount: JSON.stringify({ project_id: "x" }) })).toBeNull();
  });

  test("one access token for many wakes, and each wake is a high-priority data message with the tag and sequence", async () => {
    const { fetch: f, sent } = fakeFetch((url) =>
      url.startsWith("https://oauth2.example/") ? Response.json({ access_token: "ya29.test", expires_in: 3600 }) : Response.json({ name: "projects/kiwi-channels/messages/1" }),
    );
    const p = pusherFrom({ fcmServiceAccount: account, fetch: f, now: () => 1_800_000_000_000 })!;
    expect(await p.send([wake({ platform: "fcm", token: FCM, seq: 3 }), wake({ platform: "fcm", token: FCM, seq: 4 })])).toEqual([]);
    const grants = sent.filter((s) => s.url.startsWith("https://oauth2.example/"));
    expect(grants).toHaveLength(1);
    const form = new URLSearchParams(grants[0]!.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, sig] = form.get("assertion")!.split(".");
    expect(decode(h!)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(c!)).toEqual({ iss: "push@kiwi-channels.iam.gserviceaccount.com", scope: FCM_SCOPE, aud: "https://oauth2.example/token", iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key.publicKey, fromB64url(sig!), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
    const sends = sent.filter((s) => s.url === "https://fcm.googleapis.com/v1/projects/kiwi-channels/messages:send");
    expect(sends).toHaveLength(2);
    expect(sends[0]!.headers.authorization).toBe("Bearer ya29.test");
    expect(JSON.parse(sends[0]!.body)).toEqual({ message: { token: FCM, data: { k: "tag-12345", s: "3" }, android: { priority: "HIGH", ttl: "86400s" } } });
  });

  test("an unregistered token comes back dead, and a refused grant sends nothing", async () => {
    const { fetch: f } = fakeFetch((url) =>
      url.startsWith("https://oauth2.example/") ? Response.json({ access_token: "ya29.test" }) : Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 }),
    );
    expect(await pusherFrom({ fcmServiceAccount: account, fetch: f })!.send([wake({ platform: "fcm", token: FCM })])).toEqual([FCM]);
    const refused = fakeFetch(() => new Response("no", { status: 400 }));
    expect(await pusherFrom({ fcmServiceAccount: account, fetch: refused.fetch })!.send([wake({ platform: "fcm", token: FCM })])).toEqual([]);
    expect(refused.sent.every((s) => s.url.startsWith("https://oauth2.example/"))).toBe(true);
  });
});

describe("the relay wakes only the registered phones a message names", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-push-"));
  const woken: Wake[][] = [];
  let dead: string[] = [];
  let server: ReturnType<typeof startRelay>;
  let relay: string;
  let roomId: string;
  let owner: Identity;
  let phone: Identity;
  let laptop: Identity;
  let ownerCh: Channel;
  const recording: Pusher = {
    async send(wakes) {
      woken.push([...wakes]);
      const gone = wakes.filter((w) => dead.includes(w.token)).map((w) => w.token);
      dead = [];
      return gone;
    },
  };

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), pusher: recording });
    relay = server.url.origin;
    owner = await generateIdentity("alice");
    phone = await generateIdentity("alice-phone");
    laptop = await generateIdentity("win");
    const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
    roomId = made.access.roomId;
    ownerCh = new Channel(made.access, relay, owner);
    for (const id of [phone, laptop]) {
      const ask = await Channel.requestJoin(relay, made.code, id, { name: id === phone ? "alice-phone" : "win" });
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

  const envelope = () => ({ iv: b64url(crypto.getRandomValues(new Uint8Array(12))), ct: b64url(crypto.getRandomValues(new Uint8Array(40))), e: ownerCh.access.epoch });

  async function post(as: Identity, wake: unknown): Promise<number> {
    const before = woken.length;
    const res = await room("POST", "/messages", as, { ...envelope(), wake });
    expect(res.status).toBe(200);
    const { seq } = (await res.json()) as { seq: number };
    await Bun.sleep(30);
    expect(woken.length - before).toBeLessThanOrEqual(1);
    return seq;
  }

  const registration: PushRegistration = { platform: "apns", token: "b2".repeat(32), tag: "phone-tag-1", sandbox: true };

  test("a member registers its phone; a bad registration is refused", async () => {
    expect((await room("PUT", "/push", phone, { platform: "apns", token: "zz", tag: "phone-tag-1" })).status).toBe(400);
    expect((await room("PUT", "/push", phone, registration)).status).toBe(200);
  });

  test("a message that names the phone wakes it with the tag and sequence, and no one else", async () => {
    woken.length = 0;
    const seq = await post(owner, [phone.pk, laptop.pk, owner.pk]);
    expect(woken).toEqual([[{ pk: phone.pk, platform: "apns", token: registration.token, tag: "phone-tag-1", sandbox: true, seq }]]);
  });

  test("a message that doesn't name it, names it badly, or comes from the phone itself wakes nothing", async () => {
    woken.length = 0;
    await post(owner, [laptop.pk]);
    await post(owner, undefined);
    await post(owner, ["not a key"]);
    await post(phone, [phone.pk]);
    expect(woken).toEqual([]);
  });

  test("a send on the socket wakes it too", async () => {
    woken.length = 0;
    const u = new URL(`/v1/rooms/${roomId}/ws`, relay);
    u.protocol = "ws:";
    const ws = new WebSocket(u, [WS_PROTOCOL, await signRequest(laptop, roomId, "GET", "/ws")]);
    const acked = new Promise<number>((resolve) => {
      ws.onmessage = (m) => {
        const f = JSON.parse(String(m.data)) as { t: string; id?: string; seq?: number };
        if (f.t === "ack" && f.id === "s1") resolve(f.seq!);
      };
    });
    await new Promise((resolve) => (ws.onopen = resolve));
    ws.send(JSON.stringify({ t: "send", id: "s1", ...envelope(), wake: [phone.pk] }));
    const seq = await acked;
    ws.close();
    await Bun.sleep(30);
    expect(woken).toEqual([[{ pk: phone.pk, platform: "apns", token: registration.token, tag: "phone-tag-1", sandbox: true, seq }]]);
  });

  test("a token APNs calls dead is forgotten", async () => {
    dead = [registration.token];
    await post(owner, [phone.pk]);
    woken.length = 0;
    await post(owner, [phone.pk]);
    expect(woken).toEqual([]);
  });

  test("a phone that unregisters, or is removed, is never woken again", async () => {
    expect((await room("PUT", "/push", phone, registration)).status).toBe(200);
    expect((await room("DELETE", "/push", phone)).status).toBe(200);
    woken.length = 0;
    await post(owner, [phone.pk]);
    expect(woken).toEqual([]);
    expect((await room("PUT", "/push", laptop, { ...registration, token: "c3".repeat(32), tag: "laptop-tag" })).status).toBe(200);
    await post(owner, [laptop.pk]);
    expect(woken).toHaveLength(1);
    woken.length = 0;
    expect((await room("DELETE", `/members/${laptop.pk}`, owner)).status).toBe(200);
    await post(owner, [laptop.pk]);
    expect(woken).toEqual([]);
  });
});
