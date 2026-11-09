import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const [catalog, derived] = process.argv.slice(2);
if (!catalog || !derived) throw new Error("usage: bun ios/scripts/catalog-check.ts <Localizable.xcstrings> <derived data dir>");

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

const used = files(derived).filter((f) => f.endsWith(".stringsdata") && f.includes("Channels.build") && !/test|EnrichedMarkdown/i.test(f));
if (used.length === 0) throw new Error(`no .stringsdata under ${derived}: build with SWIFT_EMIT_LOC_STRINGS first`);

const copy = join(mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "catalog-")), basename(catalog));
await Bun.write(copy, Bun.file(catalog));
const sync = Bun.spawnSync(["xcrun", "xcstringstool", "sync", copy, ...used.flatMap((f) => ["--stringsdata", f])]);
if (sync.exitCode !== 0) throw new Error(`xcstringstool sync failed: ${sync.stderr.toString()}`);

type Catalog = { strings: Record<string, { extractionState?: string }> };
const before = (await Bun.file(catalog).json()) as Catalog;
const after = (await Bun.file(copy).json()) as Catalog;
const missing = Object.keys(after.strings).filter((k) => !(k in before.strings));
const stale = Object.entries(after.strings)
  .filter(([, v]) => v.extractionState === "stale")
  .map(([k]) => k);
for (const k of missing) console.log(`missing from the catalog: ${JSON.stringify(k)}`);
for (const k of stale) console.log(`no longer in the code: ${JSON.stringify(k)}`);
if (missing.length || stale.length) {
  console.log(`\nThe iPhone's String Catalog is out of step with the code. Build, then: xcrun xcstringstool sync ios/Channels/Localizable.xcstrings --stringsdata <each Channels.build .stringsdata>`);
  process.exit(1);
}
console.log(`the catalog has all ${Object.keys(before.strings).length} strings the app uses`);
