import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { hostKey, mismatches, pinFor, PINS, sha256 } from "./eb-pins.ts";

const key = hostKey();
const pin = pinFor(PINS.hutch.platforms, key, "Hutch archive");
const root = path.join(process.env.HUTCH_HOME ?? path.join(os.homedir(), ".hutch"), "kiwi-pinned", pin.sha256);
const desktop = path.resolve(import.meta.dirname, "..");

async function fetchHutch(): Promise<void> {
  const res = await fetch(pin.url);
  if (!res.ok) throw new Error(`eb: Hutch download failed (${res.status}): ${pin.url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length !== pin.size || sha256(bytes) !== pin.sha256) throw new Error(`eb: ${pin.url} isn't the archive desktop/electrobun-pins.json pins`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-hutch-"));
  try {
    fs.writeFileSync(path.join(tmp, "hutch.tar.gz"), bytes);
    const tar = spawnSync("tar", ["-xzf", path.join(tmp, "hutch.tar.gz"), "-C", tmp], { stdio: "inherit" });
    if (tar.status !== 0) throw new Error("eb: couldn't unpack Hutch");
    const top = path.join(tmp, `hutch-v${PINS.hutch.version}-${key}`);
    const bad = mismatches(top, pin.files);
    if (bad.length) throw new Error(`eb: Hutch's files don't match their pins: ${bad.join("; ")}`);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(root), { recursive: true });
    fs.cpSync(top, root, { recursive: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (mismatches(root, pin.files).length) await fetchHutch();
const bad = mismatches(root, pin.files);
if (bad.length) throw new Error(`eb: the pinned Hutch in ${root} changed: ${bad.join("; ")}`);

const hutch = path.join(root, "bin", "hutch");
const run = spawnSync(hutch, ["electrobun", ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: desktop,
  env: {
    ...process.env,
    ELECTROBUN_HUTCH_BINARY: hutch,
    ELECTROBUN_RELEASES_BASE_URL: PINS.releasesBaseUrl,
    HUTCH_DEFAULT_CLI: PINS.hutch.version,
    HUTCH_DEFAULT_ELECTROBUN: PINS.electrobun,
  },
});
process.exit(run.status ?? 1);
