import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { certUntil, nextLink, readDeviceList, rerootLink, rootLink, type DeviceLink, type DeviceLinkBody } from "@kiwi/core/devices.ts";
import { accountScope } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { ASK_FRESH_MS, makeAsk, readAsk } from "@kiwi/core/machine-ask.ts";
import { newSecret } from "@kiwi/core/mailbox.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import { recoveryKey, recoveryLink } from "@kiwi/core/recovery.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { machineScope, personScope } from "../src/relay/machine.ts";

setDefaultTimeout(30_000);

const DAY = 86_400_000;
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-machine-device-relay-"));
let t = Date.now();
let server: ReturnType<typeof startRelay>;
let relay: string;
let users = 0;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), now: () => t });
  relay = server.url.origin;
});

beforeEach(() => {
  t = Date.now();
});

afterEach(() => {
  setSystemTime();
});

const travel = (to: number) => {
  setSystemTime(new Date(to));
  t = to;
};

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const key = async (name: string) => withExchangeKey(await generateIdentity(name));

async function grow(links: DeviceLink[], signer: Identity, body: DeviceLinkBody, at = Date.now()): Promise<DeviceLink[]> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await nextLink(read.list, signer, body, at)];
}

const adds = (d: Identity, as: "desktop" | "phone" | "computer", approve = false): DeviceLinkBody => ({
  op: "add",
  device: d.pk,
  dxpk: d.xpk!,
  label: as === "computer" ? "studio" : as,
  os: "macOS",
  as,
  approve,
  until: certUntil(Date.now()),
});

interface People {
  person: Identity;
  desk: Identity;
  laptop: Identity;
  phone: Identity;
  box: Identity;
  other: Identity;
  links: DeviceLink[];
}

async function people(): Promise<People> {
  const person = await key("person");
  const desk = await key("desk");
  const laptop = await key("laptop");
  const phone = await key("phone");
  const box = await key("box");
  const other = await key("other box");
  let links = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  links = await grow(links, desk, adds(laptop, "desktop", true));
  links = await grow(links, desk, adds(phone, "phone"));
  links = await grow(links, desk, adds(box, "computer"));
  links = await grow(links, laptop, adds(other, "computer"));
  return { person, desk, laptop, phone, box, other, links };
}

const base = (m: Identity) => `/v1/machine/${m.pk}`;

async function call(id: Identity, m: Identity, method: string, path: string, body?: unknown): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const auth = await signRequest(id, machineScope(m.pk), method, path, text);
  return fetch(relay + path, { method, headers: { authorization: `Bearer ${auth}`, ...(text ? { "content-type": "application/json" } : {}) }, ...(text ? { body: text } : {}) });
}

async function listMachines(id: Identity, person: string): Promise<Response> {
  const path = `/v1/person/${person}/machines`;
  const auth = await signRequest(id, personScope(person), "GET", path, "");
  return fetch(relay + path, { headers: { authorization: `Bearer ${auth}` } });
}

