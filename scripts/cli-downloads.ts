import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const BUDGETS = {
  "kiwi-darwin-arm64": 25_000_000,
  "kiwi-darwin-x64": 32_000_000,
  "kiwi-linux-x64": 39_000_000,
  "kiwi-linux-arm64": 34_000_000,
} as const;

const dir = resolve(process.argv[2] ?? "dist");
const files = new Set(readdirSync(dir));
const mb = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;

let over = false;
for (const [target, budget] of Object.entries(BUDGETS)) {
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
  const fits = smallest.bytes <= budget;
  console.log(`${smallest.name}: ${mb(smallest.bytes)} (from ${mb(statSync(join(dir, target)).size)})${fits ? "" : `, over its ${mb(budget)} budget`}`);
  if (!fits) over = true;
}
if (over) process.exit(1);
