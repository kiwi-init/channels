import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const BUDGET_BYTES = 590_000;
const DICTATION_MARKERS = ["kiwi-dictation", "dictation.kiwi.invalid", "whisper-base"];
const FILE_LIMIT_BYTES = 20 * 1024 * 1024;

const dist = resolve(import.meta.dir, "../web/dist");
const html = await Bun.file(join(dist, "index.html")).text();
const entry = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"/g)].map(([, path = ""]) => path);
const preloaded = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(([, path = ""]) => path);
if (entry.length !== 1) {
  console.error(`web/dist/index.html should load one entry script, found ${entry.length}: run cd web && bun run build first`);
  process.exit(1);
}
const files = [...entry, ...preloaded];
const sizes = await Promise.all(
  files.map(async (path) => {
    const bytes = await Bun.file(join(dist, path)).bytes();
    return { path, bytes: bytes.length, text: new TextDecoder().decode(bytes) };
  }),
);
const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
for (const s of sizes) console.log(`${String(s.bytes).padStart(9)}  ${s.path}`);
console.log(`first-load JS: ${total} bytes in ${sizes.length} files (budget ${BUDGET_BYTES})`);
if (total > BUDGET_BYTES) {
  console.error(
    `the dashboard's first-load JS is ${total} bytes, over its ${BUDGET_BYTES}-byte budget. Load the new code lazily (web/src/components/lazy.tsx), or take as much off the first load as you add; the budget doesn't go up for a feature.`,
  );
  process.exit(1);
}
const dictation = sizes.filter((s) => DICTATION_MARKERS.some((m) => s.text.includes(m))).map((s) => s.path);
if (dictation.length) {
  console.error(
    `dictation's model code is in the first load (${dictation.join(", ")}): it loads on the first mic press from web/src/lib/dictation/engine.ts, so only that file may import the model, the recorder, the transcriber or core's dictation.ts.`,
  );
  process.exit(1);
}

const everyFile = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? everyFile(join(dir, e.name)) : [join(dir, e.name)]));
const shipped = everyFile(dist).map((path) => ({ path: relative(dist, path), bytes: statSync(path).size }));
const runtime = shipped.filter((f) => /(^|\/)ort-wasm-[^/]*\.wasm$/.test(f.path));
const big = shipped.filter((f) => f.bytes > FILE_LIMIT_BYTES);
const all = shipped.reduce((sum, f) => sum + f.bytes, 0);
console.log(`web/dist: ${(all / 1e6).toFixed(1)} MB in ${shipped.length} files`);
if (runtime.length || big.length) {
  console.error(
    [
      ...runtime.map((f) => `web/dist ships ${f.path} (${(f.bytes / 1e6).toFixed(1)} MB): dictation's WebAssembly comes through the relay, verified, so the app and the site never carry it.`),
      ...big
        .filter((f) => !runtime.includes(f))
        .map(
          (f) =>
            `web/dist ships ${f.path} at ${(f.bytes / 1e6).toFixed(1)} MB, over ${FILE_LIMIT_BYTES / 1024 / 1024} MiB: it would weigh on every desktop download and near Cloudflare's 25 MiB limit per file.`,
        ),
    ].join("\n"),
  );
  process.exit(1);
}