const ask = (from: Identity, m: Identity) => call(from, m, "POST", `${base(m)}/inbox`, { box: "sealed" });

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("a computer registered with its person's device list", () => {
  test("takes asks from the person key and their approving desktops, and from nobody else", async () => {
    const p = await people();
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    expect((await ask(p.person, p.box)).status).toBe(202);
    expect((await ask(p.desk, p.box)).status).toBe(202);
    expect((await ask(p.laptop, p.box)).status).toBe(202);
    expect((await call(p.laptop, p.box, "GET", base(p.box))).status).toBe(200);
    expect((await ask(p.phone, p.box)).status).toBe(403);
    expect((await ask(p.other, p.box)).status).toBe(403);
    expect((await ask(await key("stranger"), p.box)).status).toBe(403);
  });

  test("is bound to the list's person with the label the list gave it", async () => {
    const p = await people();
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    const res = await listMachines(p.desk, p.person.pk);
    expect(res.status).toBe(200);
    const { machines } = (await res.json()) as { machines: { key: string; label: string; xpk: string }[] };
    expect(machines.map((m) => [m.key, m.label, m.xpk])).toEqual([[p.box.pk, "studio", p.box.xpk!]]);
    expect((await listMachines(p.person, p.person.pk)).status).toBe(200);
    expect((await listMachines(p.phone, p.person.pk)).status).toBe(403);
    expect((await listMachines(p.box, p.person.pk)).status).toBe(403);
    expect((await listMachines(await key("stranger"), p.person.pk)).status).toBe(403);
  });

  test("is refused with a list that doesn't list it as a computer, or that doesn't hold up", async () => {
    const p = await people();
    const stray = await key("stray");
    expect(await errorOf(await call(stray, stray, "PUT", base(stray), { links: p.links }))).toContain("lists it as a current computer");
    expect((await call(p.laptop, p.laptop, "PUT", base(p.laptop), { links: p.links })).status).toBe(400);
    const forged = p.links.map((l, i) => (i === 3 ? { ...l, label: "renamed" } : l));
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: forged })).status).toBe(400);
    const theirs = await people();
    const swapped = [await rootLink(theirs.person, { pk: theirs.desk.pk, xpk: theirs.desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: swapped })).status).toBe(400);
  });

  test("isn't rolled back to an older list, and a newer one revoking a desktop shuts that desktop out", async () => {
    const p = await people();
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    const later = await grow(p.links, p.desk, { op: "revoke", device: p.laptop.pk });
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: later })).status).toBe(204);
    expect((await ask(p.laptop, p.box)).status).toBe(403);
    expect((await ask(p.desk, p.box)).status).toBe(202);
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(409);
    expect((await ask(p.laptop, p.box)).status).toBe(403);
  });

  test("shuts out a desktop whose cert ran out", async () => {
    const p = await people();
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    const start = Date.now();
    travel(start + 80 * DAY);
    expect((await ask(p.desk, p.box)).status).toBe(202);
    travel(start + 91 * DAY);
    expect((await ask(p.desk, p.box)).status).toBe(403);
    expect((await ask(p.person, p.box)).status).toBe(202);
  });

  test("a cert registered after keeps the list while it lists the computer, and hands it back", async () => {
    const p = await people();
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    const cert = await certifyMachine(p.person, { pk: p.box.pk, xpk: p.box.xpk!, label: "studio" }, Date.now() + 1_000);
    const res = await call(p.box, p.box, "PUT", base(p.box), { cert });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { links: unknown[] }).links).toEqual(p.links);
    expect((await ask(p.desk, p.box)).status).toBe(202);
    expect((await ask(p.phone, p.box)).status).toBe(403);
  });

  test("a cert registered after a list that no longer lists the computer drops that list, so a desktop no longer speaks for it", async () => {
    const p = await people();
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    const start = Date.now();
    travel(start + 91 * DAY);
    const cert = await certifyMachine(p.person, { pk: p.box.pk, xpk: p.box.xpk!, label: "studio" }, start + 91 * DAY);
    expect((await call(p.box, p.box, "PUT", base(p.box), { cert })).status).toBe(204);
    travel(start);
    expect((await ask(p.desk, p.box)).status).toBe(403);
    expect((await ask(p.person, p.box)).status).toBe(202);
  });

  test("another person's cert never inherits the list", async () => {
    const p = await people();
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    const theirs = await key("their person");
    const cert = await certifyMachine(theirs, { pk: p.box.pk, xpk: p.box.xpk!, label: "studio" }, Date.now() + 1_000);
    expect((await call(p.box, p.box, "PUT", base(p.box), { cert })).status).toBe(204);
    expect((await ask(p.desk, p.box)).status).toBe(403);
    expect((await ask(theirs, p.box)).status).toBe(202);
  });

  test("an approving desktop can unpair it, a phone can't", async () => {
    const p = await people();
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    expect((await call(p.phone, p.box, "DELETE", base(p.box))).status).toBe(403);
    expect((await call(p.laptop, p.box, "DELETE", base(p.box))).status).toBe(204);
    expect((await ask(p.desk, p.box)).status).toBe(403);
  });
});

