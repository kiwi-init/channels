import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.argv.includes("--help")) {
  console.log(`The preload lists of lazy imports don't carry the first load: reads ui/dist's index.html, checks it still modulepreloads exactly what the entry imports statically, and that no lazy import's preload list names a file the first load already has.

  bun scripts/ui-preload-deps.ts [--dist ui/dist]`);
  process.exit(0);
}
const at = process.argv.indexOf("--dist");
const dist = resolve(at > 0 ? (process.argv[at + 1] ?? "") : join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

const html = readFileSync(join(dist, "index.html"), "utf8");
const entry = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"/g)].map(([, f = ""]) => f);
const preloaded = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(([, f = ""]) => f);
expect(entry.length === 1, `index.html loads one entry script (${entry.length})`);
const firstLoad = new Set([...entry, ...preloaded]);

const code = (file: string) => readFileSync(join(dist, file), "utf8");
const staticImports = (file: string) => [...code(file).matchAll(/(?:\bfrom|\bimport)\s*["'`]\.\/([^"'`]+\.js)["'`]/g)].map(([, f = ""]) => `assets/${f}`);
const graph = new Set<string>();
const walk = (file: string): void => {
  if (graph.has(file)) return;
  graph.add(file);
  for (const next of staticImports(file)) walk(next);
};
for (const f of entry) walk(f);
const unlisted = [...graph].filter((f) => !firstLoad.has(f));
const extra = [...firstLoad].filter((f) => !graph.has(f));
expect(
  unlisted.length === 0 && extra.length === 0,
  `index.html modulepreloads exactly the ${graph.size - 1} files the entry imports statically${unlisted.length ? `; not preloaded: ${unlisted.join(", ")}` : ""}${extra.length ? `; preloaded but not imported: ${extra.join(", ")}` : ""}`,
);

const lists = readdirSync(join(dist, "assets"))
  .filter((f) => f.endsWith(".js"))
  .flatMap((f) => [...code(`assets/${f}`).matchAll(/m\.f=\[([^\]]*)\]/g)].map(([, list = ""]) => ({ f, deps: [...list.matchAll(/"([^"]+)"/g)].map(([, d = ""]) => d) })));
const named = lists.flatMap(({ f, deps }) => deps.filter((d) => firstLoad.has(d)).map((d) => `${d} (in ${f})`));
const listed = lists.reduce((n, l) => n + l.deps.length, 0);
expect(
  named.length === 0,
  `no lazy import's preload list names a first-load file: ${listed} entries in ${lists.length} lists${named.length ? `, ${named.length} of them already loaded: ${named.slice(0, 5).join(", ")}${named.length > 5 ? ", …" : ""}` : ""}`,
);

if (fails.length) {
  console.error(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
