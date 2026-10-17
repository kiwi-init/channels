import { join, resolve } from "node:path";

const BUDGET_BYTES = 775_000;

const dist = resolve(import.meta.dir, "../web/dist");
const html = await Bun.file(join(dist, "index.html")).text();
const entry = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"/g)].map(([, path = ""]) => path);
const preloaded = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(([, path = ""]) => path);
if (entry.length !== 1) {
  console.error(`web/dist/index.html should load one entry script, found ${entry.length}: run cd web && bun run build first`);
  process.exit(1);
}
const files = [...entry, ...preloaded];
const sizes = await Promise.all(files.map(async (path) => ({ path, bytes: (await Bun.file(join(dist, path)).bytes()).length })));
const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
for (const s of sizes) console.log(`${String(s.bytes).padStart(9)}  ${s.path}`);
console.log(`first-load JS: ${total} bytes in ${sizes.length} files (budget ${BUDGET_BYTES})`);
if (total > BUDGET_BYTES) {
  console.error(
    `the dashboard's first-load JS is ${total} bytes, over its ${BUDGET_BYTES}-byte budget: load the new code lazily (web/src/components/lazy.tsx), or raise BUDGET_BYTES in scripts/web-bundle.ts on purpose`,
  );
  process.exit(1);
}
