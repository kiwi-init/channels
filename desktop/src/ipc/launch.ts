import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import type { LaunchedView } from "@kiwi/core/terminals.ts";
import type { ComputerView, FromMachine, MachineView } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import { daemonHarnesses, daemonHello, daemonLaunch } from "../daemon-client.ts";
import type { Host } from "../host.ts";
import { launchRequestOf, MACHINE_PK } from "../launch-view.ts";
import { foldersOn, harnessesOn, launchOn, machineOnline, type Asker } from "../remote.ts";
import { requirePerson, store } from "../store.ts";
import { runKiwi } from "./kiwi.ts";

const ROOM = /^[A-Za-z0-9_-]{1,128}$/;
const ROOM_ID = /^[0-9a-f]{32}$/;

function folders(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // The CLI writes one array and nothing else; anything else is no folders.
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string" && f.startsWith("/")).slice(0, 20) : [];
}

const asker = (): Asker => ({ person: requirePerson(), relay: store.relayUrl });

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

const machine = (c: ComputerView) => ({ pk: c.machinePk, xpk: c.machineXpk, label: c.label });

export function launchCalls(host: Host): Serves<"harnesses" | "seatFolders" | "chooseFolder" | "launchAgent" | "machines" | "harnessesOn" | "foldersOn"> {
  return {
    harnesses: (): Promise<HarnessRow[]> => daemonHarnesses().catch(() => []),
    seatFolders: async (roomId: unknown): Promise<string[]> => {
      if (typeof roomId !== "string" || !ROOM.test(roomId)) return [];
      const listed = await runKiwi(["folders", "--room", roomId, "--json"]);
      return listed.code === 0 ? folders(listed.stdout) : [];
    },
    chooseFolder: () => host.pickFolder(),
    launchAgent: async (value: unknown): Promise<LaunchedView> => {
      const req = launchRequestOf(value);
      if (!req) return { ok: false, why: "bad-request", detail: "the app sent a launch it can't check" };
      const there = req.machinePk ? paired(req.machinePk) : null;
      if (req.machinePk && !there) return { ok: false, why: "bad-request", detail: "that isn't one of your paired computers" };
      const launched = there ? launchOn(asker(), machine(there), req) : daemonLaunch(req);
      return launched.catch((err: unknown) => ({ ok: false, why: "failed", detail: err instanceof Error ? err.message : String(err) }));
    },
    machines: (): Promise<MachineView[]> => machines().catch(() => []),
    harnessesOn: async (machinePk: unknown): Promise<FromMachine<HarnessRow[]>> => {
      const c = paired(machinePk);
      if (!c) return { ok: false, detail: "that isn't one of your paired computers" };
      return harnessesOn(asker(), machine(c));
    },
    foldersOn: async (machinePk: unknown, roomId: unknown): Promise<FromMachine<string[]>> => {
      const c = paired(machinePk);
      if (!c || typeof roomId !== "string" || !ROOM_ID.test(roomId)) return { ok: false, detail: "that isn't one of your paired computers" };
      return foldersOn(asker(), machine(c), roomId);
    },
  };
}
