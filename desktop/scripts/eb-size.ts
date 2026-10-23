import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MB = 1024 ** 2;
const LIMITS = { app: 100 * MB, packed: 40 * MB };

const dir = resolve(process.argv[2] ?? "desktop/release-eb");
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)}MB`;

function sizeOf(path: string): number {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

const builds = join(dir, "build");
const apps = readdirSync(builds)
  .filter((name) => name.startsWith("stable-macos-"))
  .flatMap((name) =>
    readdirSync(join(builds, name))
      .filter((n) => n.endsWith(".app"))
      .map((app) => join(builds, name, app)),
  );
const artifacts = join(dir, "artifacts");
const dmgs = readdirSync(artifacts)
  .filter((name) => name.endsWith(".dmg"))
  .map((name) => join(artifacts, name));
if (apps.length !== 1 || dmgs.length !== 1) {
  console.error(`eb-size: expected one stable Mac .app under ${builds} and one .dmg under ${artifacts}, found ${apps.length} and ${dmgs.length}`);
  process.exit(1);
}
const app = apps[0] as string;
const dmg = dmgs[0] as string;
const tmp = mkdtempSync(join(tmpdir(), "eb-size-"));
const zip = join(tmp, "Channels.zip");
execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);

const found = [
  { what: `${app.slice(dir.length + 1)} on disk`, bytes: sizeOf(app), limit: LIMITS.app },
  { what: dmg.slice(dir.length + 1), bytes: sizeOf(dmg), limit: LIMITS.packed },
  { what: "the .app as a zip (ditto, the updater's layout)", bytes: sizeOf(zip), limit: LIMITS.packed },
];
rmSync(tmp, { recursive: true, force: true });

let over = 0;
for (const f of found) {
  const tag = f.bytes > f.limit ? "OVER" : "ok";
  console.log(`${mb(f.bytes).padStart(9)}  ${f.what}  (gate ${mb(f.limit)}: ${tag})`);
  if (f.bytes > f.limit) over++;
}
process.exit(over ? 1 : 0);
