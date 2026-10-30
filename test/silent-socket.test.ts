import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest, verifyRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-silent-"));
const relay = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
afterAll(() => {
  relay.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function until(pred: () => boolean, label: string, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(20);
  }
}

async function seat(): Promise<{ access: Channel["access"]; owner: Awaited<ReturnType<typeof generateIdentity>> }> {
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(relay.url.origin, owner, { name: "human" });
  return { access, owner };
}

function racing(): { now: () => number; stop: () => void } {
  let ahead = 0;
  const t = setInterval(() => (ahead += 1_000), 10);
  return { now: () => Date.now() + ahead, stop: () => clearInterval(t) };
}

test("a socket that goes quiet after opening is dropped and opened again", async () => {
  const { access, owner } = await seat();
  let upgrades = 0;
  const quiet = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      if (req.headers.get("upgrade") === "websocket") {
        upgrades++;
        return srv.upgrade(req, { headers: { "sec-websocket-protocol": WS_PROTOCOL } }) ? undefined : new Response("no", { status: 400 });
      }
      return new Response("busy", { status: 503 });
    },
    websocket: { message() {}, sendPings: false },
  });
  const clock = racing();
  const ac = new AbortController();
  const ch = new Channel(access, quiet.url.origin, owner);
  const listening = ch.stream(0, () => {}, { signal: ac.signal, now: clock.now }).catch(() => {});
  try {
    await until(() => upgrades >= 2, "a second socket after the first went quiet", 10_000);
  } finally {
    clock.stop();
    ac.abort();
    await listening;
    quiet.stop(true);
  }
  expect(upgrades).toBeGreaterThanOrEqual(2);
});

test("an upgrade nobody answers is given up and tried again", async () => {
  const { access, owner } = await seat();
  let accepted = 0;
  const mute = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open: () => void accepted++, data() {} } });
  const clock = racing();
  const ac = new AbortController();
  const ch = new Channel(access, `http://127.0.0.1:${mute.port}`, owner);
  const listening = ch.stream(0, () => {}, { signal: ac.signal, now: clock.now }).catch(() => {});
  try {
    await until(() => accepted >= 2, "a second try after an upgrade that never finished", 10_000);
  } finally {
    clock.stop();
    ac.abort();
    await listening;
    mute.stop(true);
  }
  expect(accepted).toBeGreaterThanOrEqual(2);
});

test("a nudge drops an open socket that doesn't answer a ping within 5s", async () => {
  const { access, owner } = await seat();
  let upgrades = 0;
  const quiet = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      if (req.headers.get("upgrade") === "websocket") {
        upgrades++;
        return srv.upgrade(req, { headers: { "sec-websocket-protocol": WS_PROTOCOL } }) ? undefined : new Response("no", { status: 400 });
      }
      return new Response("busy", { status: 503 });
    },
    websocket: { message() {}, sendPings: false },
  });
  const ac = new AbortController();
  const ch = new Channel(access, quiet.url.origin, owner);
  const listening = ch.stream(0, () => {}, { signal: ac.signal }).catch(() => {});
  try {
    await until(() => upgrades === 1, "the first socket", 5_000);
    const at = Date.now();
    ch.nudge();
    await until(() => upgrades >= 2, "a second socket after the nudge", 8_000);
    expect(Date.now() - at).toBeLessThan(7_000);
  } finally {
    ac.abort();
    await listening;
    quiet.stop(true);
  }
});

test("a nudge cuts a long reconnect wait short", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-nudge-"));
  let server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir });
  const port = server.port;
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(server.url.origin, owner, { name: "human" });
  const ch = new Channel(access, server.url.origin, owner);
  const got: string[] = [];
  let ahead = 0;
  const ac = new AbortController();
  let ready!: () => void;
  const opened = new Promise<void>((r) => (ready = r));
  const listening = ch.stream(0, (m) => void got.push(m.body), { signal: ac.signal, now: () => Date.now() + ahead, onReady: () => ready() }).catch(() => {});
  try {
    await opened;
    server.stop(true);
    const jump = setInterval(() => (ahead += 1_000), 10);
    await Bun.sleep(1_500);
    clearInterval(jump);
    ahead -= 60_000;
    server = startRelay({ port, hostname: "127.0.0.1", dataDir: dir });
    await new Channel(access, server.url.origin, owner).send("back");
    const at = Date.now();
    ch.nudge();
    await until(() => got.includes("back"), "the message after the nudge", 5_000);
    expect(Date.now() - at).toBeLessThan(3_000);
  } finally {
    ac.abort();
    await listening;
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the socket's signature covers its query, and the form from before still opens", async () => {
  const { access, owner } = await seat();
  const opens = (roomId: string, token: string) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const ws = new WebSocket(`${relay.url.origin.replace(/^http/, "ws")}/v1/rooms/${roomId}/ws?since=0&watch=1`, [WS_PROTOCOL, token]);
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try {
          ws.close(1000);
        } catch {
          // The socket never opened: nothing to close.
        }
        resolve(ok);
      };
      ws.onopen = () => done(true);
      ws.onerror = () => done(false);
      ws.onclose = () => done(false);
    });
  expect(await opens(access.roomId, await signRequest(owner, access.roomId, "GET", "/ws?since=0&watch=1"))).toBe(true);
  expect(await opens(access.roomId, await signRequest(owner, access.roomId, "GET", "/ws"))).toBe(true);
  const stranger = await generateIdentity("stranger");
  expect(await opens(access.roomId, await signRequest(stranger, access.roomId, "GET", "/ws?since=0"))).toBe(false);
  expect(await opens("f".repeat(32), await signRequest(stranger, "f".repeat(32), "GET", "/ws?since=0"))).toBe(false);
  expect(await opens(access.roomId, "s1.broken.1.no")).toBe(false);
});

test("against a relay from before the query was signed, the client signs the old way on its next try", async () => {
  const { access, owner } = await seat();
  let refused = 0;
  let opened = 0;
  const old = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (req.headers.get("upgrade") !== "websocket") return new Response("not this relay's business", { status: 501 });
      const room = /^\/v1\/rooms\/([0-9a-f]{32})\/ws$/.exec(url.pathname)?.[1] ?? "";
      const token = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim())[1] ?? "";
      if (room && (await verifyRequest(token, room, "GET", "/ws" + url.search))) {
        refused++;
        return new Response("this relay predates the query being signed", { status: 401 });
      }
      if (!(room && (await verifyRequest(token, room, "GET", "/ws")))) return new Response("bad or expired signature", { status: 401 });
      opened++;
      return srv.upgrade(req, { headers: { "sec-websocket-protocol": WS_PROTOCOL } }) ? undefined : new Response("no", { status: 400 });
    },
    websocket: { message() {}, sendPings: false },
  });
  const ac = new AbortController();
  const ch = new Channel(access, old.url.origin, owner);
  const listening = ch.stream(0, () => {}, { signal: ac.signal }).catch(() => {});
  try {
    await until(() => refused >= 1 && opened >= 1, "the old signature after one refusal", 10_000);
  } finally {
    ac.abort();
    await listening;
    old.stop(true);
  }
  expect(refused).toBeGreaterThanOrEqual(1);
  expect(opened).toBeGreaterThanOrEqual(1);
});
