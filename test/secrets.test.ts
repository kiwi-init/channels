import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { JoinClaims } from "@kiwi/core/membership.ts";
import { provePerson } from "@kiwi/core/person.ts";
import { openSecret, sealSecret, SecretGuard, secretNeedles, type SecretPlain } from "@kiwi/core/secrets.ts";
import { startRelay } from "../src/relay/bun.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const STRIPE = "sk_test_51HxQ2bLkdIu7Gf9aZ0pQ";
const DB_URL = "postgres://billing:Wd8p2Lq7xNe3@db.internal:5432/billing";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-secrets-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let code: string;
let owner: Identity;
let ownerCh: Channel;
const agents: Record<string, { id: Identity; ch: Channel }> = {};

async function admit(name: string, claims?: (memberPk: string) => Promise<JoinClaims>): Promise<{ id: Identity; ch: Channel }> {
  const id = await generateIdentity(name);
  const ask = await Channel.requestJoin(relay, code, id, { name }, claims ? await claims(id.pk) : undefined);
  const [req] = await checked(ownerCh, relay, code, [{ id, requestId: ask.requestId }]);
  await ownerCh.approve(req!);
  const st = (await Channel.joinStatus(relay, code, id, ask.requestId)) as { access: ChannelAccess };
  return { id, ch: new Channel(st.access, relay, id) };
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  owner = await generateIdentity("human");
  const made = await Channel.create(relay, owner, { name: "human" });
  code = made.code;
  ownerCh = new Channel(made.access, relay, owner);
  for (const name of ["billing", "docs", "gone"]) agents[name] = await admit(name);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const roomFile = () => join(dataDir, `${ownerCh.roomId}.sqlite`);

test("the owner gives a secret to one agent: that agent opens it, the others get nothing, and the relay never sees it", async () => {
  const made = await ownerCh.setSecret({ name: "STRIPE_KEY", value: STRIPE, note: "test mode, read-only", grants: [agents.billing!.id.pk] });
  expect(made).toMatchObject({ name: "STRIPE_KEY", note: "test mode, read-only", rev: 1, grants: [agents.billing!.id.pk], had: [agents.billing!.id.pk] });
  expect(made).not.toHaveProperty("value");

  const mine = await agents.billing!.ch.mySecrets();
  expect(mine.map((s) => [s.name, s.value, s.note])).toEqual([["STRIPE_KEY", STRIPE, "test mode, read-only"]]);
  expect(await agents.docs!.ch.mySecrets()).toEqual([]);

  const raw = await fetch(`${relay}/v1/rooms/${ownerCh.roomId}/secrets`, {
    headers: { authorization: `Bearer ${await signRequest(agents.billing!.id, ownerCh.roomId, "GET", "/secrets", "")}` },
  });
  const served = await raw.text();
  expect(served).toContain(made.id);
  for (const leak of [STRIPE, "STRIPE_KEY", "read-only"]) expect(served).not.toContain(leak);
  const onDisk = readFileSync(roomFile()).toString("latin1");
  for (const leak of [STRIPE, "STRIPE_KEY"]) expect(onDisk).not.toContain(leak);
  expect((await ownerCh.info()).secrets).toBe(true);
});

test("the owner lists secrets without their values, and opens one on purpose", async () => {
  const list = await ownerCh.secrets();
  expect(list.map((s) => s.name)).toEqual(["STRIPE_KEY"]);
  expect(JSON.stringify(list)).not.toContain(STRIPE);
  expect(await ownerCh.secretValue(list[0]!.id)).toBe(STRIPE);
});

test("taking an agent off drops its copy at once, and the owner still sees that it had the value until the value changes", async () => {
  const [s] = await ownerCh.secrets();
  const both = await ownerCh.setSecret({ id: s!.id, name: "STRIPE_KEY", grants: [agents.billing!.id.pk, agents.docs!.id.pk] });
  expect((await agents.docs!.ch.mySecrets()).map((x) => x.value)).toEqual([STRIPE]);
  const off = await ownerCh.setSecret({ id: both.id, name: "STRIPE_KEY", grants: [agents.billing!.id.pk] });
  expect(off.rev).toBe(3);
  expect(await agents.docs!.ch.mySecrets()).toEqual([]);
  expect(off.grants).toEqual([agents.billing!.id.pk]);
  expect(new Set(off.had)).toEqual(new Set([agents.billing!.id.pk, agents.docs!.id.pk]));
  const rotated = await ownerCh.setSecret({ id: off.id, name: "STRIPE_KEY", value: `${STRIPE}rotated`, grants: [agents.billing!.id.pk] });
  expect(rotated.had).toEqual([agents.billing!.id.pk]);
  expect((await agents.billing!.ch.mySecrets())[0]!.value).toBe(`${STRIPE}rotated`);
  expect(await agents.docs!.ch.mySecrets()).toEqual([]);
});

test("names, values and grants are checked before anything is sealed", async () => {
  const pk = agents.billing!.id.pk;
  await expect(ownerCh.setSecret({ name: "stripe_key", value: STRIPE, grants: [] })).rejects.toThrow(/capital letters/);
  await expect(ownerCh.setSecret({ name: "PATH", value: STRIPE, grants: [] })).rejects.toThrow(/relies on/);
  await expect(ownerCh.setSecret({ name: "KIWI_RELAY", value: STRIPE, grants: [] })).rejects.toThrow(/relies on/);
  await expect(ownerCh.setSecret({ name: "SHORT", value: "1234567", grants: [] })).rejects.toThrow(/at least 8/);
  await expect(ownerCh.setSecret({ name: "NUL", value: "abcdefgh\0", grants: [] })).rejects.toThrow(/NUL/);
  await expect(ownerCh.setSecret({ name: "STRIPE_KEY", value: STRIPE, grants: [] })).rejects.toThrow(/already a secret named STRIPE_KEY/);
  await expect(ownerCh.setSecret({ name: "NEW_ONE", grants: [] })).rejects.toThrow(/needs its value/);
  await expect(ownerCh.setSecret({ name: "OWNERS", value: STRIPE, grants: [owner.pk] })).rejects.toThrow(/isn't an agent/);
  const stranger = await generateIdentity("stranger");
  await expect(ownerCh.setSecret({ name: "STRANGER", value: STRIPE, grants: [stranger.pk] })).rejects.toThrow(/isn't an agent/);
  await expect(ownerCh.setSecret({ id: "A".repeat(22), name: "MISSING", value: STRIPE, grants: [pk] })).rejects.toThrow(/no such secret/);
  await expect(agents.billing!.ch.setSecret({ name: "MINE", value: STRIPE, grants: [pk] })).rejects.toThrow(/owner/);
  await expect(agents.billing!.ch.secrets()).rejects.toThrow(/owner/);
});

test("a person in the channel can't be given a secret: only agents", async () => {
  const person = await generateIdentity("Pat");
  const pat = await admit("pat", async (memberPk) => ({ person: await provePerson(person, ownerCh.roomId, memberPk) }));
  expect((await ownerCh.members()).find((m) => m.pk === pat.id.pk)?.kind).toBe("human");
  await expect(ownerCh.setSecret({ name: "FOR_PAT", value: STRIPE, grants: [pat.id.pk] })).rejects.toThrow(/isn't an agent/);
});

test("the send guard refuses a message carrying a secret's value, in the plain or in the usual encodings", async () => {
  const billing = agents.billing!.ch;
  const [s] = await billing.mySecrets();
  const value = s!.value;
  const refused = /holds the value of the secret STRIPE_KEY, so it wasn't sent/;
  await expect(billing.send(`the key is ${value}`)).rejects.toThrow(refused);
  await expect(billing.send(`curl -H "Authorization: Basic ${btoa(`api:${value}`)}"`)).rejects.toThrow(refused);
  await expect(billing.send(`token=${encodeURIComponent(value)}`)).rejects.toThrow(refused);
  await expect(billing.send(`hex ${Buffer.from(value).toString("hex")}`)).rejects.toThrow(refused);
  await expect(billing.send("done", { choices: [value, "no"], esc: true })).rejects.toThrow(refused);
  expect(await billing.send("STRIPE_KEY works: charged the test card")).toBeGreaterThan(0);
  await expect(agents.docs!.ch.send(`docs held the first value: ${STRIPE}`)).rejects.toThrow(refused);
});

test("the owner's own sends are guarded once it has read its secrets, and a CLI can arm the guard from copies it keeps", async () => {
  await ownerCh.secrets();
  await expect(ownerCh.send(`pasted by mistake: ${STRIPE}rotated`)).rejects.toThrow(/STRIPE_KEY/);
  const fresh = new Channel(agents.docs!.ch.access, relay, agents.docs!.id);
  fresh.guardSecrets([{ name: "DATABASE_URL", value: DB_URL }]);
  await expect(fresh.send("the password is Wd8p2Lq7xNe3")).rejects.toThrow(/DATABASE_URL/);
});

test("a copy the owner didn't sign, one moved to another key or another channel, and a rolled-back one are all refused", async () => {
  const billing = agents.billing!;
  const docs = agents.docs!;
  const [s] = await billing.ch.mySecrets();
  const plain: SecretPlain = { v: 1, room: ownerCh.roomId, id: s!.id, to: billing.id.pk, name: "STRIPE_KEY", value: "sk_live_from_the_relay", rev: 99, at: Date.now() };
  const row = (box: string) => ({ id: s!.id, box, at: Date.now() });

  const real = await sealSecret(owner, billing.id as { pk: string; xpk: string }, plain);
  expect((await openSecret(billing.id, ownerCh.roomId, owner.pk, row(real)))?.value).toBe("sk_live_from_the_relay");

  const forged = await sealSecret(docs.id, billing.id as { pk: string; xpk: string }, plain);
  expect(await openSecret(billing.id, ownerCh.roomId, owner.pk, row(forged))).toBeNull();
  expect(await openSecret(docs.id, ownerCh.roomId, owner.pk, row(real))).toBeNull();
  expect(await openSecret(billing.id, "0".repeat(32), owner.pk, row(real))).toBeNull();
  expect(await openSecret(billing.id, ownerCh.roomId, owner.pk, { id: "B".repeat(22), box: real, at: 1 })).toBeNull();
  expect(await openSecret(billing.id, ownerCh.roomId, owner.pk, row("{not json"))).toBeNull();

  const ahead = new Channel({ ...billing.ch.access, seenSecrets: { [s!.id]: s!.rev + 1 } }, relay, billing.id);
  expect(await ahead.mySecrets()).toEqual([]);
  let saved: ChannelAccess | null = null;
  const behind = new Channel({ ...billing.ch.access, seenSecrets: {} }, relay, billing.id, (a) => (saved = a));
  expect((await behind.mySecrets()).length).toBe(1);
  expect((saved as ChannelAccess | null)?.seenSecrets?.[s!.id]).toBe(s!.rev);
});

test("the relay takes copies only from the owner, only for members, and within its limits", async () => {
  const id = "C".repeat(22);
  const put = async (as: Identity, body: unknown) => {
    const text = JSON.stringify(body);
    const path = `/secrets/${id}`;
    return fetch(`${relay}/v1/rooms/${ownerCh.roomId}${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${await signRequest(as, ownerCh.roomId, "PUT", path, text)}` },
      body: text,
    });
  };
  expect((await put(agents.billing!.id, { boxes: { [agents.billing!.id.pk]: "x" } })).status).toBe(403);
  expect((await put(owner, { boxes: {} })).status).toBe(400);
  expect((await put(owner, { boxes: { [(await generateIdentity("eve")).pk]: "x" } })).status).toBe(400);
  expect((await put(owner, { boxes: { [agents.billing!.id.pk]: "x".repeat(16_385) } })).status).toBe(413);
  const ok = await put(owner, { boxes: { [agents.billing!.id.pk]: "junk the agent will refuse" } });
  expect(await ok.json()).toEqual({ held: [agents.billing!.id.pk] });
  expect((await agents.billing!.ch.mySecrets()).map((x) => x.name)).toEqual(["STRIPE_KEY"]);
});

test("deleting a secret drops every copy, and a removed agent's copies go with it", async () => {
  const gone = agents.gone!;
  const db = await ownerCh.setSecret({ name: "DATABASE_URL", value: DB_URL, grants: [gone.id.pk, agents.billing!.id.pk] });
  expect((await gone.ch.mySecrets()).map((s) => s.name)).toEqual(["DATABASE_URL"]);
  await ownerCh.remove(gone.id.pk);
  const rows = () => {
    const sql = new Database(roomFile(), { readonly: true });
    try {
      return sql.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM secrets WHERE pk = ?").get(gone.id.pk)?.n;
    } finally {
      sql.close();
    }
  };
  expect(rows()).toBe(0);
  const after = (await ownerCh.secrets()).find((s) => s.id === db.id)!;
  expect(after.had).toContain(gone.id.pk);
  await ownerCh.deleteSecret(db.id);
  expect((await agents.billing!.ch.mySecrets()).map((s) => s.name)).toEqual(["STRIPE_KEY"]);
  expect((await ownerCh.secrets()).map((s) => s.name)).toEqual(["STRIPE_KEY"]);
});

test("the needles cover a value inside base64 at any alignment, JSON escapes, URL passwords and the long parts of a key file", () => {
  const value = 'p@ss"word\\with-quotes';
  const guard = new SecretGuard([{ name: "PW", value }]);
  expect(guard.leak(JSON.stringify({ body: value }))).toBe("PW");
  for (const pad of ["", "a", "ab"]) expect(guard.leak(btoa(`${pad}${value}tail`))).toBe("PW");
  expect(guard.leak("nothing to see")).toBeNull();
  expect(secretNeedles(DB_URL)).toContain("Wd8p2Lq7xNe3");
  const pem = `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\nAbCdEf123456\n-----END PRIVATE KEY-----\n`;
  const pemGuard = new SecretGuard([{ name: "SSH_KEY", value: pem }]);
  expect(pemGuard.leak("a line: MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7")).toBe("SSH_KEY");
  expect(pemGuard.leak("-----BEGIN PRIVATE KEY-----")).toBeNull();
  const json = JSON.stringify({ type: "service_account", client_email: "bot@proj.iam.gserviceaccount.com", private_key_id: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c" });
  const saGuard = new SecretGuard([{ name: "GCP_KEY", value: json }]);
  expect(saGuard.leak("id 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c")).toBe("GCP_KEY");
  expect(saGuard.leak('"type":"service_account" and bot@proj.iam.gserviceaccount.com')).toBeNull();
});
