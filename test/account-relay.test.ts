import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { certUntil, nextLink, readDeviceList, rerootLink, rootLink, type DeviceLink, type DeviceLinkBody } from "@kiwi/core/devices.ts";
import { accountScope, askToEnroll, ENROLL_TTL_MS, enrollDigits, enrollNonce, type EnrollAnswer, type EnrollAsk, type Enrollment } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { openVault, readRecovery, recoveryAfter, recoveryKey, recoveryLink, sealVault, type Recovery, type RecoveryLink, type Vault } from "@kiwi/core/recovery.ts";
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

describe("the vault: the recovery chain and signed versions (T823)", () => {
  const paper = () => recoveryKey(new Uint8Array(32).fill(7));

  async function readOf(links: DeviceLink[], chain: RecoveryLink[]): Promise<Recovery> {
    const list = await readDeviceList(links);
    if (!list.ok) throw new Error(list.why);
    const read = await readRecovery(chain, list.list, t);
    if (!read.ok) throw new Error(read.why);
    return read.recovery;
  }

  async function setUp(a: Account) {
    const first = await firstApp(a);
    const key = await paper();
    const chain = [await recoveryLink(first.person, first.person.pk, null, { pk: key.pk, xpk: key.xpk! }, t)];
    expect((await call(a, first.desk, "PUT", "/v1/account/vault", { recovery: chain })).status).toBe(204);
    const seal = async (signer: Identity, version: number, label = "home"): Promise<Vault> =>
      sealVault(signer, await readOf(first.links, chain), version, { person: first.person, channels: [{ label, code: "c", owner: first.desk }] }, t);
    return { ...first, key, chain, seal };
  }

  const kept = async (a: Account) => (await (await call(a, null, "GET", "/v1/account/vault")).json()) as { recovery: unknown[]; vault: Vault | null };

  test("a new account keeps no vault, and a vault waits for the device list and a recovery key", async () => {
    const a = account();
    expect(await kept(a)).toEqual({ recovery: [], vault: null });
    const person = await device("person");
    const key = await paper();
    const early = await call(a, person, "PUT", "/v1/account/vault", { recovery: [await recoveryLink(person, person.pk, null, { pk: key.pk, xpk: key.xpk! }, t)] });
    expect(early.status).toBe(404);
    const { desk } = await firstApp(a);
    const vault = await call(a, desk, "PUT", "/v1/account/vault", { vault: { kind: "kiwi-vault" } });
    expect(vault.status).toBe(409);
    expect(await errorOf(vault)).toContain("recovery key before");
    expect((await call(a, desk, "PUT", "/v1/account/vault", {})).status).toBe(400);
  });

  test("versions only go up, one at a time, and the recovery key opens what's kept", async () => {
    const a = account();
    const { desk, person, key, chain, seal } = await setUp(a);
    const v1 = await seal(desk, 1);
    expect((await call(a, desk, "PUT", "/v1/account/vault", { vault: v1 })).status).toBe(204);
    expect((await call(a, desk, "PUT", "/v1/account/vault", { vault: v1 })).status).toBe(204);
    const skipped = await call(a, desk, "PUT", "/v1/account/vault", { vault: await seal(desk, 3) });
    expect(skipped.status).toBe(400);
    expect(await errorOf(skipped)).toContain("doesn't follow version 1");
    const v2 = await seal(person, 2, "work");
    expect((await call(a, desk, "PUT", "/v1/account/vault", { vault: v2 })).status).toBe(204);

    for (const old of [v1, await seal(desk, 2, "rolled back"), await seal(desk, 1, "rolled back")]) {
      const back = await call(a, desk, "PUT", "/v1/account/vault", { vault: old });
      expect(back.status).toBe(409);
      expect(await errorOf(back)).toContain("version 2 is already kept");
    }
    const got = await kept(a);
    expect(got).toEqual({ recovery: chain, vault: v2 });
    expect((await openVault(got.vault!, key))?.channels.map((c) => c.label)).toEqual(["work"]);
  });

  test("a forged vault is refused: a changed version, a stranger's or a phone's signature, another person's", async () => {
    const a = account();
    const { desk, links, chain, seal } = await setUp(a);
    const phone = await device("phone");
    const withPhone = await grow(links, desk, adds(phone, "phone"));
    expect((await call(a, desk, "PUT", "/v1/account", { links: withPhone })).status).toBe(204);
    const v1 = await seal(desk, 1);
    const bumped = await call(a, desk, "PUT", "/v1/account/vault", { vault: { ...v1, version: 2 } });
    expect(bumped.status).toBe(400);
    expect(await errorOf(bumped)).toContain("isn't signed");
    for (const signer of [await device("stranger"), phone]) {
      const res = await call(a, desk, "PUT", "/v1/account/vault", { vault: await seal(signer, 1) });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toContain("approving devices");
    }
    const elsewhere = await device("elsewhere");
    const theirs = await sealVault(elsewhere, { ...(await readOf(links, chain)), person: elsewhere.pk, root: elsewhere.pk }, 1, { person: elsewhere, channels: [] }, t);
    expect(await errorOf(await call(a, desk, "PUT", "/v1/account/vault", { vault: theirs }))).toContain("another person");
    expect((await call(a, phone, "PUT", "/v1/account/vault", { vault: v1 })).status).toBe(403);
    expect((await kept(a)).vault).toBeNull();
  });

  test("a vault from an app whose certificate ran out is refused", async () => {
    const a = account();
    const { desk, person, links, seal } = await setUp(a);
    const laptop = await device("laptop");
    const short = await grow(links, person, { op: "add", device: laptop.pk, dxpk: laptop.xpk!, label: "laptop", os: "macOS", as: "desktop", approve: true, until: t + 60_000 });
    expect((await call(a, desk, "PUT", "/v1/account", { links: short })).status).toBe(204);
    const v1 = await seal(laptop, 1);
    t += 120_000;
    const res = await call(a, desk, "PUT", "/v1/account/vault", { vault: v1 });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toContain("current approving");
  });

  test("a revoked app is refused: its requests, its vaults and its recovery proposals", async () => {
    const a = account();
    const { desk, person, links, chain, seal, key } = await setUp(a);
    const thief = await device("thief");
    const withThief = await grow(links, desk, adds(thief, "desktop", true));
    expect((await call(a, desk, "PUT", "/v1/account", { links: withThief })).status).toBe(204);
    const stolen = await seal(thief, 1, "stolen");
    const other = await recoveryKey(new Uint8Array(32).fill(8));
    const proposal = await recoveryLink(thief, person.pk, await readOf(withThief, chain), { pk: other.pk, xpk: other.xpk! }, t);
    expect((await call(a, desk, "PUT", "/v1/account", { links: await grow(withThief, desk, { op: "revoke", device: thief.pk }) })).status).toBe(204);

    const own = await call(a, thief, "PUT", "/v1/account/vault", { vault: stolen });
    expect(own.status).toBe(403);
    expect(await errorOf(own)).toContain("removed");
    expect(await errorOf(await call(a, desk, "PUT", "/v1/account/vault", { vault: stolen }))).toContain("approving devices");
    const proposed = await call(a, desk, "PUT", "/v1/account/vault", { recovery: [...chain, proposal] });
    expect(proposed.status).toBe(403);
    expect(await errorOf(proposed)).toContain("removed device");
    expect(await kept(a)).toEqual({ recovery: chain, vault: null });
    expect(key.pk).not.toBe(other.pk);
  });

  test("the recovery chain only grows, a proposal carries the relay's time, and the recovery key replaces itself", async () => {
    const a = account();
    const { desk, person, links, chain, key } = await setUp(a);
    t += 10 * 86_400_000;
    setSystemTime(new Date(t));
    const other = await recoveryKey(new Uint8Array(32).fill(9));
    const r1 = await readOf(links, chain);
    const backdated = await recoveryLink(desk, person.pk, r1, { pk: other.pk, xpk: other.xpk! }, t - 8 * 86_400_000);
    const back = await call(a, desk, "PUT", "/v1/account/vault", { recovery: [...chain, backdated] });
    expect(back.status).toBe(400);
    expect(await errorOf(back)).toContain("time it's sent");

    const proposal = await recoveryLink(desk, person.pk, r1, { pk: other.pk, xpk: other.xpk! }, t);
    expect(proposal.after).toBe(recoveryAfter(t));
    const longer = [...chain, proposal];
    expect((await call(a, desk, "PUT", "/v1/account/vault", { recovery: longer })).status).toBe(204);
    expect((await call(a, desk, "PUT", "/v1/account/vault", { recovery: chain })).status).toBe(409);
    const fork = [...chain, await recoveryLink(key, person.pk, r1, { pk: other.pk, xpk: other.xpk! }, t)];
    expect(await errorOf(await call(a, desk, "PUT", "/v1/account/vault", { recovery: fork }))).toContain("doesn't extend");

    const r2 = await readOf(links, longer);
    expect(r2.pending?.rpk).toBe(other.pk);
    const cancel = await recoveryLink(key, person.pk, r2, { pk: key.pk, xpk: key.xpk! }, t);
    expect((await call(a, key, "PUT", "/v1/account/vault", { recovery: [...longer, cancel] })).status).toBe(204);
    expect((await kept(a)).recovery).toHaveLength(3);
    expect((await call(a, await device("stranger"), "PUT", "/v1/account/vault", { recovery: [...longer, cancel] })).status).toBe(403);
  });

  test("a vault too large is refused", async () => {
    const a = account();
    const { desk, seal } = await setUp(a);
    const v1 = await seal(desk, 1);
    const huge = await call(a, desk, "PUT", "/v1/account/vault", { vault: { ...v1, box: "x".repeat(1024 * 1024) } });
    expect(huge.status).toBe(413);
    const big = await call(a, desk, "PUT", "/v1/account/vault", { vault: { ...v1, box: "x".repeat(600 * 1024) } });
    expect(big.status).toBe(400);
    expect(await errorOf(big)).toContain("too large");
  });
});

