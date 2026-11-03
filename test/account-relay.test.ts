import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { certUntil, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceLinkBody } from "@kiwi/core/devices.ts";
import { accountScope, askToEnroll, ENROLL_TTL_MS, enrollDigits, enrollNonce, type EnrollAnswer, type EnrollAsk, type Enrollment } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import { WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { machineScope } from "../src/relay/machine.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-account-relay-"));
const bareDir = mkdtempSync(join(tmpdir(), "kiwi-account-bare-"));
let t = Date.now();
let server: ReturnType<typeof startRelay>;
let bare: ReturnType<typeof startRelay>;
let relay: string;
let users = 0;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), now: () => t });
  bare = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: bareDir });
  relay = server.url.origin;
});

beforeEach(() => {
  t = Date.now();
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  server.stop(true);
  bare.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(bareDir, { recursive: true, force: true });
});

interface Account {
  user: string;
  token: string;
}

const account = (): Account => {
  const name = `relay${++users}`;
  return { user: `dev_${name}`, token: `dev:${name}` };
};

const device = async (name: string) => withExchangeKey(await generateIdentity(name));

async function call(a: Account, id: Identity | null, method: string, path: string, body?: unknown): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "x-human-token": a.token };
  if (id) headers.authorization = `Bearer ${await signRequest(id, accountScope(a.user), method, path, text)}`;
  if (text) headers["content-type"] = "application/json";
  return fetch(relay + path, { method, headers, ...(text ? { body: text } : {}) });
}

async function grow(links: DeviceLink[], signer: Identity, body: DeviceLinkBody, at = Date.now()): Promise<DeviceLink[]> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await nextLink(read.list, signer, body, at)];
}

const adds = (d: Identity, as: "desktop" | "phone" | "computer", approve = false): DeviceLinkBody => ({
  op: "add",
  device: d.pk,
  dxpk: d.xpk!,
  label: as,
  os: "macOS",
  as,
  approve,
  until: certUntil(Date.now()),
});

async function firstApp(a: Account): Promise<{ person: Identity; desk: Identity; links: DeviceLink[] }> {
  const person = await device("person");
  const desk = await device("desk");
  const links = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  expect((await call(a, desk, "PUT", "/v1/account", { links })).status).toBe(204);
  return { person, desk, links };
}

