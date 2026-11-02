import { describe, expect, test } from "bun:test";
import type { Computer } from "@kiwi/core/client/delegations.ts";
import type { Device, DeviceList } from "@kiwi/core/devices.ts";

import { ownComputers, tendDelegates, type DelegatesApi } from "./delegations";

const NOW = 1_800_000_000_000;
const k = (c: string) => c.repeat(43);

function device(pk: string, as: Device["as"], until = NOW + 1): Device {
  return { device: pk, dxpk: `x${pk.slice(1)}`, label: pk.slice(0, 4), os: "mac", as, approve: true, until, seq: 1 };
}

function list(devices: Device[]): DeviceList {
  return { person: k("p"), root: k("p"), reroots: [], version: 1, head: "h", devices, revoked: [], revokes: [] };
}

describe("ownComputers", () => {
  test("this person's stored computers and current listed computers, once each", () => {
    const stored = [
      { machinePk: k("a"), machineXpk: k("b"), personPk: k("p") },
      { machinePk: k("c"), machineXpk: k("d"), personPk: k("q") },
    ];
    const l = list([device(k("a"), "computer"), device(k("e"), "computer"), device(k("f"), "desktop"), device(k("g"), "computer", NOW)]);
    expect(ownComputers(k("p"), stored, l, NOW).map((c) => c.pk)).toEqual([k("a"), k("e")]);
    expect(ownComputers(k("p"), stored, undefined, NOW)).toEqual([{ pk: k("a"), xpk: k("b") }]);
  });
});

describe("tendDelegates", () => {
  test("runs on first sight, again when the computers change or after an hour, and not in between", async () => {
    const calls: Computer[][] = [];
    const api: DelegatesApi = {
      tendDelegations: async (computers) => {
        calls.push([...computers]);
        return { issued: [], dropped: [], adopted: [] };
      },
    };
    const one = [{ pk: k("a"), xpk: k("b") }];
    expect(await tendDelegates("code-1", k("p"), one, api, NOW)).not.toBeNull();
    expect(await tendDelegates("code-1", k("p"), one, api, NOW + 60_000)).toBeNull();
    expect(await tendDelegates("code-1", k("p"), [], api, NOW + 120_000)).not.toBeNull();
    expect(await tendDelegates("code-1", k("p"), [], api, NOW + 3_720_000)).not.toBeNull();
    expect(await tendDelegates("code-2", k("p"), one, api, NOW + 60_000)).not.toBeNull();
    expect(calls.length).toBe(4);
  });

  test("a failed pass is tried again on the next one", async () => {
    let fail = true;
    const api: DelegatesApi = {
      tendDelegations: async () => {
        if (fail) throw new Error("relay down");
        return { issued: [], dropped: [], adopted: [] };
      },
    };
    await expect(tendDelegates("code-3", k("p"), [], api, NOW)).rejects.toThrow("relay down");
    fail = false;
    expect(await tendDelegates("code-3", k("p"), [], api, NOW + 1_000)).not.toBeNull();
  });
});
