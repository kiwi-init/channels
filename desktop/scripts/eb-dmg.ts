import fs from "node:fs";

import { LIVEWIRE_NAME } from "../src/livewire-id.ts";

type Run = (cmd: string, args: string[]) => { code: number; stdout: string; stderr: string };

const TRIES = 3;
const PAUSE_MS = 10_000;

export function makeDmg(stage: string, dmg: string, run: Run, pause: (ms: number) => void = Bun.sleepSync): void {
  for (let n = 1; ; n++) {
    fs.rmSync(dmg, { force: true });
    const r = run("hdiutil", ["create", "-volname", LIVEWIRE_NAME, "-srcfolder", stage, "-format", "ULMO", "-o", dmg]);
    if (r.code === 0) return;
    const why = `${r.stdout}${r.stderr}`.trim() || "no output";
    if (n === TRIES) throw new Error(`eb-release: making the dmg failed ${TRIES} times (hdiutil exited ${r.code}): ${why}`);
    console.error(`eb-release: making the dmg failed (hdiutil exited ${r.code}: ${why}); trying again in ${PAUSE_MS / 1000} s (${n} of ${TRIES})`);
    pause(PAUSE_MS);
  }
}
