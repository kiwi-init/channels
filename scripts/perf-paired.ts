import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SCRIPTS = import.meta.dir;
const LOCAL = /(?:from\s+|import\s*\(\s*)"\.\/([^"/]+\.ts)"/g;

export function harnessFiles(entry = "perf-scale.ts"): string[] {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const path = join(SCRIPTS, name);
    if (!existsSync(path)) throw new Error(`perf-paired: ${name} is imported but missing`);
    for (const m of readFileSync(path, "utf8").matchAll(LOCAL)) visit(m[1]!);
  };
  visit(entry);
  visit("ui-harness.ts");
  return [...seen].sort();
}

if (import.meta.main) {
  const [command, target] = process.argv.slice(2);
  if (command !== "copy" || !target) {
    console.error("usage: bun scripts/perf-paired.ts copy <base checkout>: copies this checkout's perf-scale harness into the base, so both sides run the same workload");
    process.exit(2);
  }
  const into = join(resolve(target), "scripts");
  if (!existsSync(dirname(into)) || !existsSync(into)) throw new Error(`perf-paired: ${into} is not a checkout's scripts folder`);
  const files = harnessFiles();
  for (const f of files) copyFileSync(join(SCRIPTS, f), join(into, f));
  console.log(`copied the harness into ${into}: ${files.join(", ")}`);
}
