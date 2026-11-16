import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const LEDGER_ENV = "KIWI_TEST_SPAWNS";
export const GRACE_MS = 2_000;
const KILLED_MS = 1_000;

type Entry = { pid: number; cmd: string };

export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

function commandOf(pid: number): string {
  try {
    if (process.platform === "linux") return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\u0000").join(" ").trim();
    return spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 }).stdout.trim();
  } catch {
    // A process whose command can't be read is never one this run may stop.
    return "";
  }
}

function entries(path: string, from: number): Entry[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8").slice(from);
  } catch {
    // No ledger yet: nothing was started.
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        const e: unknown = JSON.parse(l);
        return typeof e === "object" && e !== null && "pid" in e && "cmd" in e && Number.isSafeInteger(e.pid) && typeof e.cmd === "string" ? [{ pid: Number(e.pid), cmd: e.cmd }] : [];
      } catch {
        // A line cut short by a kill mid-write names no process we can prove is ours.
        return [];
      }
    });
}

const shape = (cmd: string): string => {
  const [program = "", ...rest] = cmd.trim().split(/\s+/);
  return [program.split("/").pop() ?? program, ...rest].join(" ");
};

const ours = (e: Entry): boolean => e.pid !== process.pid && running(e.pid) && shape(commandOf(e.pid)) === shape(e.cmd);

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // It exited between the check and the signal: already stopped.
  }
}

export async function stopOwned(path = process.env[LEDGER_ENV], from = 0, grace = GRACE_MS): Promise<number[]> {
  if (!path) return [];
  const live = entries(path, from).filter(ours);
  for (const e of live) signal(e.pid, "SIGTERM");
  const until = Date.now() + grace;
  while (live.some(ours) && Date.now() < until) await Bun.sleep(50);
  const stubborn = live.filter(ours);
  for (const e of stubborn) signal(e.pid, "SIGKILL");
  const killedBy = Date.now() + KILLED_MS;
  while (stubborn.some((e) => running(e.pid)) && Date.now() < killedBy) await Bun.sleep(50);
  return live.map((e) => e.pid);
}