async function asks(a: Account, d: Identity, as: "desktop" | "phone" | "computer" = "desktop"): Promise<{ res: Response; ask: EnrollAsk; nonce: string }> {
  const { ask, nonce } = await askToEnroll(d, { label: "new laptop", os: "macOS", as });
  return { res: await call(a, d, "POST", "/v1/account/ask", { ask }), ask, nonce };
}

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("an account: a signed-in person's device list", () => {
  test("a relay without sign-in keeps no accounts", async () => {
    const res = await fetch(`${bare.url.origin}/v1/account`, { headers: { "x-human-token": "dev:alice" } });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toContain("no sign-in");
  });

  test("an account needs a session", async () => {
    const res = await fetch(`${relay}/v1/account`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { tag: string }).tag).toBe("SignInRequired");
  });

  test("a new account is empty, and the first app publishes its list", async () => {
    const a = account();
    expect(await (await call(a, null, "GET", "/v1/account")).json()).toEqual({ user: a.user, links: [] });
    const { links } = await firstApp(a);
    expect(await (await call(a, null, "GET", "/v1/account")).json()).toEqual({ user: a.user, links });
  });

  test("only a device in the list, or its person, publishes it", async () => {
    const a = account();
    const person = await device("person");
    const desk = await device("desk");
    const links = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
    expect((await call(a, await device("stranger"), "PUT", "/v1/account", { links })).status).toBe(403);
    expect((await call(a, null, "PUT", "/v1/account", { links })).status).toBe(401);
    expect((await call(a, person, "PUT", "/v1/account", { links })).status).toBe(204);
  });

  test("a request signed for another account is refused", async () => {
    const a = account();
    const b = account();
    const { desk, links } = await firstApp(a);
    const text = JSON.stringify({ links });
    const auth = await signRequest(desk, accountScope(a.user), "PUT", "/v1/account", text);
    const res = await fetch(`${relay}/v1/account`, { method: "PUT", headers: { "x-human-token": b.token, authorization: `Bearer ${auth}` }, body: text });
    expect(res.status).toBe(401);
  });

  test("the list only grows: another person, an older version or a fork is refused", async () => {
    const a = account();
    const { desk, links } = await firstApp(a);
    const phone = await device("phone");
    const longer = await grow(links, desk, adds(phone, "phone"));
    expect((await call(a, desk, "PUT", "/v1/account", { links: longer })).status).toBe(204);
    expect((await call(a, desk, "PUT", "/v1/account", { links: longer })).status).toBe(204);

    const older = await call(a, desk, "PUT", "/v1/account", { links });
    expect(older.status).toBe(409);
    expect(await errorOf(older)).toContain("newer device list");

    const fork = await grow(links, desk, adds(await device("other"), "phone"));
    const forked = await call(a, desk, "PUT", "/v1/account", { links: fork });
    expect(forked.status).toBe(409);
    expect(await errorOf(forked)).toContain("doesn't extend");

    const someoneElse = await device("someone");
    const theirs = [await rootLink(someoneElse, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
    const other = await call(a, desk, "PUT", "/v1/account", { links: theirs });
    expect(other.status).toBe(409);
    expect(await errorOf(other)).toContain("another person key");

    const broken = await call(a, desk, "PUT", "/v1/account", { links: [...longer.slice(0, 1), { ...longer[1]!, label: "tampered" }] });
    expect(broken.status).toBe(400);
  });
});

describe("enrolling a new device: commit, answer, reveal", () => {
  test("a new device and the app reach the same six digits", async () => {
    const a = account();
    const { desk, links } = await firstApp(a);
    const laptop = await device("laptop");
    const { res, ask, nonce } = await asks(a, laptop);
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };

    const seen = (await (await call(a, desk, "GET", "/v1/account/ask")).json()) as Enrollment;
    expect(seen).toMatchObject({ id, ask });
    expect(seen.answer).toBeUndefined();

    const early = await call(a, laptop, "PUT", `/v1/account/ask/${id}/reveal`, { nonce });
    expect(early.status).toBe(409);

    const answer: EnrollAnswer = { device: desk.pk, dxpk: desk.xpk!, nonce: enrollNonce() };
    expect((await call(a, laptop, "PUT", `/v1/account/ask/${id}/answer`, answer)).status).toBe(403);
    expect((await call(a, desk, "PUT", `/v1/account/ask/${id}/answer`, { ...answer, dxpk: laptop.xpk! })).status).toBe(400);
    expect((await call(a, desk, "PUT", `/v1/account/ask/${id}/answer`, answer)).status).toBe(204);
    expect((await call(a, desk, "PUT", `/v1/account/ask/${id}/answer`, { ...answer, nonce: enrollNonce() })).status).toBe(409);

    const answered = (await (await call(a, laptop, "GET", "/v1/account/ask")).json()) as Enrollment;
    expect(answered.answer).toMatchObject(answer);

    const wrong = await call(a, laptop, "PUT", `/v1/account/ask/${id}/reveal`, { nonce: enrollNonce() });
    expect(wrong.status).toBe(400);
    expect(await errorOf(wrong)).toContain("commitment");
    expect((await call(a, desk, "PUT", `/v1/account/ask/${id}/reveal`, { nonce })).status).toBe(403);
    expect((await call(a, laptop, "PUT", `/v1/account/ask/${id}/reveal`, { nonce })).status).toBe(204);
    expect((await call(a, laptop, "PUT", `/v1/account/ask/${id}/reveal`, { nonce })).status).toBe(409);

    const revealed = (await (await call(a, desk, "GET", "/v1/account/ask")).json()) as Enrollment;
    const onApp = await enrollDigits(revealed.ask, revealed.answer!, revealed.reveal!.nonce);
    const onDevice = await enrollDigits(ask, answered.answer!, nonce);
    expect(onApp).toMatch(/^\d{6}$/);
    expect(onApp).toBe(onDevice);

    const listed = await grow(links, desk, adds(laptop, "desktop", true));
    expect((await call(a, desk, "PUT", "/v1/account", { links: listed })).status).toBe(204);
    expect((await call(a, laptop, "DELETE", `/v1/account/ask/${id}`)).status).toBe(204);
    expect((await call(a, desk, "GET", "/v1/account/ask")).status).toBe(404);
    const again = await asks(a, laptop);
    expect(again.res.status).toBe(409);
    expect(await errorOf(again.res)).toContain("already one of");
  });

  test("an account keeps one pending ask: a new one replaces it, even answered, and it's gone after ten minutes", async () => {
    const a = account();
    const { desk } = await firstApp(a);
    const first = await device("first");
    const asked = await asks(a, first, "phone");
    expect(asked.res.status).toBe(202);
    const { id } = (await asked.res.json()) as { id: string };
    const answer: EnrollAnswer = { device: desk.pk, dxpk: desk.xpk!, nonce: enrollNonce() };
    expect((await call(a, desk, "PUT", `/v1/account/ask/${id}/answer`, answer)).status).toBe(204);

    const second = await device("second");
    const again = await asks(a, second, "phone");
    expect(again.res.status).toBe(202);
    const { id: next } = (await again.res.json()) as { id: string };
    const kept = (await (await call(a, desk, "GET", "/v1/account/ask")).json()) as Enrollment;
    expect(kept).toMatchObject({ id: next, ask: again.ask });
    expect(kept.answer).toBeUndefined();
    expect((await call(a, first, "GET", "/v1/account/ask")).status).toBe(403);
    const stale = await call(a, first, "PUT", `/v1/account/ask/${id}/reveal`, { nonce: asked.nonce });
    expect(stale.status).toBe(404);
    expect(await errorOf(stale)).toContain("gone");

    t += ENROLL_TTL_MS + 1;
    setSystemTime(t);
    expect((await call(a, desk, "GET", "/v1/account/ask")).status).toBe(404);
    expect((await asks(a, first)).res.status).toBe(202);
  });

  test("an app turns an ask away; a device that can't approve neither reads nor answers it", async () => {
    const a = account();
    const { desk, links } = await firstApp(a);
    const phone = await device("phone");
    expect((await call(a, desk, "PUT", "/v1/account", { links: await grow(links, desk, adds(phone, "phone")) })).status).toBe(204);
    const { res } = await asks(a, await device("asker"));
    const { id } = (await res.json()) as { id: string };
    expect((await call(a, phone, "GET", "/v1/account/ask")).status).toBe(403);
    expect((await call(a, phone, "PUT", `/v1/account/ask/${id}/answer`, { device: phone.pk, dxpk: phone.xpk!, nonce: enrollNonce() })).status).toBe(403);
    expect((await call(a, await device("stranger"), "DELETE", `/v1/account/ask/${id}`)).status).toBe(403);
    expect((await call(a, desk, "DELETE", `/v1/account/ask/${id}`)).status).toBe(204);
    expect((await call(a, desk, "GET", "/v1/account/ask")).status).toBe(404);
  });

  test("a device asks only for itself, and only once the first app is in", async () => {
    const a = account();
    const laptop = await device("laptop");
    const none = await asks(a, laptop);
    expect(none.res.status).toBe(404);
    await firstApp(a);
    const { ask } = await askToEnroll(laptop, { label: "laptop", os: "macOS", as: "desktop" });
    expect((await call(a, await device("other"), "POST", "/v1/account/ask", { ask })).status).toBe(403);
    expect((await call(a, laptop, "POST", "/v1/account/ask", { ask: { ...ask, extra: 1 } })).status).toBe(400);
  });

  test("asks per account are capped per minute", async () => {
    const a = account();
    await firstApp(a);
    const laptop = await device("laptop");
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await asks(a, laptop)).res.status);
    expect(codes).toEqual([202, 202, 202, 202, 202, 429]);
  });
});

