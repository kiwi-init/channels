import path from "node:path";

import type { ModInstalled, ModUpdate, ModUpdates } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import { kiwiHome } from "../daemon-client.ts";
import type { Host } from "../host.ts";
import { modsHost, type ModsHost } from "../mods-host.ts";
import { inModsWorker } from "../mods-run.ts";
import { UI_CONTRACT } from "../ui-contract.ts";

let safeAtStart: string | null = null;

export const startModsSafe = (why: string): void => {
  safeAtStart ??= why;
};

type Info = ModInstalled & { version: string | null; needs: string[]; problem: string | null };
type Change = ModUpdate & { applied: boolean };
type Found = { changes: Change[]; current: string[]; skipped: ModUpdates["skipped"] };

const installed = ({ name, source, commit, local, link, changed }: Info): ModInstalled => ({ name, source, commit, local, link, changed });
const offered = ({ name, from, to, commits, added, dropped }: Change): ModUpdate => ({ name, from, to, commits, added, dropped });

export function modsCalls(
  host: Host,
): Serves<"mods" | "modBundle" | "approveMod" | "modFetch" | "modFailed" | "setModOn" | "modsSettled" | "modsInstalled" | "modUpdates" | "updateMod" | "removeMod"> {
  let mods: ModsHost | null = null;
  let started: Promise<ModsHost> | null = null;
  const ready = (): Promise<ModsHost> => {
    if (started) return started;
    const m = modsHost({
      folder: path.join(kiwiHome(), "mods"),
      approvals: path.join(host.app.path("data"), "mods.json"),
      contract: UI_CONTRACT,
      push: (list) => host.push("mods", list),
      safe: safeAtStart,
    });
    mods = m;
    started = m.start().then(() => m);
    host.app.onQuit(() => mods?.stop());
    return started;
  };
  return {
    mods: async () => (await ready()).list(),
    modBundle: async (name) => (await ready()).bundle(String(name)),
    approveMod: async (name, needs) => (await ready()).approve(String(name), needs),
    modFetch: async (name, req) => (await ready()).fetch(String(name), req),
    modFailed: async (name, hash, why) => (await ready()).failed(String(name), String(hash), String(why)),
    setModOn: async (name, on) => (await ready()).setOn(String(name), on === true),
    modsSettled: async () => (await ready()).settled(),
    modsInstalled: async () => (await inModsWorker<Info[]>({ op: "list", home: kiwiHome() })).map(installed),
    modUpdates: async () => {
      const found = await inModsWorker<Found>({ op: "check", home: kiwiHome() });
      return { changes: found.changes.map(offered), skipped: found.skipped };
    },
    updateMod: async (name) => {
      const found = await inModsWorker<Found>({ op: "update", home: kiwiHome(), name: String(name) });
      const skipped = found.skipped.find((s) => s.name === name);
      if (skipped) throw new Error(`${skipped.name} ${skipped.why}`);
      const h = await ready();
      await h.rescan();
      return h.list();
    },
    removeMod: async (name, force) => {
      await inModsWorker({ op: "remove", home: kiwiHome(), name: String(name), force: force === true });
      return (await ready()).forget(String(name));
    },
  };
}
