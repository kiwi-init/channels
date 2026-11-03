import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import { PING, PONG, WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { PIPE_FRAME_MAX, PIPE_PAIRED, PIPES_PER_MACHINE, lonelyPipes, machineAlarmAt, machineScope, pipeFrame, PIPE_JOIN_MS } from "../src/relay/machine.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-pipe-relay-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let person: Identity;
let stranger: Identity;
let machine: Identity;

const pipeId = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

interface End {
  ws: WebSocket;
  texts: string[];
  bytes: Uint8Array[];
  closed: Promise<number>;
}

async function signed(id: Identity, m: Identity, method: string, path: string, text = ""): Promise<string> {
  return signRequest(id, machineScope(m.pk), method, path, text);
}

function connect(path: string, token: string): { ws: WebSocket; opened: Promise<boolean>; end: End } {
  const ws = new WebSocket(relay.replace(/^http/, "ws") + path, [WS_PROTOCOL, token]);
  ws.binaryType = "arraybuffer";
  const end: End = { ws, texts: [], bytes: [], closed: new Promise<number>((resolve) => (ws.onclose = (e) => resolve(e.code))) };
  ws.onmessage = (e) => (typeof e.data === "string" ? end.texts.push(e.data) : end.bytes.push(new Uint8Array(e.data as ArrayBuffer)));
  const opened = new Promise<boolean>((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
  });
  return { ws, opened, end };
}

async function pipeEnd(as: Identity, m: Identity, id: string): Promise<End | null> {
  const path = `/v1/machine/${m.pk}/pipe/${id}`;
  const c = connect(path, await signed(as, m, "GET", path));
  return (await c.opened) ? c.end : null;
}

async function until(what: string, ok: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, pipeJoinMs: 300 });
  relay = server.url.origin;
  person = await withExchangeKey(await generateIdentity("person"));
  stranger = await withExchangeKey(await generateIdentity("stranger"));
  machine = await withExchangeKey(await generateIdentity("vps"));
  const cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk!, label: "vps" });
  const path = `/v1/machine/${machine.pk}`;
  const body = JSON.stringify({ cert });
  const res = await fetch(relay + path, { method: "PUT", headers: { authorization: `Bearer ${await signed(machine, machine, "PUT", path, body)}`, "content-type": "application/json" }, body });
  expect(res.status).toBe(204);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("a shell's pipe through the relay", () => {
  test("pairs the computer with the person's app, then carries bytes both ways untouched", async () => {
    const id = pipeId();
    const computer = (await pipeEnd(machine, machine, id))!;
    const app = (await pipeEnd(person, machine, id))!;
    await until("both sides paired", () => computer.texts.includes(PIPE_PAIRED) && app.texts.includes(PIPE_PAIRED));
    const down = crypto.getRandomValues(new Uint8Array(PIPE_FRAME_MAX));
    computer.ws.send(down);
    app.ws.send(new Uint8Array([1, 2, 3]));
    await until("the frames", () => app.bytes.length === 1 && computer.bytes.length === 1);
    expect(app.bytes[0]).toEqual(down);
    expect(computer.bytes[0]).toEqual(new Uint8Array([1, 2, 3]));
    app.ws.send(PING);
    await until("a pong", () => app.texts.includes(PONG));
    app.ws.close(1000);
    expect(await computer.closed).toBe(1000);
  });

  test("is only for the computer and its person: a stranger, or the same side twice, is turned away", async () => {
    const id = pipeId();
    expect(await pipeEnd(stranger, machine, id)).toBeNull();
    const app = (await pipeEnd(person, machine, id))!;
    expect(await pipeEnd(person, machine, id)).toBeNull();
    app.ws.close(1000);
  });

  test("closes a side the other never joins, and refuses frames before the other side is there", async () => {
    const lonely = (await pipeEnd(person, machine, pipeId()))!;
    expect(await lonely.closed).toBe(4408);
    const early = (await pipeEnd(machine, machine, pipeId()))!;
    early.ws.send(new Uint8Array([9]));
    expect(await early.closed).toBe(4409);
  });

  test("ends both sides on a text frame or one over 64 KB", async () => {
    for (const bad of ['{"keys":"ls"}', new Uint8Array(PIPE_FRAME_MAX + 1)]) {
      const id = pipeId();
      const computer = (await pipeEnd(machine, machine, id))!;
      const app = (await pipeEnd(person, machine, id))!;
      await until("paired", () => app.texts.includes(PIPE_PAIRED));
      app.ws.send(bad);
      expect(await app.closed).toBe(1009);
      expect(await computer.closed).toBe(1011);
    }
  });

  test("unpairing the computer closes its pipes", async () => {
    const other = await withExchangeKey(await generateIdentity("laptop"));
    const cert = await certifyMachine(person, { pk: other.pk, xpk: other.xpk!, label: "laptop" });
    const path = `/v1/machine/${other.pk}`;
    const body = JSON.stringify({ cert });
    await fetch(relay + path, { method: "PUT", headers: { authorization: `Bearer ${await signed(other, other, "PUT", path, body)}`, "content-type": "application/json" }, body });
    const id = pipeId();
    const computer = (await pipeEnd(other, other, id))!;
    const app = (await pipeEnd(person, other, id))!;
    await until("paired", () => app.texts.includes(PIPE_PAIRED));
    const res = await fetch(relay + path, { method: "DELETE", headers: { authorization: `Bearer ${await signed(person, other, "DELETE", path)}` } });
    expect(res.status).toBe(204);
    expect(await app.closed).toBe(4000);
    expect(await computer.closed).not.toBe(1006);
  });
});

describe("the pipe rules", () => {
  test("frames: binary up to 64 KB forward, pings answer, anything else is refused", () => {
    expect(pipeFrame(new Uint8Array(PIPE_FRAME_MAX), PING)).toBe("forward");
    expect(pipeFrame(new Uint8Array(0), PING)).toBe("refuse");
    expect(pipeFrame(new Uint8Array(PIPE_FRAME_MAX + 1), PING)).toBe("refuse");
    expect(pipeFrame(PING, PING)).toBe("ping");
    expect(pipeFrame("hello", PING)).toBe("refuse");
  });

  test("a side is lonely until the other side of the same pipe joins, and the alarm wakes for it", () => {
    const a = { id: "p1", side: "app" as const, signer: "s", at: 10 };
    const c = { id: "p1", side: "computer" as const, signer: "m", at: 20 };
    const other = { id: "p2", side: "app" as const, signer: "s", at: 30 };
    expect(lonelyPipes([a, c, other])).toEqual([other]);
    expect(lonelyPipes([a])).toEqual([a]);
    expect(machineAlarmAt(null, null, 30)).toBe(30 + PIPE_JOIN_MS);
    expect(PIPES_PER_MACHINE).toBeGreaterThan(4);
  });
});
