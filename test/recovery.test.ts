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

  test("a channel box moved to another desktop's name, or into another person's vault, doesn't open", async () => {
    const v1 = await sealVault(ids.desk!, r, 1, contents, T0);
    const moved: Vault = { ...v1, boxes: [{ ...v1.boxes[0]!, device: ids.thief!.pk }] };
    expect(await openVault(moved, paper)).toEqual({ person: ids.person!, channels: [] });
    const theirs = await sealVault(ids.desk!, { ...r, person: ids.stranger!.pk }, 1, { ...contents, person: await sealPerson(r, ids.person!) }, T0);
    expect(await openVault({ ...v1, boxes: theirs.boxes }, paper)).toEqual({ person: ids.person!, channels: [] });
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
    const forgedInner = await sealVault(ids.desk!, r, 1, { person: { rxpk: r.rxpk, pk: ids.person!.pk, box: "not.a.box" }, channels }, T0);
    expect(await openVault(forgedInner, paper)).toBeNull();
  });
});

describe("each approving desktop seals its own channels (T969)", () => {
  let r: Recovery;
  const ch = (label: string) => ({ label, code: `kiwi://join/${label}`, owner: ids[label]! });
  const resign = (v: Vault, change: Record<string, unknown>) => sign(ids.desk!, { ...v, ...change, pk: undefined, sig: undefined });

  beforeAll(async () => {
    r = (await recovery(await chain([ids.person!, paper, T0]))) as Recovery;
    for (const name of ["work", "home", "side"]) ids[name] = await withExchangeKey(await generateIdentity(name));
  });

  test("the person box sits in the signed vault, so another desktop carries it, and each desktop's box rides along unread", async () => {
    const v1 = await sealVault(ids.person!, r, 1, { person: ids.person!, channels: [ch("work")], device: ids.desk!.pk }, T0);
    expect(v1.held.pk).toBe(ids.person!.pk);
    expect(JSON.stringify(v1)).not.toContain(ids.person!.sk);
    expect(JSON.stringify(v1)).not.toContain(ids.work!.sk);
    const v2 = await sealVault(ids.thief!, r, 2, { person: v1.held, channels: [ch("home")], others: v1.boxes }, T0 + 1);
    expect(await checkVault(v2, list, 1)).toBeNull();
    expect(v2.held).toEqual(v1.held);
    expect(v2.boxes[0]).toEqual(v1.boxes[0]);
    expect(v2.boxes.map((b) => b.device)).toEqual([ids.desk!.pk, ids.thief!.pk]);
    const v3 = await sealVault(ids.desk!, r, 3, { person: v2.held, channels: [ch("work"), ch("side")], others: v2.boxes }, T0 + 2);
    expect(v3.boxes.map((b) => b.device)).toEqual([ids.thief!.pk, ids.desk!.pk]);
    const inside = await openVault(v3, paper);
    expect(inside?.person).toEqual(ids.person!);
    expect(inside?.channels.map((c) => c.label).sort()).toEqual(["home", "side", "work"]);
    expect(await openVault(v3, other)).toBeNull();
    expect(await openVault(v3, ids.desk!)).toBeNull();
  });

  test("a channel box that doesn't open is skipped, and the rest still restore", async () => {
    const v1 = await sealVault(ids.desk!, r, 1, { person: ids.person!, channels: [ch("work")] }, T0);
    const junk = { device: ids.thief!.pk, rxpk: r.rxpk, box: "not.a.box" };
    const v2 = await sealVault(ids.desk!, r, 2, { person: v1.held, channels: [ch("work")], others: [junk] }, T0 + 1);
    expect((await openVault(v2, paper))?.channels.map((c) => c.label)).toEqual(["work"]);
  });

  test("boxes sealed to earlier words are dropped when the vault is sealed to new ones", async () => {
    const v1 = await sealVault(ids.thief!, r, 1, { person: ids.person!, channels: [ch("home")] }, T0);
    const r2 = (await recovery(await chain([ids.person!, paper, T0], [ids.person!, other, T0 + 1]))) as Recovery;
    const v2 = await sealVault(ids.person!, r2, 2, { person: ids.person!, channels: [ch("work")], device: ids.desk!.pk, others: v1.boxes }, T0 + 2);
    expect(v2.boxes.map((b) => b.device)).toEqual([ids.desk!.pk]);
    expect((await openVault(v2, other))?.channels.map((c) => c.label)).toEqual(["work"]);
  });

  test("a person box opens only for the key it was sealed for, whatever its label says", async () => {
    const v1 = await sealVault(ids.desk!, r, 1, { person: ids.person!, channels: [] }, T0);
    expect(await openVault(v1, paper, ids.thief!.pk)).toBeNull();
    expect(await openVault({ ...v1, held: { ...v1.held, pk: ids.thief!.pk } }, paper, ids.thief!.pk)).toBeNull();
    expect(await openVault({ ...v1, held: { ...v1.held, rxpk: other.xpk! } }, other)).toBeNull();
  });

  test("a vault with a malformed person box or channel boxes is refused, even signed by a listed desktop", async () => {
    const v1 = await sealVault(ids.desk!, r, 1, { person: ids.person!, channels: [ch("work")] }, T0);
    const box = v1.boxes[0]!;
    for (const change of [
      { held: { ...v1.held, extra: "x" } },
      { held: { rxpk: v1.held.rxpk, box: v1.held.box } },
      { held: { ...v1.held, pk: "short" } },
      { boxes: [box, box] },
      { boxes: [{ ...box, device: "short" }] },
      { boxes: [{ ...box, extra: "x" }] },
      { boxes: "nope" },
      { boxes: Array.from({ length: 65 }, (_, i) => ({ ...box, device: (i.toString(36) + "A".repeat(43)).slice(0, 43) })) },
    ])
      expect(await checkVault(await resign(v1, change), list)).toMatch(/bad person box|bad channel boxes/);
    expect(await checkVault(await resign(v1, { boxes: [{ ...box, box: "x".repeat(600 * 1024) }] }), list)).toMatch(/too large/);
    expect(await checkVault({ ...v1, boxes: [] }, list)).toMatch(/isn't signed/);
  });

  test("a vault that would grow past the relay's limit isn't sealed", async () => {
    const big = Array.from({ length: 64 }, (_, i) => ({ device: (i.toString(36) + "B".repeat(43)).slice(0, 43), rxpk: r.rxpk, box: "x" }));
    await expect(sealVault(ids.desk!, r, 1, { person: ids.person!, channels: [], others: big }, T0)).rejects.toThrow("past what the relay keeps");
  });
});
