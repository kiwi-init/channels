import type { ComputerSettings } from "@kiwi/core/computer-settings.ts";
import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import type { ComputerView, FromMachine, MachineView } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import { daemonHarnesses, daemonHello } from "../daemon-client.ts";
import { machineOnline, settingsOn, type Asker } from "../remote.ts";
import { personSigner, store } from "../store.ts";

const MACHINE_PK = /^[A-Za-z0-9_-]{20,128}$/;

const asker = (): Asker => ({ ...personSigner(), relay: store.relayUrl });

function paired(machinePk: unknown): ComputerView | null {
  if (typeof machinePk !== "string" || !MACHINE_PK.test(machinePk)) return null;
  return store.computers.find((c) => c.machinePk === machinePk && !c.own) ?? null;
}

async function machines(): Promise<MachineView[]> {
  const here = await daemonHello().catch(() => null);
  return Promise.all(
    store.computers.map(async (c): Promise<MachineView> => ({
      machinePk: c.machinePk,
      label: c.label,
      os: c.os,
      own: !!c.own,
      online: c.own ? here !== null : await machineOnline(asker(), c.machinePk),
    })),
  );
}

export function machineCalls(): Serves<"harnesses" | "machines" | "settingsOn"> {
  return {
    harnesses: (): Promise<HarnessRow[]> => daemonHarnesses().catch(() => []),
    machines: (): Promise<MachineView[]> => machines().catch(() => []),
    settingsOn: async (machinePk: unknown): Promise<FromMachine<ComputerSettings>> => {
      const c = paired(machinePk);
      if (!c) return { ok: false, detail: "that isn't one of your computers" };
      return settingsOn(asker(), { pk: c.machinePk, xpk: c.machineXpk });
    },
  };
}
