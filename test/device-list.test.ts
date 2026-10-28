import { beforeAll, describe, expect, test } from "bun:test";
import { certUntil, currentDevice, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";

const T0 = Date.UTC(2026, 9, 28);
const ids: Record<string, Identity> = {};

beforeAll(async () => {
  for (const name of ["person", "desk", "phone", "box", "laptop", "thief"]) ids[name] = await withExchangeKey(await generateIdentity(name));
});

const add = (who: string, as: "desktop" | "phone" | "computer", approve = false) => ({
  op: "add" as const,
  device: ids[who]!.pk,
  dxpk: ids[who]!.xpk!,
  label: who,
  os: "test",
  as,
  approve,
  until: certUntil(T0),
});

async function grow(links: DeviceLink[], signer: string, body: Parameters<typeof nextLink>[2], at = T0): Promise<DeviceLink[]> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await nextLink(read.list, ids[signer]!, body, at)];
}

async function list(links: DeviceLink[]): Promise<DeviceList> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return read.list;
}

const why = async (links: DeviceLink[]) => {
  const read = await readDeviceList(links);
  return read.ok ? null : read.why;
};

describe("a person's device list (T634)", () => {
  test("the person key adds the first device; a desktop adds the rest, and a phone approves only once a desktop lets it", async () => {
    let links = [await rootLink(ids.person!, { pk: ids.desk!.pk, xpk: ids.desk!.xpk!, label: "desk", os: "macOS", as: "desktop" }, T0)];
    links = await grow(links, "desk", add("phone", "phone"));
    links = await grow(links, "desk", add("box", "computer"));
    expect(await why([...links, await nextLink(await list(links), ids.phone!, add("laptop", "desktop"), T0)])).toMatch(/may not change this person's devices/);
    links = await grow(links, "desk", { op: "approve", device: ids.phone!.pk });
    links = await grow(links, "phone", add("laptop", "desktop"));
    const got = await list(links);
    expect(got.version).toBe(5);
    expect(got.devices.map((d) => [d.label, d.as, d.approve])).toEqual([
      ["desk", "desktop", true],
      ["phone", "phone", true],
      ["box", "computer", false],
      ["laptop", "desktop", false],
    ]);
  });

  test("a computer never signs the list, and is never given approval", async () => {
    let links = [await rootLink(ids.person!, { pk: ids.desk!.pk, xpk: ids.desk!.xpk!, label: "desk", os: "macOS", as: "desktop" }, T0)];
    links = await grow(links, "desk", add("box", "computer"));
    expect(await why([...links, await nextLink(await list(links), ids.box!, add("laptop", "desktop"), T0)])).toMatch(/may not change/);
    expect(await why([...links, await nextLink(await list(links), ids.desk!, { op: "approve", device: ids.box!.pk }, T0)])).toMatch(/never approves/);
    expect(await why([...links, await nextLink(await list(links), ids.desk!, add("phone", "phone", true), T0)])).toMatch(/only a desktop is added able to approve/);
  });

  test("a revoked device signs nothing more, and its key can't come back", async () => {
    let links = [await rootLink(ids.person!, { pk: ids.desk!.pk, xpk: ids.desk!.xpk!, label: "desk", os: "macOS", as: "desktop" }, T0)];
    links = await grow(links, "desk", add("laptop", "desktop", true));
    links = await grow(links, "desk", { op: "revoke", device: ids.laptop!.pk });
    expect((await list(links)).revoked).toEqual([ids.laptop!.pk]);
    expect(await why([...links, await nextLink(await list(links), ids.laptop!, add("phone", "phone"), T0)])).toMatch(/may not change/);
    expect(await why([...links, await nextLink(await list(links), ids.desk!, add("laptop", "desktop"), T0)])).toMatch(/already listed, or was revoked/);
  });

  test("the relay can't drop, reorder or edit a link, or slip in a stranger's", async () => {
    let links = [await rootLink(ids.person!, { pk: ids.desk!.pk, xpk: ids.desk!.xpk!, label: "desk", os: "macOS", as: "desktop" }, T0)];
    links = await grow(links, "desk", add("phone", "phone"));
    links = await grow(links, "desk", add("box", "computer"));
    expect(await why([links[0]!, links[2]!])).toMatch(/doesn't follow/);
    expect(await why([links[0]!, { ...links[1]!, label: "evil" } as DeviceLink])).toMatch(/isn't signed/);
    expect(await why([...links, await nextLink(await list(links), ids.thief!, add("thief", "desktop"), T0)])).toMatch(/may not change/);
    expect(await why([{ ...links[0]!, extra: 1 } as unknown as DeviceLink])).toMatch(/fields it shouldn't have/);
    expect(await why([links[1]!])).toMatch(/starts with the person adding a first device/);
  });

  test("a cert runs 90 days; a renewal extends it, and the person key can always act", async () => {
    let links = [await rootLink(ids.person!, { pk: ids.desk!.pk, xpk: ids.desk!.xpk!, label: "desk", os: "macOS", as: "desktop" }, T0)];
    links = await grow(links, "desk", add("phone", "phone"));
    const later = certUntil(T0) + 1;
    expect(currentDevice(await list(links), ids.phone!.pk, later)).toBeNull();
    links = await grow(links, "desk", { op: "renew", device: ids.phone!.pk, until: certUntil(T0 + 30 * 86_400_000) }, T0 + 30 * 86_400_000);
    expect(currentDevice(await list(links), ids.phone!.pk, later)?.label).toBe("phone");
    links = await grow(links, "person", { op: "revoke", device: ids.desk!.pk });
    expect((await list(links)).devices.map((d) => d.label)).toEqual(["phone"]);
  });
});
