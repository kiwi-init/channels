import { readFileSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import type { MachineArgs } from "@kiwi/core/machine-ask.ts";
import { writePrivate } from "../config.ts";
import type { Launched } from "@kiwi/core/terminals.ts";
import type { LaunchRequest } from "../launch/wire.ts";

const REMOTE_LAUNCHES = 3;
const REMOTE_WINDOW_MS = 10 * 60_000;

export interface RemoteDeps {
  inventory: () => Promise<HarnessRow[]>;
  folders: (room?: string) => string[];
  launch: (req: LaunchRequest) => Promise<Launched>;
  starts?: string;
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

function underRoots(folder: string, roots: string[]): string | null {
  const target = real(folder);
  if (!target) return null;
  const inside = roots.some((root) => {
    const r = real(root);
    return !!r && (target === r || target.startsWith(r + sep));
  });
  return inside ? target : null;
}

function loadStarts(file: string | undefined): number[] {
  if (!file) return [];
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(v) ? v.filter((t): t is number => typeof t === "number") : [];
  } catch {
    // No launches recorded yet, or a file cut short: count from none.
    return [];
  }
}

export type RemoteResult = { ok: true; harnesses: HarnessRow[] } | { ok: true; folders: string[] } | { ok: true } | Launched;

const withoutBypass = (row: HarnessRow): HarnessRow => (row.options ? { ...row, options: { ...row.options, permission: row.options.permission.filter((p) => p !== "bypass") } } : row);

export function remoteRunner(deps: RemoteDeps): (args: MachineArgs, id: string) => Promise<RemoteResult> {
  const now = deps.now ?? Date.now;
  const started = loadStarts(deps.starts);
  return async (args, id) => {
    switch (args.verb) {
      case "harnesses":
        return { ok: true, harnesses: (await deps.inventory()).map(withoutBypass) };
      case "folders":
        return { ok: true, folders: deps.folders(args.room) };
      case "unpair":
        return { ok: true };
      case "launch": {
        if (args.launch.permission === "bypass") return { ok: false, why: "not-allowed", detail: "bypass permissions can't be asked for from another device" };
        const at = now();
        while (started.length && at - started[0]! >= REMOTE_WINDOW_MS) started.shift();
        if (started.length >= REMOTE_LAUNCHES)
          return { ok: false, why: "failed", detail: `at most ${REMOTE_LAUNCHES} agents are started from another computer every ${REMOTE_WINDOW_MS / 60_000} minutes` };
        const folder = underRoots(args.launch.folder, deps.folders());
        if (!folder) return { ok: false, why: "bad-request", detail: "that folder isn't one this computer's agents work in" };
        started.push(at);
        if (deps.starts) writePrivate(deps.starts, JSON.stringify(started));
        return deps.launch({ ...args.launch, folder, launch: id });
      }
    }
  };
}
