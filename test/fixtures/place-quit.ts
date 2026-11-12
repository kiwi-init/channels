import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { place, stopCliWork } from "../../desktop/src/cli.ts";

const [bundle = "", dest = "", until = "started"] = process.argv.slice(2);
const children = (): number[] =>
  Bun.spawnSync(["pgrep", "-P", String(process.pid)])
    .stdout.toString()
    .split("\n")
    .filter(Boolean)
    .map(Number);
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // No such process: it ended.
    return false;
  }
};
const said = (placed: Promise<void>): Promise<string> =>
  placed.then(
    () => "placed",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );

const written = (): boolean => readdirSync(dirname(dest)).some((f) => f.includes(".new-"));
const ready = (): boolean => children().length > 0 && (until === "started" || written());

const first = said(place(bundle, dest));
for (const end = Date.now() + 30_000; !ready() && Date.now() < end; await Bun.sleep(5));
const started = children();
stopCliWork();
const left = readdirSync(dirname(dest));
const outcome = await first;
const again = await said(place(bundle, dest));
for (const end = Date.now() + 5_000; started.some(alive) && Date.now() < end; await Bun.sleep(20));
console.log(JSON.stringify({ started: started.length, outcome, again, alive: started.filter(alive).length, left, files: readdirSync(dirname(dest)) }));
