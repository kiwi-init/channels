import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "../src/auth.ts";
import { Channel } from "../src/client.ts";
import { generateIdentity, type Identity } from "../src/identity.ts";
import { WS_PROTOCOL, type ServerFrame } from "../src/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { sum, trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(60_000);

const K = 5;
const BODY = "QUFB".repeat(25_000);

const BUDGET = {
  echo: { msgDown: K },
  noEcho: { msgDown: 0, bytesDown: 2_000 },
} as const;

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-budget-echo-"));
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;
let roomId = "";
let mac: Identity;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  const human = await generateIdentity("human");
  mac = await generateIdentity("mac");
  const created = await Channel.create(server.url.origin, human, { name: "human" }, [{ ...mac, info: { name: "mac" } }]);
  roomId = created.access.roomId;
});

afterAll(() => {
  proxy?.stop();
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

interface Sock {
  ws: WebSocket;
  frames: ServerFrame[];
  wait: (pred: (fs: ServerFrame[]) => boolean, label: string) => Promise<void>;
}

async function open(origin: string, query: string): Promise<Sock> {
  const u = new URL(`/v1/rooms/${roomId}/ws?${query}`, origin);
  u.protocol = "ws:";
  const ws = new WebSocket(u, [WS_PROTOCOL, await signRequest(mac, roomId, "GET", "/ws")]);
  const frames: ServerFrame[] = [];
  ws.onmessage = (ev: MessageEvent<string>) => void frames.push(JSON.parse(String(ev.data)) as ServerFrame);
  const wait = async (pred: (fs: ServerFrame[]) => boolean, label: string) => {
    const end = Date.now() + 20_000;
    while (!pred(frames)) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
      await Bun.sleep(20);
    }
  };
  await wait((fs) => fs.some((f) => f.t === "ready"), "ready");
  return { ws, frames, wait };
}

const count = (fs: ServerFrame[], t: ServerFrame["t"]) => fs.filter((f) => f.t === t).length;

async function sendK(query: string): Promise<{ traffic: Traffic; acks: Extract<ServerFrame, { t: "ack" }>[]; sender: Sock; other: Sock }> {
  const other = await open(server!.url.origin, "since=1000000");
  const sender = await open(proxy!.url, `since=1000000${query}`);
  await Bun.sleep(100);
  proxy!.reset();
  for (let i = 0; i < K; i++) sender.ws.send(JSON.stringify({ t: "send", id: `m${i}`, iv: "aXZpdml2aXZpdml2", ct: BODY, e: 0 }));
  await sender.wait((fs) => count(fs, "ack") === K, "acks");
  await other.wait((fs) => count(fs, "msg") === K, "the other socket's msgs");
  await Bun.sleep(200);
  const traffic = proxy!.reset();
  sender.ws.close();
  other.ws.close();
  const acks = sender.frames.filter((f): f is Extract<ServerFrame, { t: "ack" }> => f.t === "ack");
  return { traffic, acks, sender, other };
}

describe("a socket's own sends", () => {
  test("echo (default): the sender downloads its own ciphertext back", async () => {
    const { traffic, sender } = await sendK("");
    console.log(`[echo] sender: frames down ${JSON.stringify(traffic.framesDown)}, bytes down ${traffic.bytesDown}, msg frames ${traffic.framesDown.msg ?? 0}`);
    expect(traffic.framesDown.msg ?? 0).toBe(BUDGET.echo.msgDown);
    expect(count(sender.frames, "msg")).toBe(K);
  });

  test("echo=0: the ack carries seq and ts, no msg comes back, other sockets of the same key still get it", async () => {
    const { traffic, acks, sender, other } = await sendK("&echo=0");
    console.log(`[echo=0] sender: frames down ${JSON.stringify(traffic.framesDown)}, bytes down ${traffic.bytesDown}, msg frames ${traffic.framesDown.msg ?? 0}`);
    expect(traffic.framesDown.msg ?? 0).toBe(BUDGET.noEcho.msgDown);
    expect(traffic.bytesDown).toBeLessThanOrEqual(BUDGET.noEcho.bytesDown);
    expect(sum(traffic.framesDown)).toBe(K);
    expect(count(sender.frames, "msg")).toBe(0);
    const msgs = other.frames.filter((f): f is Extract<ServerFrame, { t: "msg" }> => f.t === "msg");
    expect(acks.map((a) => ({ seq: a.seq, ts: a.ts }))).toEqual(msgs.map((m) => ({ seq: m.seq, ts: m.ts })));
    expect(msgs.every((m) => m.ct === BODY)).toBe(true);
  });
});
