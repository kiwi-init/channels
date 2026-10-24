import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, sep } from "node:path";
import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import type { MachineArgs } from "@kiwi/core/machine-ask.ts";
import { writePrivate } from "../config.ts";
import { isFolder } from "../launch/folders.ts";
import type { Launched } from "@kiwi/core/terminals.ts";
import type { LaunchRequest } from "../launch/wire.ts";

const REMOTE_LAUNCHES = 3;
const REMOTE_WINDOW_MS = 10 * 60_000;

export interface RemoteDeps {
  inventory: () => Promise<HarnessRow[]>;
  folders: (room?: string) => string[];
  launch: (req: LaunchRequest) => Promise<Launched>;
  bypass?: () => boolean;
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
  if (!isAbsolute(folder) || folder.split(/[\\/]/).includes("..")) return null;
  const target = real(folder);
  if (!target || !isFolder(target)) return null;
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

export type RemoteResult = { ok: true; harnesses: HarnessRow[]; bypass: boolean } | { ok: true; folders: string[] } | { ok: true } | Launched;

export const NO_REMOTE_BYPASS =
  "this computer doesn't take bypass permissions from another device: turn on Allow bypass from your other devices in its Settings → New agents, or run kiwi launches bypass on there";

const withoutBypass = (row: HarnessRow): HarnessRow => (row.options ? { ...row, options: { ...row.options, permission: row.options.permission.filter((p) => p !== "bypass") } } : row);

export function remoteRunner(deps: RemoteDeps): (args: MachineArgs, id: string) => Promise<RemoteResult> {
  const now = deps.now ?? Date.now;
  const started = loadStarts(deps.starts);
  const bypass = deps.bypass ?? (() => false);
  return async (args, id) => {
    switch (args.verb) {
      case "harnesses": {
        const allowed = bypass();
        const rows = await deps.inventory();
        return { ok: true, harnesses: allowed ? rows : rows.map(withoutBypass), bypass: allowed };
      }
      case "folders":
        return { ok: true, folders: deps.folders(args.room) };
      case "unpair":
        return { ok: true };
      case "launch": {
        if (args.launch.permission === "bypass" && !bypass()) return { ok: false, why: "not-allowed", detail: NO_REMOTE_BYPASS };
        const at = now();
        while (started.length && at - started[0]! >= REMOTE_WINDOW_MS) started.shift();
        if (started.length >= REMOTE_LAUNCHES)
          return { ok: false, why: "failed", detail: `at most ${REMOTE_LAUNCHES} agents are started from another computer every ${REMOTE_WINDOW_MS / 60_000} minutes` };
        const folder = underRoots(args.launch.folder, deps.folders());
        if (!folder) return { ok: false, why: "bad-request", detail: "that folder isn't one this computer starts agents in" };
        started.push(at);
        if (deps.starts) writePrivate(deps.starts, JSON.stringify(started));
        return deps.launch({ ...args.launch, folder, launch: id });
      }
    }
  };
}
