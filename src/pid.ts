export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, it's just not ours to signal.
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

export function processStart(pid: number): string | null {
  const r = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], { env: { ...process.env, LC_ALL: "C", TZ: "UTC0" }, stdout: "pipe", stderr: "ignore" });
  const started = r.stdout.toString().trim();
  return r.exitCode === 0 && started ? started : null;
}
