import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const BUDGET_BYTES = 760_000;
const FILE_LIMIT_BYTES = 20 * 1024 * 1024;

const dist = resolve(import.meta.dir, "../ui/dist");
const html = await Bun.file(join(dist, "index.html")).text();
const entry = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"/g)].map(([, path = ""]) => path);
const preloaded = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(([, path = ""]) => path);
if (entry.length !== 1) {
  console.error(`ui/dist/index.html should load one entry script, found ${entry.length}: run bun run ui:build first`);
  process.exit(1);
}
const files = [...entry, ...preloaded];
const sizes = await Promise.all(files.map(async (path) => ({ path, bytes: (await Bun.file(join(dist, path)).bytes()).length })));
const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
for (const s of sizes) console.log(`${String(s.bytes).padStart(9)}  ${s.path}`);
console.log(`first-load JS: ${total} bytes in ${sizes.length} files (budget ${BUDGET_BYTES})`);
if (total > BUDGET_BYTES) {
  console.error(
    `the app's first-load JS is ${total} bytes, over its ${BUDGET_BYTES}-byte budget. Load the new code lazily (React.lazy, as ui/src/chat/message.tsx does for markdown), or take as much off the first load as you add; the budget doesn't go up for a feature. bun scripts/bundle-why.ts shows where it comes from.`,
  );
  process.exit(1);
}

const everyFile = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? everyFile(join(dir, e.name)) : [join(dir, e.name)]));
const shipped = everyFile(dist).map((path) => ({ path: relative(dist, path), bytes: statSync(path).size }));
const big = shipped.filter((f) => f.bytes > FILE_LIMIT_BYTES);
const all = shipped.reduce((sum, f) => sum + f.bytes, 0);
console.log(`ui/dist: ${(all / 1e6).toFixed(1)} MB in ${shipped.length} files`);
if (big.length) {
  console.error(
    big
      .map(
        (f) =>
          `ui/dist ships ${f.path} at ${(f.bytes / 1e6).toFixed(1)} MB, over ${FILE_LIMIT_BYTES / 1024 / 1024} MiB: it would weigh on every desktop download and near Cloudflare's 25 MiB limit per file.`,
      )
      .join("\n"),
  );
  process.exit(1);
}
