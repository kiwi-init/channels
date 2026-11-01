import { spawnSync } from "node:child_process";
import fs from "node:fs";

type Run = (cmd: string, args: string[]) => { code: number; stdout: string; stderr: string };

const TRIES = 3;
const PAUSE_MS = 10_000;

function spawnRun(cmd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? r.error?.message ?? "" };
}

export function makeDmg(stage: string, dmg: string, run: Run = spawnRun, pause: (ms: number) => void = Bun.sleepSync): void {
  for (let n = 1; ; n++) {
    fs.rmSync(dmg, { force: true });
    const r = run("hdiutil", ["create", "-volname", "Channels", "-srcfolder", stage, "-format", "ULMO", "-o", dmg]);
    if (r.code === 0 && fs.existsSync(dmg)) return;
    const said = `${r.stdout}${r.stderr}`.trim() || "no output";
    const why = r.code === 0 ? `hdiutil exited 0 but left no ${dmg}: ${said}` : `hdiutil exited ${r.code}: ${said}`;
    if (n === TRIES) throw new Error(`making the dmg failed ${TRIES} times (${why})`);
    console.error(`making the dmg failed (${why}); trying again in ${PAUSE_MS / 1000} s (${n} of ${TRIES})`);
    pause(PAUSE_MS);
  }
}