describe("the account telling its computers", () => {
  const account = () => {
    const name = `devices${++users}`;
    return { user: `dev_${name}`, token: `dev:${name}` };
  };

  async function publish(a: { user: string; token: string }, signer: Identity, links: DeviceLink[]): Promise<Response> {
    const text = JSON.stringify({ links });
    const auth = await signRequest(signer, accountScope(a.user), "PUT", "/v1/account", text);
    return fetch(`${relay}/v1/account`, { method: "PUT", headers: { "x-human-token": a.token, authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: text });
  }

  test("a desktop revoked in the account's list stops speaking for its computers", async () => {
    const p = await people();
    const a = account();
    expect((await publish(a, p.desk, p.links)).status).toBe(204);
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    expect((await ask(p.laptop, p.box)).status).toBe(202);
    expect((await publish(a, p.desk, await grow(p.links, p.desk, { op: "revoke", device: p.laptop.pk }))).status).toBe(204);
    expect((await ask(p.laptop, p.box)).status).toBe(403);
    expect((await ask(p.desk, p.box)).status).toBe(202);
  });

  test("a computer paired by an old person-signed cert (kp1) takes asks from approving desktops once the list names it", async () => {
    const p = await people();
    const a = account();
    const old = await key("kp1 box");
    const cert = await certifyMachine(p.person, { pk: old.pk, xpk: old.xpk!, label: "old box" });
    expect((await call(old, old, "PUT", base(old), { cert })).status).toBe(204);
    expect((await ask(p.desk, old)).status).toBe(403);
    expect((await publish(a, p.desk, p.links)).status).toBe(204);
    expect((await ask(p.desk, old)).status).toBe(403);
    expect((await ask(p.person, old)).status).toBe(202);
    const named = await grow(p.links, p.desk, adds(old, "computer"));
    expect((await publish(a, p.desk, named)).status).toBe(204);
    expect((await ask(p.desk, old)).status).toBe(202);
    expect((await ask(p.laptop, old)).status).toBe(202);
    expect((await ask(p.phone, old)).status).toBe(403);
    expect((await ask(p.box, old)).status).toBe(403);
    const again = await call(old, old, "PUT", base(old), { cert });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { links: unknown[] }).links).toEqual(named);
  });

  test("a re-root moves its computers to the new person key: the old one asks and lists nothing, and the cut desktop is out", async () => {
    const p = await people();
    const a = account();
    expect((await publish(a, p.desk, p.links)).status).toBe(204);
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    expect((await call(p.other, p.other, "PUT", base(p.other), { links: p.links })).status).toBe(204);
    const paper = await recoveryKey(new Uint8Array(32).fill(31));
    const chain = [await recoveryLink(p.person, p.person.pk, null, { pk: paper.pk, xpk: paper.xpk! }, t)];
    const text = JSON.stringify({ recovery: chain });
    const auth = await signRequest(p.desk, accountScope(a.user), "PUT", "/v1/account/vault", text);
    const kept = await fetch(`${relay}/v1/account/vault`, { method: "PUT", headers: { "x-human-token": a.token, authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: text });
    expect(kept.status).toBe(204);
    const list = await readDeviceList(p.links);
    if (!list.ok) throw new Error(list.why);
    const next = await key("next");
    expect((await publish(a, next, [...p.links, await rerootLink(list.list, paper, chain, next, [p.desk.pk, p.box.pk], t)])).status).toBe(204);

    expect((await ask(p.person, p.box)).status).toBe(403);
    expect((await ask(p.laptop, p.box)).status).toBe(403);
    expect((await ask(next, p.box)).status).toBe(202);
    expect((await ask(p.desk, p.box)).status).toBe(202);
    expect((await listMachines(p.person, p.person.pk)).status).toBe(403);
    const listed = await listMachines(next, p.person.pk);
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { machines: { key: string }[] }).machines.map((m) => m.key)).toEqual([p.box.pk]);
  });

  test("another person's list naming a cert-paired computer gives their devices nothing", async () => {
    const p = await people();
    const theirs = await people();
    const a = account();
    const old = await key("kp1 box");
    const cert = await certifyMachine(p.person, { pk: old.pk, xpk: old.xpk!, label: "old box" });
    expect((await call(old, old, "PUT", base(old), { cert })).status).toBe(204);
    expect((await publish(a, theirs.desk, await grow(theirs.links, theirs.desk, adds(old, "computer")))).status).toBe(204);
    expect((await ask(theirs.desk, old)).status).toBe(403);
    expect((await ask(theirs.person, old)).status).toBe(403);
    expect((await ask(p.person, old)).status).toBe(202);
    expect((await call(old, old, "PUT", base(old), { cert })).status).toBe(204);
  });

  test("a computer revoked in the account's list is unpaired and stays out", async () => {
    const p = await people();
    const a = account();
    expect((await publish(a, p.desk, p.links)).status).toBe(204);
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(204);
    expect((await publish(a, p.desk, await grow(p.links, p.desk, { op: "revoke", device: p.box.pk }))).status).toBe(204);
    expect((await ask(p.desk, p.box)).status).toBe(403);
    expect((await call(p.box, p.box, "PUT", base(p.box), { links: p.links })).status).toBe(403);
  });
});

