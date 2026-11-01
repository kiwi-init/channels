import { beforeAll, describe, expect, test } from "bun:test";
import { certUntil, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, sign, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import {
  checkVault,
  newRecoveryPhrase,
  newerRecovery,
  openVault,
  phraseOf,
  readRecovery,
  readRecoveryPhrase,
  recoveryAfter,
  recoveryKey,
  recoveryLink,
  sealPerson,
  sealVault,
  type Recovery,
  type RecoveryLink,
  type Vault,
  type VaultContents,
} from "@kiwi/core/recovery.ts";

const T0 = Date.UTC(2026, 9, 29);
const DAY = 86_400_000;
const ids: Record<string, Identity> = {};
let links: DeviceLink[] = [];
let list: DeviceList;
let paper: Identity;
let other: Identity;

const fill = (b: number) => new Uint8Array(32).fill(b);

async function listOf(l: DeviceLink[]): Promise<DeviceList> {
  const read = await readDeviceList(l);
  if (!read.ok) throw new Error(read.why);
  return read.list;
}

const add = (who: string, as: "desktop" | "phone" | "computer", approve: boolean) => ({
  op: "add" as const,
  device: ids[who]!.pk,
  dxpk: ids[who]!.xpk!,
  label: who,
  os: "test",
  as,
  approve,
  until: certUntil(T0),
});

beforeAll(async () => {
  for (const name of ["person", "desk", "phone", "box", "thief", "stranger"]) ids[name] = await withExchangeKey(await generateIdentity(name));
  links = [await rootLink(ids.person!, { pk: ids.desk!.pk, xpk: ids.desk!.xpk!, label: "desk", os: "macOS", as: "desktop" }, T0)];
  for (const [who, as, approve] of [
    ["phone", "phone", false],
    ["box", "computer", false],
    ["thief", "desktop", true],
  ] as const)
    links = [...links, await nextLink(await listOf(links), ids.desk!, add(who, as, approve), T0)];
  list = await listOf(links);
  paper = await recoveryKey(fill(1));
  other = await recoveryKey(fill(2));
});

async function chain(...steps: [Identity, Identity, number][]): Promise<RecoveryLink[]> {
  const out: RecoveryLink[] = [];
  let r: Recovery | null = null;
  for (const [signer, key, at] of steps) {
    out.push(await recoveryLink(signer, list.person, r, { pk: key.pk, xpk: key.xpk! }, at));
    const read = await readRecovery(out, list, at);
    if (!read.ok) return out;
    r = read.recovery;
  }
  return out;
}

async function recovery(l: RecoveryLink[], now = T0, against = list): Promise<Recovery | string> {
  const read = await readRecovery(l, against, now);
  return read.ok ? read.recovery : read.why;
}

describe("the 24 words (T693)", () => {
  test("they are BIP39 English, so known vectors read back", async () => {
    expect((await phraseOf(fill(0))).join(" ")).toBe(`${"abandon ".repeat(23)}art`);
    expect((await phraseOf(fill(0x7f))).join(" ")).toBe(`${"legal winner thank year wave sausage worth useful ".repeat(3)}`.replace(/useful $/, "title"));
    expect((await phraseOf(fill(0xff))).join(" ")).toBe(`${"zoo ".repeat(23)}vote`);
  });

  test("a new phrase is 24 words and reads back to the same keys, typed however", async () => {
    const words = await newRecoveryPhrase();
    expect(words).toHaveLength(24);
    const read = await readRecoveryPhrase(words.map((w, i) => `${i + 1}. ${w.toUpperCase()}`).join("\n"));
    if (!read.ok) throw new Error(read.why);
    const short = await readRecoveryPhrase(words.map((w) => w.slice(0, 4)).join(" "));
    if (!short.ok) throw new Error(short.why);
    expect((await recoveryKey(read.entropy)).pk).toBe((await recoveryKey(short.entropy)).pk);
  });

  test("a wrong word, a swapped pair or a missing word is caught", async () => {
    const words = await phraseOf(fill(9));
    expect(await readRecoveryPhrase(words.slice(1).join(" "))).toMatchObject({ ok: false, why: expect.stringMatching(/24 words, and that's 23/) });
    expect(await readRecoveryPhrase([...words.slice(0, 5), "kiwix", ...words.slice(6)].join(" "))).toMatchObject({ ok: false, word: 5 });
    const swapped = [...words];
    [swapped[3], swapped[4]] = [swapped[4]!, swapped[3]!];
    expect(swapped).not.toEqual(words);
    expect(await readRecoveryPhrase(swapped.join(" "))).toMatchObject({ ok: false, why: expect.stringMatching(/don't add up/) });
  });

  test("the words always derive the same two keys, and different words different ones", async () => {
    const again = await recoveryKey(fill(1));
    expect([again.pk, again.xpk]).toEqual([paper.pk, paper.xpk]);
    expect(paper.pk).not.toBe(other.pk);
    expect(paper.xpk).not.toBe(other.xpk);
  });
});

describe("the recovery chain (T693)", () => {
  test("the person key sets it up; a device or a stranger can't", async () => {
    expect(await recovery(await chain([ids.person!, paper, T0]))).toMatchObject({ n: 1, rpk: paper.pk, pending: null });
    expect(await recovery([await recoveryLink(ids.desk!, list.person, null, { pk: paper.pk, xpk: paper.xpk! }, T0)])).toMatch(/person key sets up/);
  });

  test("the recovery key replaces itself at once; a key that isn't it can't", async () => {
    expect(await recovery(await chain([ids.person!, paper, T0], [paper, other, T0 + 1]))).toMatchObject({ n: 2, rpk: other.pk, pending: null });
    const first = await chain([ids.person!, paper, T0]);
    const r = (await recovery(first)) as Recovery;
    const forged = { ...(await recoveryLink(other, list.person, r, { pk: other.pk, xpk: other.xpk! }, T0 + 1)), after: null };
    expect(await recovery([...first, forged])).toMatch(/isn't signed/);
    const resigned = await recoveryLink(ids.stranger!, list.person, r, { pk: other.pk, xpk: other.xpk! }, T0 + 1);
    expect(await recovery([...first, resigned])).toMatch(/may not propose/);
  });

  test("an approving device proposes a new key that only takes over after 7 days", async () => {
    const l = await chain([ids.person!, paper, T0], [ids.desk!, other, T0 + DAY]);
    const waiting = (await recovery(l, T0 + 2 * DAY)) as Recovery;
    expect(waiting).toMatchObject({ rpk: paper.pk, pending: { rpk: other.pk, after: recoveryAfter(T0 + DAY), by: ids.desk!.pk } });
    expect(await recovery(l, recoveryAfter(T0 + DAY))).toMatchObject({ rpk: other.pk, pending: null });
    const early = await sign(ids.desk!, {
      kind: "kiwi-recovery" as const,
      v: 1 as const,
      person: list.person,
      n: 2,
      prev: l[1]!.prev,
      at: T0 + DAY,
      rpk: other.pk,
      rxpk: other.xpk!,
      after: T0 + 2 * DAY,
    });
    expect(await recovery([l[0]!, early])).toMatch(/waits 7 days/);
  });

  test("a phone without approval or a computer can't propose one", async () => {
    for (const who of ["phone", "box"]) expect(await recovery(await chain([ids.person!, paper, T0], [ids[who]!, other, T0 + DAY]))).toMatch(/may not propose/);
  });

  test("the old words cancel a thief's proposal inside the 7 days, and keep the key", async () => {
    const l = await chain([ids.person!, paper, T0], [ids.thief!, other, T0 + DAY], [paper, paper, T0 + 3 * DAY]);
    expect(await recovery(l, T0 + 30 * DAY)).toMatchObject({ n: 3, rpk: paper.pk, pending: null });
  });

  test("revoking the device that proposed it voids a pending key, even without the words", async () => {
    const l = await chain([ids.person!, paper, T0], [ids.thief!, other, T0 + DAY]);
    const cut = await listOf([...links, await nextLink(list, ids.desk!, { op: "revoke", device: ids.thief!.pk }, T0 + 2 * DAY)]);
    expect(await recovery(l, T0 + 30 * DAY, cut)).toMatchObject({ rpk: paper.pk, pending: null });
    const late = await listOf([...links, await nextLink(list, ids.desk!, { op: "revoke", device: ids.thief!.pk }, T0 + 9 * DAY)]);
    expect(await recovery(l, T0 + 30 * DAY, late)).toMatchObject({ rpk: other.pk });
  });

  test("a relay can't drop, reorder or backdate links, and a client keeps the longest chain it saw", async () => {
    const l = await chain([ids.person!, paper, T0], [paper, other, T0 + DAY], [other, paper, T0 + 2 * DAY]);
    expect(await recovery([l[0]!, l[2]!])).toMatch(/doesn't follow/);
    expect(await recovery([l[1]!, l[0]!])).toMatch(/person key sets up|doesn't follow/);
    const r1 = (await recovery(l.slice(0, 2))) as Recovery;
    const back = await recoveryLink(other, list.person, r1, { pk: paper.pk, xpk: paper.xpk! }, T0);
    expect(await recovery([...l.slice(0, 2), back])).toMatch(/dated before/);
    const full = (await recovery(l)) as Recovery;
    expect(newerRecovery(full, r1)).toBe(full);
  });
});

describe("the vault (T693)", () => {
  let r: Recovery;
  let contents: VaultContents;

  beforeAll(async () => {
    r = (await recovery(await chain([ids.person!, paper, T0]))) as Recovery;
    contents = { person: ids.person!, channels: [{ label: "kiwi", code: "kiwi://join/abc", owner: ids.stranger! }] };
  });

  test("a listed approving device seals it; only the 24 words open it", async () => {
    const v = await sealVault(ids.desk!, r, 1, contents, T0);
    expect(await checkVault(v, list)).toBeNull();
    expect(await openVault(v, paper)).toEqual(contents);
    expect(await openVault(v, other)).toBeNull();
    expect(await openVault(v, ids.desk!)).toBeNull();
  });

  test("a client refuses a version older than one it has seen (rollback)", async () => {
    const v1 = await sealVault(ids.desk!, r, 1, contents, T0);
    const v2 = await sealVault(ids.desk!, r, 2, { ...contents, channels: [] }, T0 + 1);
    expect(await checkVault(v2, list, 1)).toBeNull();
    expect(await checkVault(v1, list, 2)).toMatch(/older than version 2/);
  });

  test("a forged version is refused: bumped by the relay, signed by a stranger, a computer, a phone or a revoked device", async () => {
    const v1 = await sealVault(ids.desk!, r, 1, contents, T0);
    expect(await checkVault({ ...v1, version: 9 }, list)).toMatch(/isn't signed/);
    for (const who of ["stranger", "box", "phone"]) expect(await checkVault(await sealVault(ids[who]!, r, 2, contents, T0), list)).toMatch(/isn't one of this person's approving devices/);
    const cut = await listOf([...links, await nextLink(list, ids.desk!, { op: "revoke", device: ids.thief!.pk }, T0 + 1)]);
    expect(await checkVault(await sealVault(ids.thief!, r, 2, contents, T0 + 2), cut)).toMatch(/approving devices/);
  });

  test("a box moved to another version doesn't open, even re-signed by a listed device", async () => {
    const v1 = await sealVault(ids.desk!, r, 1, contents, T0);
    const v2 = await sealVault(ids.desk!, r, 2, { person: ids.person!, channels: [] }, T0 + 1);
    const moved: Vault = { ...v2, box: v1.box };
    expect(await openVault(moved, paper)).toBeNull();
  });

  test("the person key may seal it too, and a vault for another person is refused", async () => {
    expect(await checkVault(await sealVault(ids.person!, r, 1, contents, T0), list)).toBeNull();
    expect(await checkVault(await sealVault(ids.desk!, { ...r, person: ids.stranger!.pk }, 1, contents, T0), list)).toMatch(/another person/);
  });
});

describe("the person key sealed on its own (T899)", () => {
  let r: Recovery;
  let channels: VaultContents["channels"];

  beforeAll(async () => {
    r = (await recovery(await chain([ids.person!, paper, T0]))) as Recovery;
    channels = [{ label: "kiwi", code: "kiwi://join/abc", owner: ids.stranger! }];
  });

  test("a device that never held the person key reseals it, and the words open the vault to the whole key", async () => {
    const held = await sealPerson(r, ids.person!);
    expect(held.rxpk).toBe(r.rxpk);
    expect(held.box).not.toContain(ids.person!.sk);
    const v2 = await sealVault(ids.desk!, r, 2, { person: held, channels }, T0 + 1);
    expect(await checkVault(v2, list, 1)).toBeNull();
    expect(await openVault(v2, paper)).toEqual({ person: ids.person!, channels });
    expect(await openVault(v2, other)).toBeNull();
    expect(await openVault(v2, ids.desk!)).toBeNull();
  });

  test("only the person key this chain is for is sealed, and only to the chain's own recovery key", async () => {
    await expect(sealPerson(r, ids.stranger!)).rejects.toThrow("isn't the one this recovery key is for");
    const held = await sealPerson(r, ids.person!);
    await expect(sealVault(ids.desk!, { ...r, rxpk: other.xpk! }, 2, { person: held, channels }, T0)).rejects.toThrow("earlier recovery key");
    const moved = await sealVault(ids.desk!, { ...r, rxpk: other.xpk! }, 2, { person: { ...held, rxpk: other.xpk! }, channels }, T0);
    expect(await openVault(moved, other)).toBeNull();
  });

  test("a person box lifted into another person's vault, or under another recovery key, doesn't open", async () => {
    const held = await sealPerson(r, ids.person!);
    const theirs = { ...r, person: ids.stranger!.pk };
    expect(await openVault(await sealVault(ids.desk!, theirs, 1, { person: held, channels }, T0), paper)).toBeNull();
    const forgedInner = await sealVault(ids.desk!, r, 1, { person: { rxpk: r.rxpk, box: "not.a.box" }, channels }, T0);
    expect(await openVault(forgedInner, paper)).toBeNull();
  });
});
