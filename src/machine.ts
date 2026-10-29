// This computer's key (machine.json). `kiwi pair` adds its person's cert (src/daemon/pair.ts) and
// `kiwi login` its person's device list (src/login.ts); agents started here then carry a computer
// or device claim in their join requests (computerClaimFor).

import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { home, writePrivate } from "./config.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { claimDevice, readDeviceList, type DeviceClaim, type DeviceLink } from "@kiwi/core/devices.ts";
import { claimComputer, type ComputerClaim, type MachineCert } from "@kiwi/core/person.ts";

export interface EnrolledDevice {
  person: { pk: string; name: string; xpk: string };
  links: DeviceLink[];
}

export interface MachineFile {
  identity: Identity;
  label: string;
  relay: string;
  device?: EnrolledDevice;
}

const path = () => join(home(), "machine.json");
const backup = () => `${path()}.bak`;

function readMachine(file: string): MachineFile | null {
  try {
    const m = JSON.parse(readFileSync(file, "utf8")) as Partial<MachineFile>;
    return m && typeof m === "object" && m.identity && typeof m.identity.pk === "string" && typeof m.identity.sk === "string" ? (m as MachineFile) : null;
  } catch {
    return null;
  }
}

export function loadMachine(): MachineFile | null {
  const main = existsSync(path());
  const kept = main ? readMachine(path()) : null;
  if (kept) return kept;
  const saved = existsSync(backup()) ? readMachine(backup()) : null;
  if (saved) {
    writePrivate(path(), JSON.stringify(saved, null, 2) + "\n");
    return saved;
  }
  if (main) throw new Error(`${path()} is unreadable and there is no backup of it: move it aside to make this computer a new key, and pair it again`);
  return null;
}

export function saveMachine(m: MachineFile): void {
  const text = JSON.stringify(m, null, 2) + "\n";
  writePrivate(path(), text);
  writePrivate(backup(), text);
}

/** A fresh machine key, labelled after this computer. */
export async function newMachine(relay: string): Promise<MachineFile> {
  const label = (hostname().replace(/\.local$/, "") || "This computer").slice(0, 60);
  return { identity: await generateIdentity("machine"), label, relay };
}

/**
 * The claims an agent's join request carries from this computer: the computer claim when it is
 * paired with its person's app (kiwi pair), the device claim when it is one of their devices
 * (kiwi login). Undefined when it is neither.
 */
export async function computerClaimFor(roomId: string, agentPk: string): Promise<{ computer?: ComputerClaim; device?: DeviceClaim } | undefined> {
  const m = loadMachine() as (MachineFile & { cert?: MachineCert }) | null;
  if (!m) return undefined;
  const computer = m.cert && m.cert.machine === m.identity.pk ? await claimComputer(m.identity, m.cert, roomId, agentPk) : undefined;
  const device = m.device?.links.length ? await claimDevice(m.identity, m.device.links, roomId, agentPk) : undefined;
  return computer || device ? { ...(computer ? { computer } : {}), ...(device ? { device } : {}) } : undefined;
}

let taking: Promise<unknown> = Promise.resolve();

export function takeDeviceList(links: unknown): Promise<"longer" | "revoked" | null> {
  const run = taking.then(() => takeNow(links));
  taking = run.catch(() => null);
  return run;
}

async function takeNow(links: unknown): Promise<"longer" | "revoked" | null> {
  if (!Array.isArray(links)) return null;
  const m = loadMachine();
  if (!m?.device) return null;
  const read = await readDeviceList(links);
  if (!read.ok || read.list.person !== m.device.person.pk) return null;
  const kept = await readDeviceList(m.device.links);
  if (kept.ok && read.list.version <= kept.list.version) return null;
  if (read.list.revoked.includes(m.identity.pk)) {
    const next: MachineFile = { ...m };
    delete next.device;
    saveMachine(next);
    return "revoked";
  }
  saveMachine({ ...m, device: { ...m.device, links: links as DeviceLink[] } });
  return "longer";
}
