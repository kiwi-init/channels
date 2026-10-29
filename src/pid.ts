import { existsSync, readFileSync } from "node:fs";

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, it's just not ours to signal.
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

function linuxStart(pid: number): string | null {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  return ticks && boot ? `${boot}:${ticks}` : null;
}

function psStart(pid: number): string | null {
  const r = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], { env: { ...process.env, LC_ALL: "C", TZ: "UTC0" }, stdout: "pipe", stderr: "ignore" });
  const started = r.stdout.toString().trim();
  return r.exitCode === 0 && started ? started : null;
}

export function processStart(pid: number): string | null {
  try {
    return existsSync("/proc/self/stat") ? linuxStart(pid) : psStart(pid);
  } catch {
    // No such process, no /proc entry or no ps to ask: its start is unknown.
    return null;
  }
}