describe("a revoked device is refused", () => {
  test("its asks and requests are refused, and its computer's inbox is cut off", async () => {
    const a = account();
    const { person, desk, links } = await firstApp(a);
    const box = await device("box");
    const withBox = await grow(links, desk, adds(box, "computer"));
    expect((await call(a, desk, "PUT", "/v1/account", { links: withBox })).status).toBe(204);

    const cert = await certifyMachine(person, { pk: box.pk, xpk: box.xpk!, label: "box" });
    const machinePath = `/v1/machine/${box.pk}`;
    const register = JSON.stringify({ cert });
    const registered = await fetch(relay + machinePath, {
      method: "PUT",
      headers: { authorization: `Bearer ${await signRequest(box, machineScope(box.pk), "PUT", machinePath, register)}` },
      body: register,
    });
    expect(registered.status).toBe(204);
    const wsPath = `${machinePath}/ws`;
    const ws = new WebSocket(relay.replace(/^http/, "ws") + wsPath, [WS_PROTOCOL, await signRequest(box, machineScope(box.pk), "GET", wsPath)]);
    const closed = new Promise<number>((resolve) => (ws.onclose = (e) => resolve(e.code)));
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("the inbox socket didn't open"));
    });

    expect((await call(a, desk, "PUT", "/v1/account", { links: await grow(withBox, desk, { op: "revoke", device: box.pk }) })).status).toBe(204);
    expect(await closed).toBe(4000);

    const inboxPath = `${machinePath}/inbox`;
    const inbox = await fetch(relay + inboxPath, { headers: { authorization: `Bearer ${await signRequest(box, machineScope(box.pk), "GET", inboxPath)}` } });
    expect(inbox.status).toBe(403);
    expect(await errorOf(inbox)).toContain("removed");
    const again = await fetch(relay + machinePath, {
      method: "PUT",
      headers: { authorization: `Bearer ${await signRequest(box, machineScope(box.pk), "PUT", machinePath, register)}` },
      body: register,
    });
    expect(again.status).toBe(403);

    const asked = await asks(a, box, "computer");
    expect(asked.res.status).toBe(403);
    expect(await errorOf(asked.res)).toContain("removed");
    expect((await call(a, box, "GET", "/v1/account/ask")).status).toBe(403);
  });
});
