import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const HARNESS_DIST = join(ROOT, "ui/dist-harness");

export function harnessDist(dir?: string): string {
  const dist = resolve(ROOT, dir ?? HARNESS_DIST);
  if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun scripts/ui-harness.ts first`);
  return dist;
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    console.log(`Builds ui/ into ui/dist-harness for the app smoke and the perf harnesses: the production bundle with only import.meta.env.DEV
set, so the plain-browser key store works: they drive the app in a browser with no desktop bridge.

  bun scripts/ui-harness.ts

KIWI_HARNESS_NAMES=1 leaves the bundle unminified, so a profile names functions. Slower: for a diagnosis, never for a gated number.`);
    process.exit(0);
  }
  const named = process.env.KIWI_HARNESS_NAMES === "1" ? ["--minify", "false"] : [];
  const build = Bun.spawn(["bun", "x", "vite", "build", "--mode", "harness", "--outDir", HARNESS_DIST, "--logLevel", "warn", ...named], {
    cwd: join(ROOT, "ui"),
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await build.exited);
}
