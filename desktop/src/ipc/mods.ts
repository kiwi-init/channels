import path from "node:path";

import type { Serves } from "../calls.ts";
import { kiwiHome } from "../daemon-client.ts";
import type { Host } from "../host.ts";
import { modsHost, type ModsHost } from "../mods-host.ts";
import { UI_CONTRACT } from "../ui-contract.ts";

export function modsCalls(host: Host): Serves<"mods" | "modBundle" | "approveMod" | "modFetch"> {
  let mods: ModsHost | null = null;
  let started: Promise<ModsHost> | null = null;
  const ready = (): Promise<ModsHost> => {
    if (started) return started;
    const m = modsHost({
      folder: path.join(kiwiHome(), "mods"),
      approvals: path.join(host.app.path("data"), "mods.json"),
      contract: UI_CONTRACT,
      push: (list) => host.push("mods", list),
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
  };
}
