import { statSync } from "node:fs";
import { runNow } from "./run.ts";

export interface Device {
  tty: string;
  path: string;
}

function uid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

export function leadsTerminal(pid: number): Device | null {
  if (process.platform === "win32" || !Number.isSafeInteger(pid) || pid <= 0) return null;
  const r = runNow(["ps", "-o", "tty=,tpgid=,pgid=", "-p", String(pid)], 2_000);
  const [tty, fg, group] = r.status === 0 ? r.stdout.trim().split(/\s+/) : [];
  if (!tty || tty === "?" || fg !== String(pid) || group !== String(pid)) return null;
  const path = `/dev/${tty}`;
  try {
    const stat = statSync(path);
    if (!stat.isCharacterDevice()) return null;
    const owner = uid();
    if (owner !== null && stat.uid !== owner) return null;
  } catch {
    return null;
  }
  return { tty, path };
}

export function holdsInput(pid: number, tty: string): boolean {
  const device = leadsTerminal(pid);
  return device !== null && tty.endsWith(`/${device.tty}`);
}