describe("re-rooting to a new person key (T827)", () => {
  async function setUp(a: Account) {
    const first = await firstApp(a);
    const thief = await device("thief");
    const links = await grow(first.links, first.desk, adds(thief, "desktop", true), t);
    expect((await call(a, first.desk, "PUT", "/v1/account", { links })).status).toBe(204);
    const key = await recoveryKey(new Uint8Array(32).fill(11));
    const chain = [await recoveryLink(first.person, first.person.pk, null, { pk: key.pk, xpk: key.xpk! }, t)];
    expect((await call(a, first.desk, "PUT", "/v1/account/vault", { recovery: chain })).status).toBe(204);
    const list = await readDeviceList(links);
    if (!list.ok) throw new Error(list.why);
    return { ...first, thief, links, list: list.list, key, chain, next: await device("next") };
  }

  test("the recovery key and a new person key re-root the kept list, and the old key and the cut devices lose their say", async () => {
    const a = account();
    const { desk, person, thief, links, list, key, chain, next } = await setUp(a);
    const rerooted = [...links, await rerootLink(list, key, chain, next, [desk.pk], t)];
    expect((await call(a, next, "PUT", "/v1/account", { links: rerooted })).status).toBe(204);
    expect(((await (await call(a, null, "GET", "/v1/account")).json()) as { links: unknown[] }).links).toEqual(rerooted);

    const after = await readDeviceList(rerooted);
    if (!after.ok) throw new Error(after.why);
    const stranger = await device("stranger");
    const byOld = await call(a, person, "PUT", "/v1/account", { links: [...rerooted, await nextLink(after.list, person, adds(stranger, "desktop", true), t)] });
    expect(byOld.status).toBe(400);
    expect(await errorOf(byOld)).toContain("may not change this person's devices");
    expect((await call(a, thief, "PUT", "/v1/account", { links: rerooted })).status).toBe(403);
    expect((await call(a, desk, "PUT", "/v1/account", { links: [...rerooted, await nextLink(after.list, desk, adds(stranger, "phone"), t)] })).status).toBe(204);

    const recovery = await readRecovery(chain, after.list, t);
    if (!recovery.ok) throw new Error(recovery.why);
    const v1 = await sealVault(next, recovery.recovery, 1, { person: next, channels: [] }, t);
    expect((await call(a, person, "PUT", "/v1/account/vault", { vault: v1 })).status).toBe(403);
    const oldSigned = await sealVault(person, { ...recovery.recovery, root: person.pk }, 1, { person, channels: [] }, t);
    expect((await call(a, desk, "PUT", "/v1/account/vault", { vault: oldSigned })).status).toBe(400);
    expect((await call(a, next, "PUT", "/v1/account/vault", { vault: v1 })).status).toBe(204);
    expect((await openVault(v1, key, next.pk))?.person.pk).toBe(next.pk);
    const swap = await recoveryKey(new Uint8Array(32).fill(12));
    const byOldKey = [...chain, await recoveryLink(person, person.pk, recovery.recovery, { pk: swap.pk, xpk: swap.xpk! }, t)];
    expect((await call(a, person, "PUT", "/v1/account/vault", { recovery: byOldKey })).status).toBe(403);
  });

  test("a re-root carries the relay's time and the recovery chain it keeps, so replaced words can't re-root", async () => {
    const a = account();
    const { desk, links, list, key, chain, next } = await setUp(a);
    const late = await call(a, next, "PUT", "/v1/account", { links: [...links, await rerootLink(list, key, chain, next, [desk.pk], t - 10 * 60_000)] });
    expect(late.status).toBe(400);
    expect(await errorOf(late)).toContain("time it's sent");

    const words = await recoveryKey(new Uint8Array(32).fill(13));
    const r1 = await readRecovery(chain, list, t);
    if (!r1.ok) throw new Error(r1.why);
    const replaced = [...chain, await recoveryLink(key, list.person, r1.recovery, { pk: words.pk, xpk: words.xpk! }, t)];
    expect((await call(a, key, "PUT", "/v1/account/vault", { recovery: replaced })).status).toBe(204);
    const stale = await call(a, next, "PUT", "/v1/account", { links: [...links, await rerootLink(list, key, chain, next, [desk.pk], t)] });
    expect(stale.status).toBe(409);
    expect(await errorOf(stale)).toContain("recovery chain this account keeps");
    const old = await call(a, next, "PUT", "/v1/account", { links: [...links, await rerootLink(list, key, replaced, next, [desk.pk], t)] });
    expect(old.status).toBe(400);
    expect(await errorOf(old)).toContain("not signed by the recovery key");
    expect((await call(a, next, "PUT", "/v1/account", { links: [...links, await rerootLink(list, words, replaced, next, [desk.pk], t)] })).status).toBe(204);
  });
});
