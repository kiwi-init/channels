import type { Computer, Tended } from "@kiwi/core/client/delegations.ts";
import type { DeviceList } from "@kiwi/core/devices.ts";

const HOUR_MS = 3_600_000;

export interface DelegatesApi {
  tendDelegations: (computers: readonly Computer[], person: string) => Promise<Tended>;
}

export function ownComputers(person: string, stored: readonly { machinePk: string; machineXpk: string; personPk: string }[], list: DeviceList | undefined, now = Date.now()): Computer[] {
  const out = new Map<string, Computer>();
  for (const c of stored) if (c.personPk === person) out.set(c.machinePk, { pk: c.machinePk, xpk: c.machineXpk });
  for (const d of list?.devices ?? []) if (d.as === "computer" && d.until > now) out.set(d.device, { pk: d.device, xpk: d.dxpk });
  return [...out.values()].sort((a, b) => a.pk.localeCompare(b.pk));
}

const last = new Map<string, { key: string; at: number }>();

export async function tendDelegates(code: string, person: string, computers: readonly Computer[], api: DelegatesApi, now = Date.now()): Promise<Tended | null> {
  const key = `${person}|${computers.map((c) => `${c.pk}:${c.xpk}`).join(",")}`;
  const was = last.get(code);
  if (was && was.key === key && now - was.at < HOUR_MS) return null;
  const tended = await api.tendDelegations(computers, person);
  last.set(code, { key, at: now });
  return tended;
}