describe("an ask signed by a device", () => {
  test("is the person's when the computer's list has that device approving", async () => {
    const p = await people();
    const read = await readDeviceList(p.links);
    if (!read.ok) throw new Error(read.why);
    const list = read.list;
    const claimed = new Set<string>();
    const claim = (id: string) => !claimed.has(id) && !!claimed.add(id);
    const from = async (signer: Identity) => (await makeAsk(signer, { pk: p.box.pk, xpk: p.box.xpk! }, { verb: "harnesses", args: {}, reply: newSecret() }, 1_000)).box;
    expect((await readAsk(p.box, await from(p.laptop), { person: p.person.pk, list, now: 1_000, claim })).ok).toBe(true);
    expect((await readAsk(p.box, await from(p.person), { person: p.person.pk, list, now: 1_000, claim })).ok).toBe(true);
    expect(await readAsk(p.box, await from(p.laptop), { person: p.person.pk, now: 1_000, claim })).toEqual({ ok: false, why: "not-yours" });
    expect(await readAsk(p.box, await from(p.phone), { person: p.person.pk, list, now: 1_000, claim })).toEqual({ ok: false, why: "not-yours" });
    expect(await readAsk(p.box, await from(p.other), { person: p.person.pk, list, now: 1_000, claim })).toEqual({ ok: false, why: "not-yours" });
    expect(await readAsk(p.box, await from(p.laptop), { person: (await key("stranger")).pk, list, now: 1_000, claim })).toEqual({ ok: false, why: "not-yours" });
    const later = await readDeviceList(await grow(p.links, p.desk, { op: "revoke", device: p.laptop.pk }));
    if (!later.ok) throw new Error(later.why);
    expect(await readAsk(p.box, await from(p.laptop), { person: p.person.pk, list: later.list, now: 1_000, claim })).toEqual({ ok: false, why: "not-yours" });
    const expired = certUntil(Date.now()) + 1;
    const old = (await makeAsk(p.laptop, { pk: p.box.pk, xpk: p.box.xpk! }, { verb: "harnesses", args: {}, reply: newSecret() }, expired)).box;
    expect(await readAsk(p.box, old, { person: p.person.pk, list, now: expired + ASK_FRESH_MS - 1, claim })).toEqual({ ok: false, why: "not-yours" });
  });
});
