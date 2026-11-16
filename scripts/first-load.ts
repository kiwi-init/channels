import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type FirstLoad = { total: number; files: { path: string; bytes: number }[] };

export function firstLoad(dist: string): FirstLoad {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const entry = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"/g)].map(([, path = ""]) => path);
  const preloaded = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(([, path = ""]) => path);
  if (entry.length !== 1) throw new Error(`ui/dist/index.html should load one entry script, found ${entry.length}: run bun run ui:build first`);
  const files = [...entry, ...preloaded].map((path) => ({ path, bytes: statSync(join(dist, path)).size }));
  return { total: files.reduce((sum, f) => sum + f.bytes, 0), files };
}
