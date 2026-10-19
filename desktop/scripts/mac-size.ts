import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const MB = 1024 ** 2;
const LIMITS = {
  packed: { gate: 160 * MB, budget: 150 * MB },
  app: { gate: 400 * MB, budget: 320 * MB },
};

const dir = resolve(process.argv[2] ?? "desktop/release");
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)}MB`;

function sizeOf(path: string): number {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

const found: { what: string; bytes: number; limit: { gate: number; budget: number } }[] = [];
for (const name of readdirSync(dir)) {
  if (/\.(dmg|zip)$/i.test(name)) found.push({ what: name, bytes: sizeOf(join(dir, name)), limit: LIMITS.packed });
  if (name.startsWith("mac"))
    for (const app of readdirSync(join(dir, name)).filter((n) => n.endsWith(".app"))) found.push({ what: `${name}/${app} on disk`, bytes: sizeOf(join(dir, name, app)), limit: LIMITS.app });
}
if (!found.some((f) => f.what.endsWith(" on disk")) || !found.some((f) => /\.(dmg|zip)$/i.test(f.what))) {
  console.error(`size: no Mac app with its dmg or zip under ${dir}`);
  process.exit(1);
}
let over = 0;
for (const f of found) {
  const tag = f.bytes > f.limit.gate ? "OVER its gate" : f.bytes > f.limit.budget ? "under its gate, not yet at the 0.20 budget" : "at the 0.20 budget";
  console.log(`${mb(f.bytes).padStart(9)}  ${f.what}  (gate ${mb(f.limit.gate)}, 0.20 budget ${mb(f.limit.budget)}: ${tag})`);
  if (f.bytes > f.limit.gate) over++;
}
process.exit(over ? 1 : 0);
