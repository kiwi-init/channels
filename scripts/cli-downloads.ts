import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const BUDGET_BYTES = 30_000_000;
const TARGETS = ["kiwi-darwin-arm64", "kiwi-darwin-x64", "kiwi-linux-x64", "kiwi-linux-arm64"] as const;

const dir = resolve(process.argv[2] ?? "dist");
const files = new Set(readdirSync(dir));
const mb = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;

let over = false;
for (const target of TARGETS) {
  if (!files.has(target)) {
    console.error(`${target}: not built in ${dir}`);
    over = true;
    continue;
  }
  const packed = [".xz", ".gz"].filter((ext) => files.has(target + ext)).map((ext) => ({ name: target + ext, bytes: statSync(join(dir, target + ext)).size }));
  const smallest = packed.sort((a, b) => a.bytes - b.bytes)[0];
  if (!smallest) {
    console.error(`${target}: no compressed download next to it`);
    over = true;
    continue;
  }
  const fits = smallest.bytes <= BUDGET_BYTES;
  console.log(`${smallest.name}: ${mb(smallest.bytes)} (from ${mb(statSync(join(dir, target)).size)})${fits ? "" : `, over the ${mb(BUDGET_BYTES)} budget`}`);
  if (!fits) over = true;
}
if (over) process.exit(1);
