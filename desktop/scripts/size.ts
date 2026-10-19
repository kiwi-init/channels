import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const MB = 1024 ** 2;
const ON_DISK_BUDGET = 375 * MB;
const PACKED_BUDGET = 162 * MB;
const LOCALES_KEPT = 2;

const exe = process.argv[2] ? resolve(process.argv[2]) : "";
if (!exe || !existsSync(exe)) {
  console.error("usage: bun desktop/scripts/size.ts <packaged app executable>");
  process.exit(2);
}
const app = dirname(exe);
const problems: string[] = [];

function sizeOf(path: string): number {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

interface AsarNode {
  files?: Record<string, AsarNode>;
  size?: number;
}

function asarHeader(path: string): AsarNode {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const length = head.readUInt32LE(12);
    const json = Buffer.alloc(length);
    readSync(fd, json, 0, length, 16);
    return JSON.parse(json.toString("utf8")) as AsarNode;
  } finally {
    closeSync(fd);
  }
}

const bytesIn = (node: AsarNode): number => (node.files ? Object.values(node.files).reduce((sum, n) => sum + bytesIn(n), 0) : (node.size ?? 0));
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)}MB`;

const asarPath = join(app, "resources", "app.asar");
const asar = asarHeader(asarPath);
const modules = asar.files?.["node_modules"];
console.log(`app.asar: ${mb(bytesIn(asar))}`);
if (modules) problems.push(`app.asar ships node_modules (${mb(bytesIn(modules))}): dist/ already bundles them, so keep runtime packages out of desktop/package.json's dependencies`);

const localesDir = join(app, "locales");
const locales = existsSync(localesDir) ? readdirSync(localesDir).filter((f) => f.endsWith(".pak")) : [];
console.log(`locales: ${locales.join(", ") || "none"}`);
if (locales.length > LOCALES_KEPT) problems.push(`${locales.length} Chromium locales ship (${mb(sizeOf(localesDir))}): the app is in English, keep electronLanguages to en`);

for (const name of readdirSync(app)
  .sort((a, b) => sizeOf(join(app, b)) - sizeOf(join(app, a)))
  .slice(0, 6))
  console.log(`  ${mb(sizeOf(join(app, name))).padStart(8)}  ${name}`);
const onDisk = sizeOf(app);
console.log(`on disk: ${mb(onDisk)} (budget ${mb(ON_DISK_BUDGET)})`);
if (onDisk > ON_DISK_BUDGET) problems.push(`the app is ${mb(onDisk)} on disk, over its ${mb(ON_DISK_BUDGET)} budget for the Linux build`);

const tar = spawnSync("sh", ["-c", 'tar -czf - -C "$1" . | wc -c', "size", app], { encoding: "utf8" });
const packed = Number(tar.stdout.trim());
console.log(`packed (tar.gz): ${mb(packed)} (budget ${mb(PACKED_BUDGET)})`);
if (!(packed > 0)) problems.push(`couldn't pack the app to measure it: ${tar.stderr.trim()}`);
else if (packed > PACKED_BUDGET) problems.push(`the app packs to ${mb(packed)}, over its ${mb(PACKED_BUDGET)} download budget for the Linux build`);

for (const p of problems) console.error(`size: ${p}`);
process.exit(problems.length ? 1 : 0);
