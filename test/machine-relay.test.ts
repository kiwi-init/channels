import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import { WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { MACHINE_BOX_MAX_BYTES, machineScope } from "../src/relay/machine.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-machine-relay-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let person: Identity;
let stranger: Identity;
let machine: Identity;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  person = await withExchangeKey(await generateIdentity("person"));
  stranger = await withExchangeKey(await generateIdentity("stranger"));
  machine = await withExchangeKey(await generateIdentity("machine"));
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function call(id: Identity, method: string, path: string, body?: unknown, scope = machineScope(machine.pk)): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const token = await signRequest(id, scope, method, path, text);
  return fetch(relay + path, { method, headers: { authorization: `Bearer ${token}`, ...(text ? { "content-type": "application/json" } : {}) }, ...(text ? { body: text } : {}) });
}

const base = (m: Identity = machine) => `/v1/machine/${m.pk}`;

async function openInbox(m: Identity = machine): Promise<{ ws: WebSocket; got: unknown[]; closed: Promise<number> }> {
  const path = `${base(m)}/ws`;
  const token = await signRequest(m, machineScope(m.pk), "GET", path);
  const ws = new WebSocket(relay.replace(/^http/, "ws") + path, [WS_PROTOCOL, token]);
  const got: unknown[] = [];
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
  const closed = new Promise<number>((resolve) => (ws.onclose = (e) => resolve(e.code)));
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("the inbox socket didn't open"));
  });
  return { ws, got, closed };
}

async function until(what: string, ok: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}

describe("a paired computer at the relay", () => {
  test("registers itself with its own cert, and nobody else can, nor roll its person back with an older cert", async () => {
    const cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk!, label: "studio" }, 2_000);
    expect((await call(person, "PUT", base(), { cert })).status).toBe(403);
    const other = await withExchangeKey(await generateIdentity("other"));
    const othersCert = await certifyMachine(person, { pk: other.pk, xpk: other.xpk!, label: "other" });
    expect((await call(machine, "PUT", base(), { cert: othersCert })).status).toBe(400);
    expect((await call(machine, "PUT", base(), { cert: { ...cert, label: "forged" } })).status).toBe(400);
    expect((await call(machine, "PUT", base(), { cert })).status).toBe(204);
    const older = await certifyMachine(stranger, { pk: machine.pk, xpk: machine.xpk!, label: "studio" }, 1_000);
    expect((await call(machine, "PUT", base(), { cert: older })).status).toBe(409);
  });

  test("only its person sees whether it's online, with a signature made for this machine and path", async () => {
    expect(await (await call(person, "GET", base())).json()).toEqual({ online: false });
    expect((await call(stranger, "GET", base())).status).toBe(403);
    expect((await fetch(relay + base())).status).toBe(401);
    expect((await call(person, "GET", base(), undefined, "0123456789abcdef0123456789abcdef")).status).toBe(401);
    const token = await signRequest(person, machineScope(machine.pk), "GET", `${base()}/inbox`);
    expect((await fetch(relay + base(), { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  test("its inbox takes sealed asks from its person only, delivers them on its socket, and shows it online meanwhile", async () => {
    expect((await call(stranger, "POST", `${base()}/inbox`, { box: "x.y.z" })).status).toBe(403);
    expect((await call(person, "POST", `${base()}/inbox`, { box: "x".repeat(MACHINE_BOX_MAX_BYTES + 1) })).status).toBe(400);
    expect((await call(person, "POST", `${base()}/inbox`, { box: "x".repeat(MACHINE_BOX_MAX_BYTES * 2) })).status).toBe(413);
    const first = (await (await call(person, "POST", `${base()}/inbox`, { box: "sealed.one.box" })).json()) as { id: string };
    const inbox = await openInbox();
    await until("the waiting ask on open", () => inbox.got.length === 1);
    expect(inbox.got[0]).toMatchObject({ box: { id: first.id, box: "sealed.one.box" } });
    const status = (await (await call(person, "GET", base())).json()) as { online: boolean; since: number };
    expect(status.online).toBe(true);
    const second = (await (await call(person, "POST", `${base()}/inbox`, { box: "sealed.two.box" })).json()) as { id: string };
    await until("the live push", () => inbox.got.length === 2);
    expect(inbox.got[1]).toMatchObject({ box: { id: second.id, box: "sealed.two.box" } });
    expect((await call(person, "DELETE", `${base()}/inbox/${first.id}`)).status).toBe(403);
    expect((await call(machine, "DELETE", `${base()}/inbox/${first.id}`)).status).toBe(204);
    const left = (await (await call(machine, "GET", `${base()}/inbox`)).json()) as { boxes: { id: string }[] };
    expect(left.boxes.map((b) => b.id)).toEqual([second.id]);
    expect((await call(person, "GET", `${base()}/inbox`)).status).toBe(403);
    inbox.ws.close();
    await inbox.closed;
    let online = true;
    for (let i = 0; i < 100 && online; i++) {
      online = ((await (await call(person, "GET", base())).json()) as { online: boolean }).online;
      if (online) await Bun.sleep(20);
    }
    expect(online).toBe(false);
    await call(machine, "DELETE", `${base()}/inbox/${second.id}`);
  });

  test("a machine nobody registered has no inbox, and a full inbox refuses more", async () => {
    const lone = await withExchangeKey(await generateIdentity("lone"));
    expect((await call(person, "POST", `${base(lone)}/inbox`, { box: "a.b.c" }, machineScope(lone.pk))).status).toBe(403);
    const token = await signRequest(lone, machineScope(lone.pk), "GET", `${base(lone)}/ws`);
    const refused = await fetch(`${relay}${base(lone)}/ws`, { headers: { authorization: `Bearer ${token}`, upgrade: "websocket" } });
    expect(refused.status).toBe(403);
    const busy = await withExchangeKey(await generateIdentity("busy"));
    const cert = await certifyMachine(person, { pk: busy.pk, xpk: busy.xpk!, label: "busy" });
    expect((await call(busy, "PUT", base(busy), { cert }, machineScope(busy.pk))).status).toBe(204);
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await call(person, "POST", `${base(busy)}/inbox`, { box: `box.${i}.x` }, machineScope(busy.pk))).status);
    expect(codes.slice(0, 20).every((c) => c === 202)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  test("unpairing by its person drops its inbox and closes its socket", async () => {
    const inbox = await openInbox();
    expect((await call(stranger, "DELETE", base())).status).toBe(403);
    expect((await call(person, "DELETE", base())).status).toBe(204);
    expect(await inbox.closed).toBe(4000);
    expect((await call(person, "POST", `${base()}/inbox`, { box: "a.b.c" })).status).toBe(403);
    expect((await call(person, "GET", base())).status).toBe(403);
  });
});
