import type { ComputerSettings } from "@kiwi/core/computer-settings.ts";
import type { MachineArgs } from "@kiwi/core/machine-ask.ts";

export interface RemoteDeps {
  settings?: () => Promise<ComputerSettings>;
}

export type RemoteResult = { ok: true; settings: ComputerSettings } | { ok: true } | { ok: false; why: "failed"; detail: string };

export function remoteRunner(deps: RemoteDeps): (args: MachineArgs, id: string) => Promise<RemoteResult> {
  return async (args) => {
    switch (args.verb) {
      case "unpair":
        return { ok: true };
      case "settings":
        return deps.settings ? { ok: true, settings: await deps.settings() } : { ok: false, why: "failed", detail: "this computer's kiwi doesn't share its settings" };
    }
  };
}
