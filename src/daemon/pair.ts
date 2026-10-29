import { withExchangeKey } from "@kiwi/core/identity.ts";
import { loadMachine, newMachine, saveMachine, type MachineFile } from "../machine.ts";
import type { MachineCert } from "@kiwi/core/person.ts";

export interface PairedPerson {
  pk: string;
  xpk: string;
  name: string;
}

export interface PairedMachine extends MachineFile {
  cert?: MachineCert;
  person?: PairedPerson;
}

export function loadPairedMachine(): PairedMachine | null {
  return loadMachine() as PairedMachine | null;
}

export async function ensureMachine(relay: string): Promise<PairedMachine> {
  let m = loadPairedMachine();
  if (!m) {
    m = (await newMachine(relay)) as PairedMachine;
    saveMachine(m);
    return m;
  }
  if (!m.identity.xpk) {
    m = { ...m, identity: await withExchangeKey(m.identity) };
    saveMachine(m);
  }
  if (!m.cert && m.relay !== relay) {
    m = { ...m, relay };
    saveMachine(m);
  }
  return m;
}

export class PairError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
    this.name = "PairError";
  }
}
