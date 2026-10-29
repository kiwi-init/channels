import { beforeAll, describe, expect, test } from "bun:test";
import { certUntil, checkDevice, claimDevice, newestLists, nextLink, readDeviceList, rerootLink, rootLink, speaksForPerson, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, sign, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { makeAsk, readAsk } from "@kiwi/core/machine-ask.ts";
import { checkVault, openVault, readRecovery, recoveryKey, recoveryLink, sealPerson, sealVault, type Recovery, type RecoveryLink } from "@kiwi/core/recovery.ts";

const T0 = Date.UTC(2026, 9, 29);
const ids: Record<string, Identity> = {};
let links: DeviceLink[] = [];
let list: DeviceList;
let chain: RecoveryLink[] = [];
let paper: Identity;

async function listOf(l: readonly unknown[]): Promise<DeviceList> {
  const read = await readDeviceList(l);
  if (!read.ok) throw new Error(read.why);
  return read.list;
}

async function recoveryOf(c: readonly unknown[], l: DeviceList, now = T0 + 1000): Promise<Recovery> {
  const read = await readRecovery(c, l, now);
  if (!read.ok) throw new Error(read.why);
  return read.recovery;
}

const why = async (l: readonly unknown[]): Promise<string> => {
  const read = await readDeviceList(l);
  return read.ok ? "" : read.why;
};

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

const rerooted = async (keep: string[], opts: { by?: Identity; root?: Identity; on?: RecoveryLink[]; at?: number } = {}): Promise<DeviceLink[]> => [
  ...links,
  await rerootLink(list, opts.by ?? paper, opts.on ?? chain, opts.root ?? ids.next!, keep, opts.at ?? T0 + 1000),
];

beforeAll(async () => {
  for (const name of ["person", "desk", "phone", "box", "thief", "next", "stranger"]) ids[name] = await withExchangeKey(await generateIdentity(name));
  links = [await rootLink(ids.person!, { pk: ids.desk!.pk, xpk: ids.desk!.xpk!, label: "desk", os: "macOS", as: "desktop" }, T0)];
  for (const [who, as, approve] of [
    ["phone", "phone", false],
    ["box", "computer", false],
    ["thief", "desktop", true],
  ] as const)
    links = [...links, await nextLink(await listOf(links), ids.desk!, add(who, as, approve), T0)];
  list = await listOf(links);
  paper = await recoveryKey(new Uint8Array(32).fill(3));
  chain = [await recoveryLink(ids.person!, ids.person!.pk, null, { pk: paper.pk, xpk: paper.xpk! }, T0)];
});

describe("a re-root to a new person key (T827)", () => {
  test("the recovery key and a new person key re-root the list; what isn't kept is revoked, and the person stays who they were", async () => {
    const after = await listOf(await rerooted([ids.desk!.pk, ids.box!.pk]));
    expect(after.person).toBe(ids.person!.pk);
    expect(after.root).toBe(ids.next!.pk);
    expect(after.reroots).toEqual([expect.objectContaining({ seq: 5, from: ids.person!.pk, root: ids.next!.pk, n: 1 })]);
    expect(after.devices.map((d) => d.device).sort()).toEqual([ids.desk!.pk, ids.box!.pk].sort());
    expect(after.revoked.sort()).toEqual([ids.phone!.pk, ids.thief!.pk].sort());
    expect(after.revokes.every((r) => r.by === ids.next!.pk && r.seq === 5)).toBe(true);
    expect(speaksForPerson(after, ids.next!.pk, T0 + 2000)).toBe(true);
    expect(speaksForPerson(after, ids.person!.pk, T0 + 2000)).toBe(false);
    expect(speaksForPerson(after, ids.desk!.pk, T0 + 2000)).toBe(true);
  });

  test("the old person key signs nothing after it, and the new one signs like a person key", async () => {
    const r = await rerooted([ids.desk!.pk]);
    const after = await listOf(r);
    expect(await why([...r, await nextLink(after, ids.person!, add("stranger", "desktop", true), T0 + 2000)])).toContain("may not change this person's devices");
    expect(await why([...r, await nextLink(after, ids.thief!, add("stranger", "desktop", true), T0 + 2000)])).toContain("may not change this person's devices");
    const grown = await listOf([...r, await nextLink(after, ids.next!, add("stranger", "phone", true), T0 + 2000)]);
    expect(grown.devices.find((d) => d.device === ids.stranger!.pk)?.approve).toBe(true);
    expect(await why([...r, await nextLink(after, ids.next!, { ...add("stranger", "desktop", false), device: ids.next!.pk }, T0 + 2000)])).toContain("person key is never a device");
  });

  test("a re-root without the recovery key is refused: the wrong words, a stranger's, or the thief's own key twice", async () => {
    expect(await why(await rerooted([ids.desk!.pk], { by: await recoveryKey(new Uint8Array(32).fill(4)) }))).toContain("not signed by the recovery key");
    expect(await why(await rerooted([ids.desk!.pk], { by: ids.thief! }))).toContain("not signed by the recovery key");
    expect(await why(await rerooted([ids.desk!.pk], { by: ids.next! }))).toContain("not signed by the recovery key");
    const real = await rerootLink(list, paper, chain, ids.next!, [ids.desk!.pk], T0 + 1000);
    expect(await why([...links, { ...real, keep: [ids.desk!.pk, ids.thief!.pk].sort() }])).toContain("isn't signed by the key it names");
    const resigned = await sign(ids.stranger!, { ...real, root: ids.stranger!.pk, pk: undefined, sig: undefined });
    expect(await why([...links, resigned])).toContain("not signed by the recovery key");
  });

  test("a re-root names a fresh key, keeps only listed devices, and carries a recovery chain that holds up", async () => {
    expect(await why(await rerooted([ids.desk!.pk], { root: ids.thief! }))).toContain("already used");
    expect(await why(await rerooted([ids.desk!.pk], { root: ids.person! }))).toContain("already used");
    expect(await why(await rerooted([ids.stranger!.pk]))).toContain("isn't listed");
    expect(await why(await rerooted([ids.desk!.pk], { on: [] }))).toContain("recovery chain doesn't hold up");
    const forged = await recoveryLink(ids.thief!, ids.person!.pk, null, { pk: paper.pk, xpk: paper.xpk! }, T0);
    expect(await why(await rerooted([ids.desk!.pk], { on: [forged] }))).toContain("recovery chain doesn't hold up");
  });

  test("a second re-root needs the chain the first was signed against, and the old key can't come back", async () => {
    const first = await rerooted([ids.desk!.pk]);
    const after = await listOf(first);
    const paper2 = await recoveryKey(new Uint8Array(32).fill(5));
    const next2 = await withExchangeKey(await generateIdentity("next2"));
    const grown = [...chain, await recoveryLink(paper, ids.person!.pk, await recoveryOf(chain, after, T0 + 1500), { pk: paper2.pk, xpk: paper2.xpk! }, T0 + 1500)];
    expect((await listOf([...first, await rerootLink(after, paper2, grown, next2, [ids.desk!.pk], T0 + 2000)])).root).toBe(next2.pk);
    expect(await why([...first, await rerootLink(after, paper, [], next2, [ids.desk!.pk], T0 + 2000)])).toContain("recovery chain doesn't hold up");
    const other = await recoveryLink(ids.person!, ids.person!.pk, null, { pk: paper2.pk, xpk: paper2.xpk! }, T0);
    expect(await why([...first, await rerootLink(after, paper2, [other], next2, [ids.desk!.pk], T0 + 2000)])).toContain("isn't the one the re-root at link 5 was signed against");
    expect(await why([...first, await rerootLink(after, paper, chain, ids.person!, [ids.desk!.pk], T0 + 2000)])).toContain("already used");
  });

  test("a fork the old key grows longer loses to the re-rooted list, everywhere a list is chosen", async () => {
    const r = await rerooted([ids.desk!.pk]);
    let fork = links;
    for (let i = 0; i < 5; i++) {
      const extra = await withExchangeKey(await generateIdentity(`extra${i}`));
      fork = [
        ...fork,
        await nextLink(await listOf(fork), ids.person!, { op: "add", device: extra.pk, dxpk: extra.xpk!, label: "x", os: "x", as: "desktop", approve: true, until: certUntil(T0) }, T0 + 2000),
      ];
    }
    expect((await listOf(fork)).version).toBeGreaterThan((await listOf(r)).version);
    for (const order of [
      [fork, r],
      [r, fork],
    ])
      expect((await newestLists(order)).get(ids.person!.pk)?.root).toBe(ids.next!.pk);
    const member = await generateIdentity("member");
    const claim = await claimDevice(ids.thief!, fork, "room", member.pk);
    expect(await checkDevice(claim, "room", member.pk, undefined, T0 + 3000)).not.toBeNull();
    const known = await listOf(r);
    expect(await checkDevice(claim, "room", member.pk, () => known, T0 + 3000)).toBeNull();
  });

  test("the recovery chain and the vault follow the new person key, not the old one", async () => {
    const after = await listOf(await rerooted([ids.desk!.pk]));
    const paper2 = await recoveryKey(new Uint8Array(32).fill(6));
    const before = await recoveryOf(chain, after);
    expect(before.root).toBe(ids.next!.pk);
    const byOld = [...chain, await recoveryLink(ids.person!, ids.person!.pk, before, { pk: paper2.pk, xpk: paper2.xpk! }, T0 + 2000)];
    expect(byOld[1]!.after).not.toBeNull();
    expect((await readRecovery(byOld, after, T0 + 3000)).ok).toBe(false);
    const byNew = [...chain, await recoveryLink(ids.next!, ids.person!.pk, before, { pk: paper2.pk, xpk: paper2.xpk! }, T0 + 2000)];
    expect((await recoveryOf(byNew, after, T0 + 3000)).rpk).toBe(paper2.pk);
    const backdated = [...chain, await sign(ids.next!, { ...byNew[1]!, at: T0 + 500, pk: undefined, sig: undefined })];
    expect((await readRecovery(backdated, after, T0 + 3000)) as { why?: string }).toMatchObject({ why: expect.stringContaining("before the re-root") });

    await expect(sealPerson(before, ids.person!)).rejects.toThrow("isn't the one");
    await expect(sealVault(ids.desk!, before, 2, { person: ids.person!, channels: [] }, T0 + 2000)).rejects.toThrow("replaced by a re-root");
    const stale = { rxpk: before.rxpk, box: "x" };
    await expect(sealVault(ids.desk!, before, 2, { person: stale, channels: [] }, T0 + 2000)).rejects.toThrow("replaced by a re-root");
    const sealed = await sealPerson(before, ids.next!);
    const vault = await sealVault(ids.desk!, before, 2, { person: sealed, channels: [] }, T0 + 2000);
    expect(await checkVault(vault, after)).toBeNull();
    expect((await openVault(vault, paper, after.root))?.person.pk).toBe(ids.next!.pk);
    expect(await openVault(vault, paper)).toBeNull();
    expect(await checkVault(await sealVault(ids.next!, before, 2, { person: ids.next!, channels: [] }, T0 + 2000), after)).toBeNull();
    const oldSigned = await sign(ids.person!, { ...vault, pk: undefined, sig: undefined });
    expect(await checkVault(oldSigned, after)).toContain("isn't one of this person's approving devices");
  });

  test("a computer takes asks from the new person key, and no longer from the old one", async () => {
    const after = await listOf(await rerooted([ids.desk!.pk, ids.box!.pk]));
    const seen = new Set<string>();
    const claim = (id: string) => !seen.has(id) && !!seen.add(id);
    for (const [signer, ok] of [
      [ids.person!, false],
      [ids.next!, true],
      [ids.desk!, true],
    ] as const) {
      const { box } = await makeAsk(signer, { pk: ids.box!.pk, xpk: ids.box!.xpk! }, { verb: "harnesses", args: {}, reply: "r".repeat(43) });
      const read = await readAsk(ids.box!, box, { person: ids.person!.pk, list: after, now: Date.now(), claim });
      expect(read.ok).toBe(ok);
    }
  });
});
