import { realpathSync } from "node:fs";
import { sep } from "node:path";
import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import type { MachineArgs } from "@kiwi/core/machine-ask.ts";
import type { Launched, LaunchRequest } from "../launch/wire.ts";

export const REMOTE_LAUNCHES = 3;
export const REMOTE_WINDOW_MS = 10 * 60_000;

export interface RemoteDeps {
  inventory: () => Promise<HarnessRow[]>;
  folders: (room?: string) => string[];
  launch: (req: LaunchRequest) => Promise<Launched>;
  now?: () => number;
}

function real(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    // A folder that isn't there can't be one an agent works in.
    return null;
  }
}

export function underRoots(folder: string, roots: string[]): boolean {
  const target = real(folder);
  if (!target) return false;
  return roots.some((root) => {
    const r = real(root);
    return !!r && (target === r || target.startsWith(r + sep));
  });
}

export type RemoteResult = { ok: true; harnesses: HarnessRow[] } | { ok: true; folders: string[] } | { ok: true } | Launched;

export function remoteRunner(deps: RemoteDeps): (args: MachineArgs, id: string) => Promise<RemoteResult> {
  const now = deps.now ?? Date.now;
  const started: number[] = [];
  return async (args, id) => {
    switch (args.verb) {
      case "harnesses":
        return { ok: true, harnesses: await deps.inventory() };
      case "folders":
        return { ok: true, folders: deps.folders(args.room) };
      case "unpair":
        return { ok: true };
      case "launch": {
        const at = now();
        while (started.length && at - started[0]! >= REMOTE_WINDOW_MS) started.shift();
        if (started.length >= REMOTE_LAUNCHES)
          return { ok: false, why: "failed", detail: `at most ${REMOTE_LAUNCHES} agents are started from another computer every ${REMOTE_WINDOW_MS / 60_000} minutes` };
        if (!underRoots(args.launch.folder, deps.folders())) return { ok: false, why: "bad-request", detail: "that folder isn't one this computer's agents work in" };
        started.push(at);
        return deps.launch({ ...args.launch, launch: id });
      }
    }
  };
}
