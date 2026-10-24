import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { mismatches, pinFor, PINS, sha256, treeSha256 } from "./eb-pins.ts";

const keys = process.argv.slice(2);
if (!keys.length) {
  console.error("usage: bun desktop/scripts/eb-pins-check.ts <macos-arm64|linux-x64|linux-arm64>...");
  process.exit(2);
}

const coreUrl = (key: string): string => `https://github.com/blackboardsh/electrobun/releases/download/v${PINS.electrobun}/electrobun-core-${key.replace(/^macos-/, "darwin-")}.tar.gz`;

async function fetched(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function unpacked(bytes: Uint8Array, into: string): void {
  fs.mkdirSync(into, { recursive: true });
  const archive = path.join(into, "archive.tar.gz");
  fs.writeFileSync(archive, bytes);
  const tar = spawnSync("tar", ["-xzf", archive, "-C", into], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error(`couldn't unpack ${archive}`);
  fs.rmSync(archive);
}

async function problemsOf(key: string, tmp: string): Promise<string[]> {
  const pin = pinFor(PINS.hutch.platforms, key, "Hutch archive");
  const hutch = await fetched(pin.url);
  if (hutch.length !== pin.size || sha256(hutch) !== pin.sha256) return [`${key}: ${pin.url} is ${hutch.length} bytes, sha256 ${sha256(hutch)}; pinned ${pin.size}, ${pin.sha256}`];
  unpacked(hutch, path.join(tmp, key, "hutch"));
  const bad = mismatches(path.join(tmp, key, "hutch", `hutch-v${PINS.hutch.version}-${key}`), pin.files).map((m) => `${key} Hutch ${m}`);
  unpacked(await fetched(coreUrl(key)), path.join(tmp, key, "core"));
  const devkit = treeSha256(path.join(tmp, key, "core", "api"));
  const pinned = pinFor(PINS.devkit, key, "devkit");
  return devkit === pinned ? bad : [...bad, `${key}: the devkit api tree in ${coreUrl(key)} is ${devkit}, pinned ${pinned}`];
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eb-pins-check-"));
try {
  const problems = (await Promise.all(keys.map((k) => problemsOf(k, tmp)))).flat();
  for (const k of keys) if (!problems.some((p) => p.startsWith(k))) console.log(`${k}: Hutch ${PINS.hutch.version} and the Electrobun ${PINS.electrobun} devkit match their pins`);
  for (const p of problems) console.error(`eb-pins-check: ${p}`);
  process.exitCode = problems.length ? 1 : 0;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
